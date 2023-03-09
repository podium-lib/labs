import { join } from "node:path";
import fp from "fastify-plugin";
import resolve from "./resolve.js";
import { existsSync } from "node:fs";

// plugins
import assets from "../plugins/assets.js";
import compression from "../plugins/compression.js";
import dependencies from "../plugins/dependencies.js";
import errors from "../plugins/errors.js";
import exceptions from "../plugins/exceptions.js";
import hydrate from "../plugins/hydrate.js";
import importElement from "../plugins/import-element.js";
import liveReload from "../plugins/live-reload.js";
import localePn from "../plugins/locale.js";
import metricsPn from "../plugins/metrics.js";
import podletPn from "../plugins/podlet.js";
import script from "../plugins/script.js";
import timing from "../plugins/timing.js";
import validation from "../plugins/validation.js";
import lazyPn from "../plugins/lazy.js";
import scriptsPn from "../plugins/scripts.js";
import ssrPn from "../plugins/ssr.js";
import csrPn from "../plugins/csr.js";

const isAbsoluteURL = (pathOrUrl) => {
  const url = new URL(pathOrUrl, "http://local");
  if (url.origin !== "http://local") return true;
  return false;
};

const joinURLPathSegments = (...segments) => {
  return segments.join("/").replace(/[\/]+/g, "/");
};

const defaults = {
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

/**
 * create an intersection type out of fastify instance and its decorated properties
 * @typedef {import("fastify").FastifyInstance & { podlet: any, metrics: any, importElement: function, translations: object, script: function, hydrate: function, ssr: function, csr: function }} FastifyInstance
 */

/**
 * create an intersection type out of fastify context config and its decorated properties
 * @typedef {import("fastify").FastifyContextConfig & { timing: boolean }} FastifyContextConfig
 */

export default fp(async function (fastify, { config, cwd = process.cwd() }) {
  const prefix = config.get("app.base") || "/";
  const base = config.get("assets.base");
  const assetBase = isAbsoluteURL(base) ? base : joinURLPathSegments(prefix, base);
  const name = config.get("app.name");
  const development = config.get("app.development");
  const version = config.get("podlet.version");
  const locale = config.get("app.locale");
  const contentFilePath = await resolve(join(process.cwd(), "./content.js"));
  const fallbackFilePath = await resolve(join(process.cwd(), "./fallback.js"));

  // read from build.js
  const BUILD_FILEPATH = join(cwd, "build.js");

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
  let podlet;
  let metrics;
  /** @type {stateFunction} */
  let contentStateFn = async (req, context) => ({});
  /** @type {stateFunction} */
  let fallbackStateFn = async (req, context) => ({});

  // wrap in scoped plugin for prefixed routes to work
  fastify.register(
    async (fastify) => {
      // cast fastify to include decorated properties
      const f = /** @type {FastifyInstance} */ (fastify);

      // load plugins

      await f.register(podletPn, {
        name,
        version,
        pathname: config.get("podlet.pathname"),
        manifest: config.get("podlet.manifest"),
        content: config.get("podlet.content"),
        fallback: config.get("podlet.fallback"),
        development,
      });
      await f.register(lazyPn, { enabled: config.get("assets.lazy"), base: assetBase });
      await f.register(scriptsPn, { enabled: config.get("assets.scripts"), base: assetBase });
      await f.register(liveReload, { development });
      await f.register(compression, { enabled: config.get("app.compression") });
      await f.register(assets, { base, cwd });
      await f.register(dependencies, { enabled: development, cwd });
      await f.register(errors);
      await f.register(exceptions, { grace: config.get("app.grace") });
      await f.register(hydrate, { appName: config.get("app.name"), base: assetBase, development });
      await f.register(csrPn, { appName: config.get("app.name"), base: assetBase, development });
      await f.register(ssrPn);
      await f.register(importElement, { appName: name, development, plugins, cwd });
      await f.register(localePn, { locale, cwd });
      await f.register(metricsPn);
      await f.register(script, { development });
      await f.register(timing, {
        timeAllRoutes: config.get("metrics.timing.timeAllRoutes"),
        groupStatusCodes: config.get("metrics.timing.groupStatusCodes"),
      });
      await f.register(validation, { prefix, defaults, mappings: { "/": "content.json" }, cwd });

      // routes

      if (existsSync(contentFilePath)) {
        f.get(f.podlet.content(), async (request, reply) => {
          const contextConfig = /** @type {FastifyContextConfig} */ (reply.context.config);
          contextConfig.timing = true;

          if (config.get("app.mode") === "ssr-only" || config.get("app.mode") === "hydrate") {
            // import server side component
            await f.importElement(contentFilePath);
          }

          const initialState = JSON.stringify(
            // @ts-ignore
            (await contentStateFn(request, reply.app.podium.context)) || ""
          );

          const translations = f.translations ? ` translations='${JSON.stringify(f.translations)}'` : "";
          const template = `<${name}-content version="${version}" locale='${locale}'${translations} initial-state='${initialState}'></${name}-content>`;
          const hydrateSupport =
            config.get("app.mode") === "ssr-only" || config.get("app.mode") === "hydrate"
              ? f.script(`${prefix}/node_modules/lit/experimental-hydrate-support.js`, { dev: true })
              : "";
          const markup =
            config.get("app.mode") === "ssr-only"
              ? f.ssr(template)
              : config.get("app.mode") === "csr-only"
              ? f.csr("content", template)
              : f.hydrate("content", template);

          reply.type("text/html; charset=utf-8").send(`${hydrateSupport}${markup}`);

          // TODO: Wire up CSR and SSR Only

          return reply;
        });
      }

      if (existsSync(fallbackFilePath)) {
        f.get(f.podlet.fallback(), async (request, reply) => {
          const contextConfig = /** @type {FastifyContextConfig} */ (reply.context.config);
          contextConfig.timing = true;

          if (config.get("app.mode") === "ssr-only" || config.get("app.mode") === "hydrate") {
            // import server side component
            await f.importElement(fallbackFilePath);
          }

          const initialState = JSON.stringify(
            // @ts-ignore
            (await fallbackStateFn(request, reply.app.podium.context)) || ""
          );

          const translations = f.translations ? ` translations='${JSON.stringify(f.translations)}'` : "";
          const template = `<${name}-fallback version="${version}" locale='${locale}'${translations} initial-state='${initialState}'></${name}-fallback>`;
          const hydrateSupport =
            config.get("app.mode") === "ssr-only" || config.get("app.mode") === "hydrate"
              ? f.script(`${prefix}/node_modules/lit/experimental-hydrate-support.js`, { dev: true })
              : "";
          const markup =
            config.get("app.mode") === "ssr-only"
              ? f.ssr(template)
              : config.get("app.mode") === "csr-only"
              ? f.csr("fallback", template)
              : f.hydrate("fallback", template);

          reply.type("text/html; charset=utf-8").send(`${hydrateSupport}${markup}`);

          return reply;
        });
      }

      // expose decorators to outer plugin wrapper

      podlet = f.podlet;
      metrics = f.metrics;
    },
    { prefix }
  );

  // Expose developer facing APIs using decorate
  /**
   * @typedef {(req: import('fastify').FastifyRequest, context: any) => Promise<{ [key: string]: any; [key: number]: any; } | null>} stateFunction
   */

  /**
   * @param {stateFunction} stateFunction
   */
  function setContentState(stateFunction) {
    contentStateFn = stateFunction;
  }

  /**
   * @param {stateFunction} stateFunction
   */
  function setFallbackState(stateFunction) {
    fallbackStateFn = stateFunction;
  }

  fastify.decorate("setContentState", setContentState);
  fastify.decorate("setFallbackState", setFallbackState);
  fastify.decorate("config", config);
  fastify.decorate("podlet", podlet);
  fastify.decorate("metrics", metrics);
});
