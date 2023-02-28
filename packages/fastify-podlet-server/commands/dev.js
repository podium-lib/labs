#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import chokidar from "chokidar";
import { context } from "esbuild";
import pino from "pino";
import sandbox from "fastify-sandbox";
import { start } from "@fastify/restartable";
import config from "../lib/config.js";
import fastifyPodletPlugin from "../lib/fastify-podlet-plugin.js";
import resolve from "../lib/resolve.js";

config.set("assets.development", true);

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
const CONTENT_FILEPATH = await resolve(join(CWD, "content.js"));
const FALLBACK_FILEPATH = await resolve(join(CWD, "fallback.js"));
const SERVER_FILEPATH = await resolve(join(CWD, "server.js"));
const BUILD_FILEPATH = await resolve(join(CWD, "build.js"));

const entryPoints = [];
if (existsSync(CONTENT_FILEPATH)) {
  entryPoints.push(CONTENT_FILEPATH);
}
if (existsSync(FALLBACK_FILEPATH)) {
  entryPoints.push(FALLBACK_FILEPATH);
}

// support user defined plugins via a build.js file
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

// create an esbuild context object for the client side build so that we
// can optimally rebundle whenever files change
const buildContext = await context({
  entryPoints,
  entryNames: "[name]",
  bundle: true,
  format: "esm",
  outdir: CLIENT_OUTDIR,
  minify: true,
  target: ["es2017"],
  legalComments: `none`,
  sourcemap: true,
  plugins,
});

// Chokidar provides super fast native file system watching
const clientWatcher = chokidar.watch(["content.*", "fallback.*", "client/**/*"], {
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

// Create and start a development server
const started = await start({
  logger: LOGGER,
  // @ts-ignore
  app: (app, opts, done) => {
    app.register(fastifyPodletPlugin, { config });

    app.addHook('onError', (request, reply, error, done) => {
      buildContext.dispose();
      done();
    })

    // register user provided plugin using sandbox to enable reloading
    if (existsSync(SERVER_FILEPATH)) {
      app.register(sandbox, { path: SERVER_FILEPATH, options: { config, podlet: app.podlet } });
    }

    done();
  },
  port: config.get("app.port"),
  ignoreTrailingSlash: true,
});

// Chokidar provides super fast native file system watching
// of server files. Either server.js or any js files inside a server folder
const serverWatcher = chokidar.watch(["server.*", "server/**/*"], {
  persistent: true,
  followSymlinks: false,
  cwd: process.cwd(),
});
serverWatcher.on('error', () => {
  buildContext.dispose();
})

// restart the server whenever a server related file changes
serverWatcher.on("change", async () => {
  try {
    await started.restart();
  } catch (err) {
    console.log(err);
    buildContext.dispose();
  }
});

// start the server for the first time
try {
  await started.listen();
} catch (err) {
  console.log(err);
  buildContext.dispose();
}


