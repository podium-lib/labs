import { existsSync } from "node:fs";
import { join } from "node:path";
import fastify from "fastify";
import httpError from "http-errors";
import fastifyPodletPlugin from "../lib/fastify-podlet-plugin.js";

export async function start({ config, cwd = process.cwd() }) {
  const app = fastify({ logger: true, ignoreTrailingSlash: true });
  app.register(fastifyPodletPlugin, { prefix: config.get("app.base"), config });

  /** @type {any} */
  let fastifyApp = app;
  /** @type {import("@podium/podlet").default} */
  const podlet = fastifyApp.podlet;

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
