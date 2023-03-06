#!/usr/bin/env node

/* eslint-disable no-console */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import esbuild from "esbuild";
import config from "../lib/config.js";
import resolve from "../lib/resolve.js";

const NAME = /** @type {string} */ (/** @type {unknown} */ (config.get("app.name")));
const MODE = config.get("app.mode");
const CWD = process.cwd();
const OUTDIR = join(CWD, "dist");
const CLIENT_OUTDIR = join(OUTDIR, "client");
const CONTENT_FILEPATH = await resolve(join(CWD, "content.js"));
const FALLBACK_FILEPATH = await resolve(join(CWD, "fallback.js"));
const BUILD_FILEPATH = await resolve(join(process.cwd(), "build.js"));
const CONTENT_ENTRYPOINT = join(OUTDIR, ".build", "content.js");
const FALLBACK_ENTRYPOINT = join(OUTDIR, ".build", "fallback.js");
const SCRIPTS_FILEPATH = await resolve(join(CWD, "scripts.js"));
const LAZY_FILEPATH = await resolve(join(CWD, "lazy.js"));

const entryPoints = [];
if (existsSync(CONTENT_FILEPATH)) {
  // write entrypoint file to /dist/.build/content.js
  mkdirSync(dirname(CONTENT_ENTRYPOINT), { recursive: true });
  writeFileSync(
    CONTENT_ENTRYPOINT,
    `import "lit/experimental-hydrate-support.js";import Component from "${CONTENT_FILEPATH}";customElements.define("${NAME}-content",Component);`
  );
  if (config.get("app.mode") !== "ssr-only") {
    entryPoints.push(CONTENT_ENTRYPOINT);
  }
}
if (existsSync(FALLBACK_FILEPATH)) {
  // write entrypoint file to /dist/.build/content.js
  mkdirSync(dirname(FALLBACK_ENTRYPOINT), { recursive: true });
  writeFileSync(
    FALLBACK_ENTRYPOINT,
    `import "lit/experimental-hydrate-support.js";import Component from "${FALLBACK_FILEPATH}";customElements.define("${NAME}-fallback",Component);`
  );
  if (config.get("app.mode") !== "ssr-only") {
    entryPoints.push(FALLBACK_ENTRYPOINT);
  }
}
if (existsSync(SCRIPTS_FILEPATH)) {
  entryPoints.push(SCRIPTS_FILEPATH);
}
if (existsSync(LAZY_FILEPATH)) {
  entryPoints.push(LAZY_FILEPATH);
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
