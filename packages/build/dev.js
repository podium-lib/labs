#!/usr/bin/env node

// @ts-nocheck
/* eslint-disable no-console */
import { existsSync } from "node:fs";
import chokidar from "chokidar";
import { context } from "esbuild";
import { join } from "node:path";
import { minifyHTMLLiteralsPlugin } from "esbuild-plugin-minify-html-literals";
import {
  buildServer,
  buildClient,
  startServer,
  mkTempDirs,
  tmpdir,
  outdir,
  cleanTempDirs,
} from "./utils.js";
import pino from "pino";
import config from "./config.js";

const contentTempFilePath = join(tmpdir, "content.js");
const fallbackTempFilePath = join(tmpdir, "./fallback.js");
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
if (existsSync(join(process.cwd(), 'content.js')) && existsSync(contentTempFilePath)) {
  entryPoints.push(contentTempFilePath);
}
if (existsSync(join(process.cwd(), 'fallback.js')) && existsSync(fallbackTempFilePath)) {
  entryPoints.push(fallbackTempFilePath);
}

export const serverBuildOptions = {
  entryPoints,
  bundle: true,
  format: "esm",
  outdir: join(outdir, "server"),
  minify: true,
  plugins: [minifyHTMLLiteralsPlugin()],
  legalComments: `none`,
  platform: "node",
  sourcemap: true,
};

export const clientBuildOptions = {
  plugins: [
    minifyHTMLLiteralsPlugin(),
  ],
  entryPoints,
  bundle: true,
  format: "esm",
  outdir: join(outdir, "client"),
  minify: true,
  target: ["es2017"],
  legalComments: `none`,
  sourcemap: true,
};

const serverBuildContext = await context(serverBuildOptions);
const clientBuildContext = await context(clientBuildOptions);

let restart;

if (config.get("app.development")) {
  // Chokidar provides super fast native file system watching
  const watcher = chokidar.watch(["**/*.js", "**/*.json"], {
    ignored: /package-lock.json|node_modules|dist|temp|vendor|(^|[\/\\])\../, // ignore dotfiles and dirs
    persistent: true,
    followSymlinks: false,
    cwd: process.cwd(),
  });

  watcher.on("change", async () => {
    logger.info("rebuilding the goodness...");
    // we have to do these in series for live reload to work.
    // server and client builds depend on styles so styles has to happen first
    // after building the server, we need to reload the server before we can build the client
    // otherwise it will trigger a SSE to the browser too early.
    // all in all though, this is still quick which is impressive given the need for a server restart
    await buildServer({ context: serverBuildContext, name: config.get("app.name"), logger });
    await restart();
    await buildClient({
      context: clientBuildContext,
      development: config.get("app.development"),
      name: config.get("app.name"),
      logger,
    });
    await cleanTempDirs({ logger });
  });

  // Esbuild built in server which provides an SSE endpoint the client can subscripe to
  // in order to know when to reload the page. Client subscribes with:
  // new EventSource('http://localhost:6935/esbuild').addEventListener('change', () => { location.reload() });
  await clientBuildContext.serve({ port: 6935 });
}

logger.info("building the goodness...");
await mkTempDirs({ logger });
await buildServer({ context: serverBuildContext, name: config.get("app.name"), logger });
await buildClient({
  context: clientBuildContext,
  development: config.get("app.development"),
  name: config.get("app.name"),
  logger,
});
await cleanTempDirs({ logger });

if (config.get("app.development")) {
  restart = await startServer({
    name: config.get("app.name"),
    version: config.get("podlet.version"),
    pathname: config.get("podlet.pathname"),
    manifest: config.get("podlet.manifest"),
    content: config.get("podlet.content"),
    fallback: config.get("podlet.fallback"),
    development: config.get("app.development"),
    component: config.get("app.component"),
    mode: config.get("app.mode"),
    port: config.get("app.port"),
    path: serverFilePath,
    logger,
    config,
  });
}
