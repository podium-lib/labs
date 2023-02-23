#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import fastify from "fastify";
import fastifyPodletPlugin from "../lib/fastify-podlet-plugin.js";
import config from "../lib/config.js";

const app = fastify({ logger: true, ignoreTrailingSlash: true });

app.register(fastifyPodletPlugin, {
  name: /** @type {string} */ (/** @type {unknown} */ (config.get("app.name"))),
  version: config.get("podlet.version"),
  pathname: config.get("podlet.pathname"),
  manifest: config.get("podlet.manifest"),
  content: config.get("podlet.content"),
  fallback: config.get("podlet.fallback"),
  development: config.get("app.development"),
  component: config.get("app.component"),
  renderMode: config.get("app.mode"),
  grace: config.get("app.grace")
});

/** @type {any} */
let fastifyApp = app;
/** @type {import("@podium/podlet").default} */
const podlet = fastifyApp.podlet;
/** @type {import("@eik/node-client")} */
const eik = fastifyApp.eik;

// Load user server.js file if provided.
const serverFilePath = join(process.cwd(), "server.js");
if (existsSync(serverFilePath)) {
  const server = (await import(serverFilePath)).default;
  app.register(server, { config, podlet, eik });
}

app.listen({ port: config.get("app.port") });
