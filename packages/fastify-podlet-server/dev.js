#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import chokidar from "chokidar";
import { context } from "esbuild";
import { minifyHTMLLiteralsPlugin } from "esbuild-plugin-minify-html-literals";
import pino from "pino";
import sandbox from "fastify-sandbox";
import { start } from "@fastify/restartable";
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
const NAME = /** @type {string} */ (/** @type {unknown} */ (config.get("app.name")));
const MODE = config.get("app.mode");
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

// create an esbuild context object for the client side build so that we
// can optimally rebundle whenever files change
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
    wrapComponentsPlugin({ name: NAME, hydrate: MODE === "hydrate", livereload: true }),
    minifyHTMLLiteralsPlugin(),
  ],
});

// Chokidar provides super fast native file system watching
const clientWatcher = chokidar.watch(["content.js", "fallback.js", "client/**/*.js"], {
  persistent: true,
  followSymlinks: false,
  cwd: process.cwd(),
});

// rebuild the client side bundle whenever a client side related file changes
clientWatcher.on("change", async () => {
  await buildContext.rebuild();
});

// Esbuild built in server which provides an SSE endpoint the client can subscribe to
// in order to know when to reload the page. Client subscribes with:
// new EventSource('http://localhost:6935/esbuild').addEventListener('change', () => { location.reload() });
await buildContext.serve({ port: 6935 });

// Build the bundle for the first time
await buildContext.rebuild();

// Create and start a development server
const started = await start({
  logger: LOGGER,
  // @ts-ignore
  app: (app, opts, done) => {
    app.register(fastifyPodletPlugin, {
      name: NAME,
      version: config.get("podlet.version"),
      pathname: config.get("podlet.pathname"),
      manifest: config.get("podlet.manifest"),
      content: config.get("podlet.content"),
      fallback: config.get("podlet.fallback"),
      development: config.get("app.development"),
      component: config.get("app.component"),
      renderMode: config.get("app.mode"),
    });

    // register user provided plugin using sandbox to enable reloading
    if (existsSync(SERVER_FILEPATH)) {
      app.register(sandbox, { path: SERVER_FILEPATH, options: { config, podlet: app.podlet, eik: app.eik } });
    }

    done();
  },
  port: config.get("app.port"),
  ignoreTrailingSlash: true,
});

// Chokidar provides super fast native file system watching
// of server files. Either server.js or any js files inside a server folder
const serverWatcher = chokidar.watch(["server.js", "server/**/*.js"], {
  persistent: true,
  followSymlinks: false,
  cwd: process.cwd(),
});

// restart the server whenever a server related file changes
serverWatcher.on("change", async () => {
  await started.restart();
});

// start the server for the first time
await started.listen();