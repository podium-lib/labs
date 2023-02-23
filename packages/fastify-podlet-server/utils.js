// @ts-nocheck
import os from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build, transform } from "esbuild";

// get temp directory
// const tempDir = os.tmpdir();

export const outdir = join(process.cwd(), "dist");
// export const tmpdir = join(tempDir, "temp");
const contentFilePath = join(process.cwd(), "./content.js");
// const contentTempFilePath = join(tmpdir, "content.js");
const fallbackFilePath = join(process.cwd(), "./fallback.js");
// const fallbackTempFilePath = join(tmpdir, "./fallback.js");
const dsdPolyfillFilePath = new URL("./dsd-polyfill.js", import.meta.url);
const dsdPolyfill = readFileSync(dsdPolyfillFilePath, { encoding: "utf8" });

export async function buildClient(options) {
  if (!existsSync(contentFilePath) && !existsSync(fallbackFilePath)) return;
  options.logger.info("JavaScript clientside build...");
  // const livereload = options.development
  //   ? `new EventSource('http://localhost:6935/esbuild').addEventListener('change',()=>location.reload());`
  //   : "";
  // // Client side hydration
  // if (existsSync(contentFilePath)) {
  //   const contentHydrateSrc = `import 'lit/experimental-hydrate-support.js';import Content from "${contentFilePath}";customElements.define("${options.name}-content",Content);${livereload}`;
  //   writeFileSync(contentTempFilePath, contentHydrateSrc);
  // }
  // if (existsSync(fallbackFilePath)) {
  //   const fallbackHydrateSrc = `import 'lit/experimental-hydrate-support.js';import Fallback from "${fallbackFilePath}";customElements.define("${options.name}-fallback",Fallback);${livereload}`;
  //   writeFileSync(fallbackTempFilePath, fallbackHydrateSrc);
  // }

  if (options.context) {
    await options.context.rebuild();
  } else {
    delete options.name;
    delete options.logger;
    delete options.development;
    await build(options);
  }
}

export async function buildDsdPolyfill(options) {
  if (!existsSync(contentFilePath) && !existsSync(fallbackFilePath)) return;
  options.logger.info("Declarative shadow DOM polyfill build...");
  // DSD polyfill
  const contentPolyfill = await transform(dsdPolyfill, {
    format: "esm",
    minify: true
  });
  writeFileSync(join(outdir, "dsd-polyfill.js"), contentPolyfill.code);
}

/**
 * Creates temporary directories necessary for builds
 * @param {{ logger: { info(message: string) {} } }} options
 */
export async function mkBuildDir({ logger }) {
  logger.info('creating build directory...');
  if (!existsSync(outdir)) {
    mkdirSync(outdir);
  }
}
