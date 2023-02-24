#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import fastify from "fastify";
import fastifyPodletPlugin from "../lib/fastify-podlet-plugin.js";
import config from "../lib/config.js";

const app = fastify({ logger: true, ignoreTrailingSlash: true });

app.register(fastifyPodletPlugin, { config });

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
