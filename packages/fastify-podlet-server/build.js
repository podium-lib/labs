#!/usr/bin/env node

// @ts-nocheck
/* eslint-disable no-console */
import { existsSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { minifyHTMLLiteralsPlugin } from "esbuild-plugin-minify-html-literals";
import {
  buildServer,
  buildClient,
  buildDsdPolyfill,
  mkTempDirs,
  tmpdir,
  outdir,
  cleanTempDirs,
} from "./utils.js";
import config from "./config.js";

const contentTempFilePath = join(tmpdir, "content.js");
const fallbackTempFilePath = join(tmpdir, "./fallback.js");

const logger = pino();

let entryPoints = [];
if (existsSync(join(process.cwd(), 'content.js')) && existsSync(contentTempFilePath)) {
  entryPoints.push(contentTempFilePath);
}
if (existsSync(join(process.cwd(), 'fallback.js')) && existsSync(fallbackTempFilePath)) {
  entryPoints.push(fallbackTempFilePath);
}

export const serverBuildOptions = {
  name: config.get('app.name'),
  logger,
  entryPoints,
  bundle: true,
  format: "esm",
  outdir: join(outdir, "server"),
  minify: true,
  plugins: [minifyHTMLLiteralsPlugin()],
  legalComments: `none`,
  platform: "node",
  sourcemap: true,
  development: false,
};

export const clientBuildOptions = {
  name: config.get('app.name'),
  logger,
  plugins: [
    // custom plugin to handle mapping css file path from 'warp:styles' to an actual file path on disk
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
  development: false,
};

await mkTempDirs({ logger });
await buildServer(serverBuildOptions);
await buildClient(clientBuildOptions);
await buildDsdPolyfill({ name: config.get('app.name'), logger });
await cleanTempDirs({ logger });
