#!/usr/bin/env node

// @ts-nocheck
/* eslint-disable no-console */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import chokidar from "chokidar";
import fastify from "fastify";
import { context } from "esbuild";
import { join } from "node:path";
import { minifyHTMLLiteralsPlugin } from "esbuild-plugin-minify-html-literals";
import { buildClient, mkBuildDir, outdir, buildDsdPolyfill } from "./utils.js";
import pino from "pino";
import config from "./config.js";
import fastifyPodletPlugin from "./lib/fastify-podlet-plugin.js";

const serverFilePath = join(process.cwd(), "server.js");

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      translateTime: "HH:MM:ss Z",
      ignore: "pid,hostname",
    },
  },
});

let entryPoints = [];
if (existsSync(join(process.cwd(), "content.js"))) {
  entryPoints.push(join(process.cwd(), "content.js"));
}
if (existsSync(join(process.cwd(), "fallback.js"))) {
  entryPoints.push(join(process.cwd(), "fallback.js"));
}

export const clientBuildOptions = {
  entryPoints,
  bundle: true,
  format: "esm",
  outdir: join(outdir, "client"),
  minify: true,
  target: ["es2017"],
  legalComments: `none`,
  sourcemap: true,
  plugins: [
    {
      name: "define-element-plugin",
      setup(build) {
        const livereload = `new EventSource('http://localhost:6935/esbuild').addEventListener('change',()=>location.reload());`;
        build.onLoad({ filter: /content\.js$/ }, async (args) => {
          let input = await readFile(args.path, "utf8");
          return {
            contents: `import 'lit/experimental-hydrate-support.js';${input};customElements.define("${config.get(
              "app.name"
            )}-content",Content);${livereload}`,
          };
        });
        build.onLoad({ filter: /fallback\.js$/ }, async (args) => {
          let input = await readFile(args.path, "utf8");
          return {
            contents: `import 'lit/experimental-hydrate-support.js';${input};customElements.define("${config.get(
              "app.name"
            )}-fallback",Fallback);${livereload}`,
          };
        });
      },
    },
    minifyHTMLLiteralsPlugin(),
  ],
};

const clientBuildContext = await context(clientBuildOptions);

// Chokidar provides super fast native file system watching
const watcher = chokidar.watch(["**/*.js", "**/*.json"], {
  ignored: /package-lock.json|node_modules|dist|temp|vendor|(^|[\/\\])\../, // ignore dotfiles and dirs
  persistent: true,
  followSymlinks: false,
  cwd: process.cwd(),
});

watcher.on("change", async () => {
  logger.info("rebuilding the goodness...");
  await mkBuildDir({ logger });
  await buildClient({
    context: clientBuildContext,
    development: config.get("app.development"),
    name: config.get("app.name"),
    logger,
  });
});

// Esbuild built in server which provides an SSE endpoint the client can subscripe to
// in order to know when to reload the page. Client subscribes with:
// new EventSource('http://localhost:6935/esbuild').addEventListener('change', () => { location.reload() });
await clientBuildContext.serve({ port: 6935 });

logger.info("building the goodness...");
await mkBuildDir({ logger });
await buildDsdPolyfill({ logger });
await buildClient({
  context: clientBuildContext,
  development: config.get("app.development"),
  name: config.get("app.name"),
  logger,
});

logger.info("starting development server...");
const server = fastify({ logger });

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
if (existsSync(serverFilePath)) {
  app.register((await import(serverFilePath)).default, { path, options: { config, app: app.podlet, eik: app.eik } });
}

server.listen({ port: config.get("app.port") });
