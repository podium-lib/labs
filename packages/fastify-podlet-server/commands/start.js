#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import fastify from "fastify";
import fastifyPodletPlugin from "../lib/fastify-podlet-plugin.js";
import config from "../lib/config.js";

const app = fastify({ logger: true, ignoreTrailingSlash: true });

app.register(fastifyPodletPlugin, { prefix: config.get("app.base"), config });

/** @type {any} */
let fastifyApp = app;
/** @type {import("@podium/podlet").default} */
const podlet = fastifyApp.podlet;

// Load user server.js file if provided.
const serverFilePath = join(process.cwd(), "server.js");
if (existsSync(serverFilePath)) {
  const server = (await import(serverFilePath)).default;
  app.register(server, { prefix: config.get("app.base"), logger: app.log, config, podlet });
}

try {
await app.listen({ port: config.get("app.port") });
} catch(err) {
  console.log(err)
}
