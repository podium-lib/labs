#!/usr/bin/env node

/* eslint-disable no-console */
import { existsSync } from "node:fs";
import { join } from "node:path";
import esbuild from "esbuild";
import { minifyHTMLLiteralsPlugin } from "esbuild-plugin-minify-html-literals";
import config from "../lib/config.js";
import wrapComponentsPlugin from "../lib/esbuild-wrap-components-plugin.js";
import resolve from "../lib/resolve.js";

const NAME = /** @type {string} */ (/** @type {unknown} */ (config.get("app.name")));
const MODE = config.get("app.mode");
const CWD = process.cwd();
const OUTDIR = join(CWD, "dist");
const CLIENT_OUTDIR = join(OUTDIR, "client");
const CONTENT_FILEPATH = await resolve(join(CWD, "content.js"));
const FALLBACK_FILEPATH = await resolve(join(CWD, "fallback.js"));
const BUILD_FILEPATH = await resolve(join(process.cwd(), "build.js"));

const entryPoints = [];
if (existsSync(CONTENT_FILEPATH)) {
  entryPoints.push(CONTENT_FILEPATH);
}
if (existsSync(FALLBACK_FILEPATH)) {
  entryPoints.push(FALLBACK_FILEPATH);
}

// support user defined plugins via a build.js file
const plugins = [wrapComponentsPlugin({ name: NAME, hydrate: MODE === "hydrate" }), minifyHTMLLiteralsPlugin()];
if (existsSync(BUILD_FILEPATH)) {
  try {
    const userDefinedBuild = (await import(BUILD_FILEPATH)).default;
    const userDefinedPlugins = await userDefinedBuild({ config });
    if (Array.isArray(userDefinedPlugins)) {
      plugins.unshift(...userDefinedPlugins);
    }
  } catch(err) {
    // noop
  }
}

/**
 * Build a client side bundle into dist/client unless app.mode has been set to ssr-only,
 * in which case, no client side code is needed.
 */
if (MODE !== "ssr-only") {
  await esbuild.build({
    entryNames: "[name]",
    plugins,
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
