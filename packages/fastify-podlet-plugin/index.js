import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Podlet from "@podium/podlet";
// import compress from '@fastify/compress';
// @ts-ignore
import fastifyPodletPlugin from "@podium/fastify-podlet";
import { render as ssr } from "@lit-labs/ssr";
import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { fastifyStatic } from "@fastify/static";
// @ts-ignore
import EikClient from "@eik/node-client";
import fp from "fastify-plugin";
// @ts-ignore
import ResponseTiming from "fastify-metrics-js-response-timing";
// @ts-ignore
import ProcessExceptionHandlers from "@finn-no/process-exception-handlers";

/**
 * TODO:
 * - user token middleware (existing but...) how do we handle multiple marketplaces?
 * - logging
 * - process exception handlers (existing)
 * - timing (existing)
 */

const renderModes = {
  SSR_ONLY: "ssr-only",
  CSR_ONLY: "csr-only",
  HYDRATE: "hydrate",
};

const defaults = {
  grace: 4000,
  processExceptionHandlers: true,
  readyChecks: {
    ready: true,
    livePathname: "/_/health",
    readyPathname: "/_/ready",
  },
  token: {
    env: "dev",
    admin: false,
    backoffice: false,
    ttl: 60,
    host: "thrift.svc.dev.finn.no:7100",
  },
  timing: {
    timeAllRoutes: false,
    groupStatusCodes: true,
  },
  renderMode: "hydrate",
};

/**
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{
 *  name: string;
 *  version: string;
 *  pathname: string;
 *  content: string;
 *  manifest: string;
 *  fallback: string;
 *  development: boolean;
 *  grace: number,
 *  component: boolean;
 *  renderMode: string;
 *  timing: { timeAllRoutes: boolean, groupStatusCodes: boolean }
 * }} opts
 */
const plugin = async function nmpPlugin(fastify, opts) {
  const { processExceptionHandlers, renderMode } = {
    ...defaults,
    ...opts,
  };
  const grace = opts.grace ? opts.grace : opts.development ? 0 : defaults.grace;
  // @ts-ignore
  // const token = { ...defaults.token, ...opts.token };
  const timing = { ...defaults.timing, ...opts.timing };

  const metricStreams = [];

  const dsdPolyfill = readFileSync(
    join(process.cwd(), "dist", "dsd-polyfill.js")
  );
  const podlet = new Podlet({
    name: opts.name,
    version: opts.version,
    pathname: opts.pathname,
    manifest: opts.manifest,
    content: opts.content,
    fallback: opts.fallback,
    development: opts.development,
    logger: fastify.log,
  });

  fastify.decorate("podlet", podlet);
  fastify.decorate("proxy", podlet.proxy.bind(podlet));

  if (existsSync(join(process.cwd(), "content.js"))) {
    await import(join(process.cwd(), "dist", "server", "content.js"));
  }
  if (existsSync(join(process.cwd(), "fallback.js"))) {
    await import(join(process.cwd(), "dist", "server", "fallback.js"));
  }

  const eik = new EikClient({
    development: opts.development,
    base: "/static",
  });

  fastify.decorate("eik", eik);

  // await fastify.register(compress, { global: true });

  if (opts.development) {
    fastify.register(fastifyStatic, {
      root: join(process.cwd(), "dist"),
      prefix: "/static/",
    });
  }

  if (processExceptionHandlers) {
    const procExp = new ProcessExceptionHandlers(fastify.log);
    procExp.closeOnExit(fastify, { grace });
    metricStreams.push(procExp.metrics);
  }

  // @ts-ignore
  fastify.register(fastifyPodletPlugin, podlet);
  // @ts-ignore
  metricStreams.push(podlet.metrics);

  // @ts-ignore
  const gauge = podlet.metrics.gauge({
    name: "active_podlet",
    description: "Indicates if a podlet is mounted and active",
    // TODO: read this value from podium package.json
    labels: { podium_version: 4, podlet_name: opts.name },
  });
  setImmediate(() => gauge.set(1));

  // manifest route
  // @ts-ignore
  fastify.get(
    join("/", opts.name || "", podlet.manifest()),
    async (req, reply) => {
      return JSON.stringify(podlet);
    }
  );

  if (timing) {
    const responseTiming = new ResponseTiming(timing);
    fastify.register(responseTiming.plugin());
    metricStreams.push(responseTiming.metrics);
  }

  if (!opts.component) return;

  /**
   * setContentState function
   *
   * Use this function to pass values to both server side and client side components.
   * This function will passed the Fastify request object as a first param and the Podium context as a second.
   * Values set with this function will be available in the render hook of the content.js content custom element component via
   * `this.getInitialState();`
   * @example
   *  ```
   *  // in server.js
   *  export default async function server(app) {
   *    app.setFallbackState(async (req, context) => {
   *      // fetch database values or other api sources here and return below
   *      return {
   *        val1: "foo",
   *        val2: "bar",
   *      };
   *    });
   *  }
   *
   *  // in content.js
   *  class Content extends NmpElement {
   *    render() {
   *      // available on both server and client side.
   *      const { val1, val2 } = this.getInitialState();
   *      return html`<div>${val1}${val2}</div>`
   *    }
   *  }
   * ```
   * @param {import('fastify').FastifyRequest} req
   * @param {any} context
   * @returns {Promise<{ [key: string]: any; [key: number]: any; } | null>}
   */
  let setContentState = async (req, context) => ({});

  fastify.decorate(
    "setContentState",
    /**
     * @param {(req: import('fastify').FastifyRequest, context: any) => Promise<{ [key: string]: any; [key: number]: any; } | null>} stateFunction
     */
    (stateFunction) => {
      setContentState = stateFunction;
    }
  );

  /**
   * setFallbackState function
   *
   * Use this function to pass values to both server side and client side components.
   * Fallbacks are cached and therefore cannot gain access to the request object or the Podium context.
   * Values set with this function will be available in the render hook of the fallback.js fallback custom element component via
   * `this.getInitialState();`
   * @example
   *  ```
   *  // in server.js
   *  export default async function server(app) {
   *    app.setFallbackState(async () => {
   *      return {
   *        val1: "foo",
   *        val2: "bar",
   *      };
   *    });
   *  }
   *
   *  // in fallback.js
   *  class Fallback extends NmpElement {
   *    render() {
   *      // available on both server and client side.
   *      const { val1, val2 } = this.getInitialState();
   *      return html`<div>${val1}${val2}</div>`
   *    }
   *  }
   * ```
   * @param {import('fastify').FastifyRequest} req
   * @param {any} context
   * @returns {Promise<{ [key: string]: any; [key: number]: any; } | null>}
   */
  let setFallbackState = async (req, context) => ({});
  fastify.decorate(
    "setFallbackState",
    /**
     * @param {(req: import('fastify').FastifyRequest, context: any) => Promise<{ [key: string]: any; [key: number]: any; } | null>} stateFunction
     */
    (stateFunction) => {
      setFallbackState = stateFunction;
    }
  );

  fastify.decorateReply("hydrate", function hydrate(template, file) {
    this.type("text/html");
    const markup = Array.from(ssr(html`${unsafeHTML(template)}`)).join("");
    // @ts-ignore
    this.podiumSend(
      `${markup}<script>${dsdPolyfill}</script><script type="module" src="${
        eik.file("/hydrate-support.js").value
      }"></script><script type="module" src="${
        eik.file(`/client/${file}`).value
      }"></script>`
    );
  });

  fastify.decorateReply("ssrOnly", function ssrOnly(template) {
    this.type("text/html");
    const markup = Array.from(ssr(html`${unsafeHTML(template)}`)).join("");
    // @ts-ignore
    this.podiumSend(`${markup}<script>${dsdPolyfill}</script>`);
  });

  fastify.decorateReply("csrOnly", function csrOnly(template, file) {
    this.type("text/html");
    // @ts-ignore
    this.podiumSend(
      `${template}<script type="module" src="${
        eik.file(`/client/${file}`).value
      }"></script>`
    );
  });

  if (existsSync(join(process.cwd(), "content.js"))) {
    const contentOptions = {};
    if (existsSync(join(process.cwd(), "schemas/content.js"))) {
      contentOptions.schema = (
        await import(join(process.cwd(), "schemas/content.js"))
      ).default;
    }

    // content route
    fastify.get(
      join("/", opts.name || "", podlet.content()),
      contentOptions,
      async (req, reply) => {
        const initialState = JSON.stringify(
          // @ts-ignore
          (await setContentState(req, reply.app.podium.context)) || ""
        );
        const template = `<${opts.name}-content initial-state='${initialState}'></${opts.name}-content>`;

        switch (renderMode) {
          case renderModes.SSR_ONLY:
            // @ts-ignore
            reply.ssrOnly(template);
            break;
          case renderModes.CSR_ONLY:
            // @ts-ignore
            reply.csrOnly(template, "content.js");
            break;
          case renderModes.HYDRATE:
            // @ts-ignore
            reply.hydrate(template, "content.js");
            break;
        }
      }
    );
  }

  if (existsSync(join(process.cwd(), "fallback.js"))) {
    const fallbackOptions = {};
    if (existsSync(join(process.cwd(), "schemas/fallback.js"))) {
      fallbackOptions.schema = (
        await import(join(process.cwd(), "schemas/fallback.js"))
      ).default;
    }

    // fallback route
    // @ts-ignore
    fastify.get(
      join("/", opts.name || "", podlet.fallback()),
      fallbackOptions,
      async (req, reply) => {
        const initialState = JSON.stringify(
          // @ts-ignore
          (await setFallbackState(req, reply.app.podium.context)) || ""
        );
        const template = `<${opts.name}-fallback initial-state='${initialState}'></${opts.name}-fallback>`;
        switch (renderMode) {
          case renderModes.SSR_ONLY:
            // @ts-ignore
            reply.ssrOnly(template);
            break;
          case renderModes.CSR_ONLY:
            // @ts-ignore
            reply.csrOnly(template, "fallback.js");
            break;
          case renderModes.HYDRATE:
            // @ts-ignore
            reply.hydrate(template, "fallback.js");
            break;
        }
      }
    );
  }
};

const fastifyPodletPlugin = fp(plugin);
export { fastifyPodletPlugin };
