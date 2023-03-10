import { existsSync } from "node:fs";
import { join } from "node:path";
import fastify from "fastify";
import httpError from "http-errors";
import fastifyPodletPlugin from "../lib/fastify-podlet-plugin.js";

/**
 * @typedef {import("fastify").FastifyInstance & { podlet: import("@podium/podlet").default }} FastifyInstance
 */

export async function start({ config, cwd = process.cwd() }) {
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

  const app = /** @type {FastifyInstance}*/ (
    /**@type {unknown}*/ (fastify({ logger: true, ignoreTrailingSlash: true }))
  );
  app.register(fastifyPodletPlugin, {
    prefix: config.get("app.base") || "/",
    pathname: config.get("podlet.pathname"),
    manifest: config.get("podlet.manifest"),
    content: config.get("podlet.content"),
    fallback: config.get("podlet.fallback"),
    base: config.get("assets.base"),
    plugins,
    name: config.get("app.name"),
    development: config.get("app.development"),
    version: config.get("podlet.version"),
    locale: config.get("app.locale"),
    lazy: config.get("assets.lazy"),
    scripts: config.get("assets.scripts"),
    compression: config.get("app.compression"),
    grace: config.get("app.grace"),
    timeAllRoutes: config.get("metrics.timing.timeAllRoutes"),
    groupStatusCodes: config.get("metrics.timing.groupStatusCodes"),
    mode: config.get("app.mode"),
  });

  const { podlet } = app;

  // Load user server.js file if provided.
  const serverFilePath = join(cwd, "server.js");
  if (existsSync(serverFilePath)) {
    const server = (await import(serverFilePath)).default;
    app.register(server, { prefix: config.get("app.base"), logger: app.log, config, podlet, errors: httpError });
  }

  try {
    await app.listen({ port: config.get("app.port") });
  } catch (err) {
    console.log(err);
  }
}
