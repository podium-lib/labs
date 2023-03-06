import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, parse } from "node:path";
import ResponseTiming from "fastify-metrics-js-response-timing";
import fp from "fastify-plugin";
import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { fastifyStatic } from "@fastify/static";
import { render as ssr } from "@lit-labs/ssr";
import Podlet from "@podium/podlet";
import fastifyPodletPlugin from "@podium/fastify-podlet";
import ProcessExceptionHandlers from "./process-exception-handlers.js";
import esbuild from "esbuild";
import Metrics from "@metrics/client";
import { SemVer } from "semver";
import compress from "@fastify/compress";
import httpError from "http-errors";
import merge from "lodash.merge";
import Ajv from "ajv";
import resolve from "./resolve.js";

const require = createRequire(import.meta.url);

/**
 * TODO:
 * - localisation
 * - publish mode
 */

const renderModes = {
  SSR_ONLY: "ssr-only",
  CSR_ONLY: "csr-only",
  HYDRATE: "hydrate",
  // PUBLISH: "publish",
};

const isAbsoluteURL = (pathOrUrl) => {
  const url = new URL(pathOrUrl, "http://local");
  if (url.origin !== "http://local") return true;
  return false;
};

const joinURLPathSegments = (...segments) => {
  return segments.join("/").replace(/[\/]+/g, "/");
};

// if base is absolute, use it as is
// if base is relative, join it with the prefix which is where the app is mounted
// if no base is provided by the user/developer, use a fallback joined with prefix (/static)
const resolveAssetsBasePath = ({ base, prefix, fallback }) => {
  if (isAbsoluteURL(base)) return base;
  return joinURLPathSegments(prefix, base || fallback);
};

/**
 * Imports a custom element by pathname, bundles it and registers it in the server side custom element
 * registry.
 * In production mode, this happens 1x for each unique filepath after which this function will noop
 * In development mode, every call to this function will yield a fresh version of the custom element being re-registered
 * to the custom element registry.
 * @param {string} filepath
 */
const importComponentForSSR = async (filepath, config, logger) => {
  const NAME = config.get("app.name");
  const DEVELOPMENT = config.get("app.development");
  const TYPE = parse(filepath).name;
  const OUTDIR = join(process.cwd(), "dist", "server");
  // support user defined plugins via a build.js file
  const BUILD_FILEPATH = join(process.cwd(), "build.js");

  const plugins = [];
  if (existsSync(BUILD_FILEPATH)) {
    try {
      const userDefinedBuild = (await import(BUILD_FILEPATH)).default;
      const userDefinedPlugins = await userDefinedBuild({ config });
      if (Array.isArray(userDefinedPlugins)) {
        plugins.unshift(...userDefinedPlugins);
      }
    } catch (err) {
      // noop
    }
  }

  // import cache breaking filename using date string
  const outfile = join(OUTDIR, `${TYPE}.js`);
  if (existsSync(filepath)) {
    try {
      await esbuild.build({
        entryPoints: [filepath],
        bundle: true,
        format: "esm",
        outfile,
        minify: true,
        plugins,
        legalComments: `none`,
        sourcemap: true,
        external: ["lit"],
      });
      // import fresh copy of the custom element
      const Element = (await import(`${outfile}?s=${Date.now()}`)).default;

      // if already defined from a previous request, delete from registry
      if (customElements.get(`${NAME}-${TYPE}`)) {
        // if in production mode and the component has already been defined,
        // no more work is needed, so we bail early
        if (!DEVELOPMENT) return;
        // @ts-ignore
        customElements.__definitions.delete(`${NAME}-${TYPE}`);
      }

      // define newly imported custom element in the registry
      customElements.define(`${NAME}-${TYPE}`, Element);
    } catch (err) {
      logger.error(err);
    }
  }
};

class PodletServerPlugin {
  #config;
  #logger;
  #metrics = new Metrics();
  #metricStreams = [];
  #name;
  #version;
  #pathname;
  #manifest;
  #content;
  #fallback;
  #development;
  #assetsDevelopment;
  #locale;
  #renderMode;
  #grace;
  #timeAllRoutes;
  #groupStatusCodes;
  #assetsBasePath;
  #assetsBasePathMountPoint;
  #modulesBasePath;
  #compression;
  #packageJson;
  #podiumVersion;
  #dsdPolyfill;
  #fastify;
  #podlet;
  #translations;

  /**
   * @type {(req: import('fastify').FastifyRequest, context: any) => Promise<{ [key: string]: any; [key: number]: any; } | null>}
   */
  #contentStateFn = async (req, context) => ({});
  /**
   * @type {(req: import('fastify').FastifyRequest, context: any) => Promise<{ [key: string]: any; [key: number]: any; } | null>}
   */
  #fallbackStateFn = async (req, context) => ({});

  constructor({ config, logger, prefix }) {
    this.#config = config;
    this.#logger = logger;
    this.#name = config.get("app.name");
    this.#version = config.get("podlet.version");
    this.#pathname = config.get("podlet.pathname");
    this.#manifest = config.get("podlet.manifest");
    this.#content = config.get("podlet.content");
    this.#fallback = config.get("podlet.fallback");
    this.#development = config.get("app.development");
    this.#assetsDevelopment = config.get("assets.development");
    this.#locale = config.get("app.locale");
    this.#renderMode = config.get("app.mode");
    this.#grace = config.get("app.grace");
    this.#timeAllRoutes = config.get("metrics.timing.timeAllRoutes");
    this.#groupStatusCodes = config.get("metrics.timing.groupStatusCodes");
    this.#assetsBasePath = resolveAssetsBasePath({ base: config.get("assets.base"), prefix, fallback: "static" });
    this.#assetsBasePathMountPoint = config.get("assets.base") || "/static";
    this.#modulesBasePath = prefix === "/" ? `/node_modules` : `${prefix}/node_modules`;
    this.#compression = config.get("app.compression");
    this.#packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), { encoding: "utf8" }));
    this.#podiumVersion = new SemVer(
      this.#packageJson.dependencies["@podium/podlet"].replace("^", "").replace("~", "")
    );
    this.#dsdPolyfill = readFileSync(new URL("./dsd-polyfill.js", import.meta.url), { encoding: "utf8" });

    this.#podlet = new Podlet({
      name: this.#name,
      version: this.#version,
      pathname: this.#pathname,
      manifest: this.#manifest,
      content: this.#content,
      fallback: this.#fallback,
      development: this.#development,
      logger,
    });

    /**
     * Generate a metric for which major version of the Podium podlet is being run
     * Metric is pushed into the podlet metrics stream which is then collected
     */
    // @ts-ignore
    const gauge = this.#podlet.metrics.gauge({
      name: "active_podlet",
      description: "Indicates if a podlet is mounted and active",
      labels: { podium_version: this.#podiumVersion.major, podlet_name: this.#name },
    });
    setImmediate(() => gauge.set(1));

    // @ts-ignore
    this.#metricStreams.push(this.#podlet.metrics);
  }

  /**
   * @param {(req: import('fastify').FastifyRequest, context: any) => Promise<{ [key: string]: any; [key: number]: any; } | null>} stateFunction
   */
  setContentState(stateFunction) {
    this.#contentStateFn = stateFunction;
  }
  /**
   * @param {(req: import('fastify').FastifyRequest, context: any) => Promise<{ [key: string]: any; [key: number]: any; } | null>} stateFunction
   */
  setFallbackState(stateFunction) {
    this.#fallbackStateFn = stateFunction;
  }

  async hydrate({ reply, template, filepath }) {
    const { name } = parse(filepath);
    reply.type("text/html; charset=utf-8");
    try {
      await importComponentForSSR(filepath, this.#config, this.#logger);
    } catch (err) {
      this.#logger.error(err);
    }

    // user provided markup, SSR'd
    const ssrMarkup = Array.from(ssr(html` ${unsafeHTML(template)} `)).join("");
    // polyfill for browsers that don't support declarative shadow dom
    const polyfillMarkup = `<script>${this.#dsdPolyfill}</script>`;
    // live reload snippet that connects to esbuild server and listens for rebuilds and reloads page.
    const livereloadSnippet = this.#assetsDevelopment
      ? `new EventSource('http://localhost:6935/esbuild').addEventListener('change',()=>location.reload());`
      : "";
    // wrap user provided component in hydration support and live reload snippet and define component in registry
    let clientSideScript;

    if (this.#assetsDevelopment) {
      clientSideScript = `
        <script type="module">
          import '${this.#modulesBasePath}/lit/experimental-hydrate-support.js';
          import El from '${this.#assetsBasePath}/client/${name}.js';
          customElements.define("${this.#name}-${name}",El);
          ${livereloadSnippet}
        </script>
      `;
    } else {
      // in production, all scripts are bundled into a single file
      clientSideScript = `<script type="module" src="${this.#assetsBasePath}/client/${name}.js"></script>`;
    }

    // render final markup
    const markup = this.#podlet.render(reply.app.podium, `${ssrMarkup}${polyfillMarkup}${clientSideScript}`);

    // @ts-ignore
    this.#compression ? reply.compress(markup) : reply.send(markup);
  }

  async ssrOnly({ reply, template, filepath }) {
    reply.type("text/html; charset=utf-8");
    try {
      await importComponentForSSR(filepath, this.#config, this.#logger);
    } catch (err) {
      this.#logger.error(err);
    }

    const ssrMarkup = Array.from(ssr(html` ${unsafeHTML(template)} `)).join("");
    const polyfillMarkup = `<script>${this.#dsdPolyfill}</script>`;
    const markup = this.#podlet.render(reply.app.podium, `${ssrMarkup}${polyfillMarkup}`);

    // @ts-ignore
    this.#compression ? reply.compress(markup) : reply.send(markup);
  }

  async csrOnly({ reply, template, filepath }) {
    reply.type("text/html; charset=utf-8");

    const { name } = parse(filepath);
    reply.type("text/html; charset=utf-8");
    try {
      await importComponentForSSR(filepath, this.#config, this.#logger);
    } catch (err) {
      this.#logger.error(err);
    }

    // live reload snippet that connects to esbuild server and listens for rebuilds and reloads page.
    const livereloadSnippet = this.#assetsDevelopment
      ? `new EventSource('http://localhost:6935/esbuild').addEventListener('change',()=>location.reload());`
      : "";
    // wrap user provided component in hydration support and live reload snippet and define component in registry
    let clientSideScript;

    if (this.#assetsDevelopment) {
      clientSideScript = `
        <script type="module">
          import El from '${this.#assetsBasePath}/client/${name}.js';
          customElements.define("${this.#name}-${name}",El);
          ${livereloadSnippet}
        </script>
      `;
    } else {
      // in production, all scripts are bundled into a single file
      clientSideScript = `<script type="module" src="${this.#assetsBasePath}/client/${name}.js"></script>`;
    }

    // render final markup
    const markup = this.#podlet.render(reply.app.podium, `${template}${clientSideScript}`);

    // @ts-ignore
    this.#compression ? reply.compress(markup) : reply.send(markup);
  }

  async manifestRoute() {
    this.#fastify.get(this.#podlet.manifest(), async (req, reply) => {
      // enable timing metrics for this route
      reply.context.config.timing = true;
      return JSON.stringify(this.#podlet);
    });
  }

  /**
   * Read in localisation files using locale config
   * Empty string as default if matching translation file does not exist
   */
  translations() {
    const localFilePath = join(process.cwd(), "locale", this.#locale) + ".json";
    if (existsSync(localFilePath)) {
      try {
        const translation = JSON.parse(readFileSync(localFilePath, { encoding: "utf8" }));
        this.#translations = ` translations='${JSON.stringify(translation)}'`;
      } catch (err) {
        this.#logger.error(`Error reading translation file: ${localFilePath}`, err);
      }
    }
  }

  /**
   * Sets up AJV validation for routes.
   * If a schema is not provided for a route, query, params and header values will be stripped
   */
  validation() {
    const schemaCompilers = {
      body: new Ajv({
        removeAdditional: "all",
        coerceTypes: false,
        allErrors: true,
      }),
      params: new Ajv({
        removeAdditional: "all",
        coerceTypes: true,
        allErrors: true,
      }),
      querystring: new Ajv({
        removeAdditional: "all",
        coerceTypes: true,
        allErrors: true,
      }),
      headers: new Ajv({
        removeAdditional: "all",
        coerceTypes: true,
        allErrors: true,
      }),
    };

    this.#fastify.setValidatorCompiler((req) => {
      if (!req.httpPart) {
        throw new Error("Missing httpPart");
      }
      const compiler = schemaCompilers[req.httpPart];
      if (!compiler) {
        throw new Error(`Missing compiler for ${req.httpPart}`);
      }
      return compiler.compile(req.schema);
    });
  }

  get schemaDefaults() {
    return {
      headers: {
        "podium-debug": { type: "boolean" },
        "podium-locale": { type: "string", pattern: "^([a-z]{2})(-[A-Z]{2})?$" },
        "podium-device-type": { enum: ["desktop", "mobile"] },
        "podium-requested-by": { type: "string" },
        "podium-mount-origin": {
          type: "string",
          pattern:
            "^(?=.{1,255}$)[0-9A-Za-z](?:(?:[0-9A-Za-z]|-){0,61}[0-9A-Za-z])?(?:.[0-9A-Za-z](?:(?:[0-9A-Za-z]|-){0,61}[0-9A-Za-z])?)*.?$",
        },
        "podium-mount-pathname": { type: "string", pattern: "^/[/.a-zA-Z0-9-]+$" },
        "podium-public-pathname": { type: "string", pattern: "^/[/.a-zA-Z0-9-]+$" },
        "accept-encoding": { type: "string" },
      },
      querystring: {},
      params: {},
    };
  }

  /**
   * Sets up a content route if needed.
   * Detects the presence of content.js or content.ts and if so, sets up the route.
   * A schema content file is also checked for at schemas/content and if found is used for validation
   * of things like query params and so on. See fastify route schemas for more details.
   *
   * Route uses the apps render mode (ssr, hydrate or csr) to determine how to render the content.
   *
   * The actual content to render is the custom element markup with additional properties for locale, initial state etc.
   */
  async contentRoute() {
    const CONTENT_PATH = await resolve(join(process.cwd(), "content.js"));
    const CONTENT_SCHEMA_PATH = await resolve(join(process.cwd(), "schemas/content.js"));

    if (existsSync(CONTENT_PATH)) {
      // register user defined validation schema for route if provided
      // looks for a file named schemas/content.js and if present, imports
      // and provides to route.
      const contentOptions = { schema: this.schemaDefaults };
      if (existsSync(CONTENT_SCHEMA_PATH)) {
        const userSchema = (await import(CONTENT_SCHEMA_PATH)).default;
        merge(contentOptions.schema, userSchema);
      }

      // builds content route path out of root + app name + the content path value in the podlet manifest
      // by default this will be / + folder name + / eg. /my-podlet/
      // content route
      this.#fastify.get(this.#podlet.content(), contentOptions, async (req, reply) => {
        // enable timing metrics for this route
        reply.context.config.timing = true;

        const initialState = JSON.stringify(
          // @ts-ignore
          (await this.#contentStateFn(req, reply.app.podium.context)) || ""
        );

        const template = `<${this.#name}-content version="${this.#version}" locale='${this.#locale}'${
          this.#translations
        } initial-state='${initialState}'></${this.#name}-content>`;

        switch (this.#renderMode) {
          case renderModes.SSR_ONLY:
            // @ts-ignore
            await this.ssrOnly({ reply, template, filepath: CONTENT_PATH });
            break;
          case renderModes.CSR_ONLY:
            // @ts-ignore
            await this.csrOnly({ reply, template, filepath: CONTENT_PATH });
            break;
          case renderModes.HYDRATE:
            // @ts-ignore
            await this.hydrate({ reply, template, filepath: CONTENT_PATH });
            break;
        }
        return reply;
      });
    }
  }

  /**
   * Sets up a fallback route if needed.
   * Detects the presence of fallback.js or fallback.ts and if so, sets up the route.
   * A schema fallback file is also checked for at schemas/fallback and if found is used for validation
   * of things like query params and so on. See fastify route schemas for more details.
   *
   * Route uses the apps render mode (ssr, hydrate or csr) to determine how to render the content.
   *
   * The actual content to render is the custom element markup with additional properties for locale, initial state etc.
   */
  async fallbackRoute() {
    const FALLBACK_PATH = await resolve(join(process.cwd(), "fallback.js"));
    const FALLBACK_SCHEMA_PATH = await resolve(join(process.cwd(), "schemas/fallback.js"));
    if (existsSync(FALLBACK_PATH)) {
      // register user defined validation schema for route if provided
      // looks for a file named schemas/fallback.js and if present, imports
      // and provides to route.
      const fallbackOptions = { schema: {} };
      if (existsSync(FALLBACK_SCHEMA_PATH)) {
        const userSchema = (await import(FALLBACK_SCHEMA_PATH)).default;
        fallbackOptions.schema = merge(this.schemaDefaults, userSchema);
      }

      // builds fallback route path out of root + app name + the fallback path value in the podlet manifest
      // by default this will be / + folder name + /fallback eg. /my-podlet/fallback
      // fallback route
      this.#fastify.get(this.#podlet.fallback(), fallbackOptions, async (req, reply) => {
        // enable timing metrics for this route
        reply.context.config.timing = true;

        const initialState = JSON.stringify(
          // @ts-ignore
          (await this.#fallbackStateFn(req, reply.app.podium.context)) || ""
        );
        const template = `<${this.#name}-fallback version="${this.#version}" locale='${this.#locale}'${
          this.#translations
        } initial-state='${initialState}'></${this.#name}-fallback>`;
        switch (this.#renderMode) {
          case renderModes.SSR_ONLY:
            // @ts-ignore
            await this.ssrOnly({ reply, template, filepath: FALLBACK_PATH });
            break;
          case renderModes.CSR_ONLY:
            // @ts-ignore
            await this.csrOnly({ reply, template, filepath: FALLBACK_PATH });
            break;
          case renderModes.HYDRATE:
            // @ts-ignore
            await this.hydrate({ reply, template, filepath: FALLBACK_PATH });
            break;
        }
        return reply;
      });
    }
  }

  /**
   * Development feature that bundles and serves client side dependencies on the fly, caching build between requests.
   * Deps can be requested via /node_modules/{dependency name}
   *
   * eg. /node_modules/lit/experimental-hydration-support.js
   */
  async dependenciesRoute() {
    if (this.#assetsDevelopment) {
      const cache = new Map();
      this.#fastify.get("/node_modules/*", async (request, reply) => {
        reply.type("application/javascript");
        const depname = request.params["*"];
        if (!cache.has(depname)) {
          const filepath = require.resolve(depname);
          const outdir = join(process.cwd(), "dist", "server");
          const outfile = join(outdir, depname);
          await esbuild.build({
            entryPoints: [filepath],
            bundle: true,
            format: "esm",
            outfile,
            minify: true,
            sourcemap: false,
          });
          const contents = await readFile(outfile, { encoding: "utf8" });
          cache.set(depname, contents);
        }
        reply.send(cache.get(depname));
        // fastify compress needs us to return reply to avoid early stream termination
        return reply;
      });
    }
  }

  /**
   * Custom http error handler.
   * Takes http-errors into account when constructing which http error to serve.
   */
  async errorHandler() {
    this.#fastify.setErrorHandler((error, request, reply) => {
      this.#logger.error(error);

      let err;

      // check if we have a validation error
      if (error.validation) {
        err = new httpError.BadRequest(`A validation error occurred when validating the ${error.validationContext}`);
        err.errors = error.validation;
        // validationContext will be 'body' or 'params' or 'headers' or 'query'
        // reply.status(400).send({
        //   statusCode: 400,
        //   message: `A validation error occurred when validating the ${error.validationContext}...`,
        //   errors: error.validation,
        // });
        // return reply;
      } else {
        err = httpError.isHttpError(error) ? error : new httpError.InternalServerError();

        if (err.headers) {
          for (const key in err.headers) {
            reply.header(key, err.headers[key]);
          }
        }
      }

      reply.status(err.status).send({
        statusCode: err.statusCode,
        message: err.expose ? err.message : "",
        errors: err.errors || undefined,
      });
    });
  }

  /**
   * Serve all assets in the dist folder when an absolute assets.base value is not present.
   * Files are built into the dist folder by either the podlet-dev command or the podlet-build command
   */
  async serveAssets() {
    if (!isAbsoluteURL(this.#assetsBasePath)) {
      this.#fastify.register(fastifyStatic, {
        root: join(process.cwd(), "dist"),
        prefix: this.#assetsBasePathMountPoint,
      });
    }
  }

  /**
   * Compression is included because until we resolve an issue with the layout client,
   * we need to ensure payloads are relatively small so as not to have the client error.
   */
  async compression() {
    if (this.#compression) {
      await this.#fastify.register(compress, { global: true });
    }
  }

  /**
   * Register process exception handlers middleware/plugin
   * This handles graceful shutdown. In dev mode, grace time is 0 so stopping the server should
   * happen instantly while in prod we want it to wait for connections to end before shutdown
   * so the grace period tends to be set to a few seconds.
   */
  async processExceptionHandlers() {
    const procExp = new ProcessExceptionHandlers(this.#logger);
    procExp.closeOnExit(this.#fastify, { grace: this.#grace });
    this.#metricStreams.push(procExp.metrics);
  }

  /**
   * Config getter
   */
  get config() {
    return this.#config;
  }

  /**
   * Metrics object getter
   */
  get metrics() {
    return this.#metrics;
  }

  /**
   * Podlet object getter
   */
  get podlet() {
    return this.#podlet;
  }

  /**
   * We register the Podium podlet Fastify plugin here and pass it the podlet
   * and then collect the metrics
   */
  podletPlugin() {
    // @ts-ignore
    this.#fastify.register(fastifyPodletPlugin, this.#podlet);
  }

  /**
   * Sets up response timing metrics which hooks into Fastify via a plugin and exposes
   * metrics via a stream which we then gather up into this.#metricStreams
   */
  timingMetrics() {
    const responseTiming = new ResponseTiming({
      timeAllRoutes: this.#timeAllRoutes,
      groupStatusCodes: this.#groupStatusCodes,
    });
    this.#fastify.register(responseTiming.plugin());
    this.#metricStreams.push(responseTiming.metrics);
  }

  /**
   * Sets up metric stream processing. Must be called at the end after other modules have
   * had a chance to push metric stream objects into this.#metricStreams after which
   * we gather up these streams and pipe them altogether and expose a single metric object
   * to be used externally for consumption
   */
  metricStreams() {
    /**
     * Collect up all metrics and expose on a .metrics property of the fastify instance
     * which can then be piped into a consumer in server.js
     */
    for (const stream of this.#metricStreams) {
      stream.on("error", (err) => {
        this.#logger.error(err);
      });
      stream.pipe(this.#metrics);
    }
  }

  /**
   * Sets up and returns a fastify plugin with everything necessary for a running app.
   * @returns {import("fastify").FastifyPluginAsync}
   */
  plugin() {
    // return plugin
    return async (fastify) => {
      this.#fastify = fastify;

      this.podletPlugin();
      await this.manifestRoute();
      this.translations();
      await this.compression();
      await this.processExceptionHandlers();
      this.timingMetrics();
      this.validation();

      if (this.#config.get("app.component")) {
        await this.contentRoute();
        await this.fallbackRoute();
        await this.dependenciesRoute();
        await this.serveAssets();
      }

      await this.errorHandler();

      this.metricStreams();
    };
  }
}

export default fp(async function (fastify, { config }) {
  const prefix = config.get("app.base") || "/";
  const podletServer = new PodletServerPlugin({ config, logger: fastify.log, prefix });

  fastify.register(podletServer.plugin(), { prefix });

  // Expose developer facing APIs using decorate
  fastify.decorate("setContentState", podletServer.setContentState.bind(podletServer));
  fastify.decorate("setFallbackState", podletServer.setFallbackState.bind(podletServer));
  fastify.decorate("config", podletServer.config);
  fastify.decorate("podlet", podletServer.podlet);
  fastify.decorate("metrics", podletServer.metrics);
});
