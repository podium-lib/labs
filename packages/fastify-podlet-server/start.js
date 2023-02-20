#!/usr/bin/env node

// @ts-nocheck
/* eslint-disable no-console */
import { join } from "node:path";
import fastify from "fastify";
import fastifyPodletPlugin from "./lib/fastify-podlet-plugin.js";
import config from "./config.js";
import { existsSync } from "node:fs";

const app = fastify({ logger: true, ignoreTrailingSlash: true });
app.register(fastifyPodletPlugin, {
  name: config.get("app.name"),
  version: config.get("podlet.version"),
  pathname: config.get("podlet.pathname"),
  manifest: config.get("podlet.manifest"),
  content: config.get("podlet.content"),
  fallback: config.get("podlet.fallback"),
  development: config.get("app.development"),
  component: config.get("app.component"),
  mode: config.get("app.mode"),
});

const serverFilePath = join(process.cwd(), "server.js");
if (existsSync(serverFilePath)) {
  const server = (await import(serverFilePath)).default;
  app.register(server, { config, podlet: app.podlet, eik: app.eik });
}

app.listen({ port: config.get("app.port") });
