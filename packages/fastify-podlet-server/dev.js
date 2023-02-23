#!/usr/bin/env node

// @ts-nocheck
import { existsSync } from "node:fs";
import chokidar from "chokidar";
import fastify from "fastify";
import { context } from "esbuild";
import { join } from "node:path";
import { minifyHTMLLiteralsPlugin } from "esbuild-plugin-minify-html-literals";
import pino from "pino";
import config from "./config.js";
import fastifyPodletPlugin from "./lib/fastify-podlet-plugin.js";
import wrapComponentsPlugin from "./lib/esbuild-wrap-components-plugin.js";

const LOGGER = pino({
  transport: {
    target: "pino-pretty",
    options: {
      translateTime: "HH:MM:ss Z",
      ignore: "pid,hostname",
    },
  },
});
const CWD = process.cwd();
const OUTDIR = join(CWD, "dist");
const CLIENT_OUTDIR = join(OUTDIR, "client");
const CONTENT_FILEPATH = join(CWD, "content.js");
const FALLBACK_FILEPATH = join(CWD, "fallback.js");
const SERVER_FILEPATH = join(process.cwd(), "server.js");

const entryPoints = [];
if (existsSync(CONTENT_FILEPATH)) {
  entryPoints.push(CONTENT_FILEPATH);
}
if (existsSync(FALLBACK_FILEPATH)) {
  entryPoints.push(FALLBACK_FILEPATH);
}

const buildContext = await context({
  entryPoints,
  bundle: true,
  format: "esm",
  outdir: CLIENT_OUTDIR,
  minify: true,
  target: ["es2017"],
  legalComments: `none`,
  sourcemap: true,
  plugins: [
    wrapComponentsPlugin({ name: config.get("app.name"), hydrate: config.get("app.mode") === "hydrate", livereload: true }),
    minifyHTMLLiteralsPlugin(),
  ],
});

// Chokidar provides super fast native file system watching
const watcher = chokidar.watch(["**/*.js", "**/*.json"], {
  ignored: /package-lock.json|server.js|node_modules|dist|temp|vendor|(^|[\/\\])\../, // ignore dotfiles and dirs
  persistent: true,
  followSymlinks: false,
  cwd: process.cwd(),
});

watcher.on("change", async () => {
  await buildContext.rebuild();
});

// Esbuild built in server which provides an SSE endpoint the client can subscribe to
// in order to know when to reload the page. Client subscribes with:
// new EventSource('http://localhost:6935/esbuild').addEventListener('change', () => { location.reload() });
await buildContext.serve({ port: 6935 });

// Build the bundle
await buildContext.rebuild();

// Create and start a development server
const server = fastify({ logger: LOGGER });

// Register the main server Fastify plugin.
server.register(fastifyPodletPlugin, {
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

// register user provided plugin using sandbox to enable reloading
if (existsSync(SERVER_FILEPATH)) {
  app.register((await import(SERVER_FILEPATH)).default, { path, options: { config, app: app.podlet, eik: app.eik } });
}

server.listen({ port: config.get("app.port") });
