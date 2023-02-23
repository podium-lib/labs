#!/usr/bin/env node

/* eslint-disable no-console */
import { existsSync } from "node:fs";
import { join } from "node:path";
import esbuild from "esbuild";
import { minifyHTMLLiteralsPlugin } from "esbuild-plugin-minify-html-literals";
import config from "../lib/config.js";
import wrapComponentsPlugin from "../lib/esbuild-wrap-components-plugin.js";

const NAME = /** @type {string} */ (/** @type {unknown} */ (config.get("app.name")));
const MODE = config.get("app.mode");
const CWD = process.cwd();
const OUTDIR = join(CWD, "dist");
const CLIENT_OUTDIR = join(OUTDIR, "client");
const CONTENT_FILEPATH = join(CWD, "content.js");
const FALLBACK_FILEPATH = join(CWD, "fallback.js");

const entryPoints = [];
if (existsSync(CONTENT_FILEPATH)) {
  entryPoints.push(CONTENT_FILEPATH);
}
if (existsSync(FALLBACK_FILEPATH)) {
  entryPoints.push(FALLBACK_FILEPATH);
}

/**
 * Build a client side bundle into dist/client unless app.mode has been set to ssr-only,
 * in which case, no client side code is needed.
 */
if (MODE !== "ssr-only") {
  await esbuild.build({
    plugins: [wrapComponentsPlugin({ name: NAME, hydrate: MODE === "hydrate" }), minifyHTMLLiteralsPlugin()],
    entryPoints,
    bundle: true,
    format: "esm",
    outdir: CLIENT_OUTDIR,
    minify: true,
    target: ["es2017"],
    legalComments: `none`,
    sourcemap: true,
  });
}
