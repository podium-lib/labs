// @ts-nocheck
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build, transform } from "esbuild";
import { start } from "@fastify/restartable";
import sandbox from "fastify-sandbox";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export const outdir = join(process.cwd(), "dist");
export const tmpdir = join(process.cwd(), "temp");
const contentFilePath = join(process.cwd(), "./content.js");
const contentTempFilePath = join(tmpdir, "content.js");
const fallbackFilePath = join(process.cwd(), "./fallback.js");
const fallbackTempFilePath = join(tmpdir, "./fallback.js");
const dsdPolyfillFilePath = new URL("./dsd-polyfill.js", import.meta.url);
const dsdPolyfill = readFileSync(dsdPolyfillFilePath, { encoding: "utf8" });

export async function buildServer(options) {
  if (!existsSync(contentFilePath) && !existsSync(fallbackFilePath)) return;
  options.logger.info("JavaScript SSR build...");
  if (existsSync(contentFilePath)) {
    const contentSrc = `import Content from "${contentFilePath}";customElements.define("${options.name}-content",Content);`;
    writeFileSync(contentTempFilePath, contentSrc);
  }
  if (existsSync(fallbackFilePath)) {
    const fallbackSrc = `import Fallback from "${fallbackFilePath}";customElements.define("${options.name}-fallback",Fallback);`;
    writeFileSync(fallbackTempFilePath, fallbackSrc);
  }

  if (options.context) {
    await options.context.rebuild();
  } else {
    delete options.name;
    delete options.logger;
    delete options.development;
    await build(options);
  }
}

export async function buildClient(options) {
  if (!existsSync(contentFilePath) && !existsSync(fallbackFilePath)) return;
  options.logger.info("JavaScript clientside build...");
  const livereload = options.development
    ? `new EventSource('http://localhost:6935/esbuild').addEventListener('change',()=>location.reload());`
    : "";
  // Client side hydration
  if (existsSync(contentFilePath)) {
    const contentHydrateSrc = `import 'lit/experimental-hydrate-support.js';import Content from "${contentFilePath}";customElements.define("${options.name}-content",Content);${livereload}`;
    writeFileSync(contentTempFilePath, contentHydrateSrc);
  }
  if (existsSync(fallbackFilePath)) {
    const fallbackHydrateSrc = `import 'lit/experimental-hydrate-support.js';import Fallback from "${fallbackFilePath}";customElements.define("${options.name}-fallback",Fallback);${livereload}`;
    writeFileSync(fallbackTempFilePath, fallbackHydrateSrc);
  }

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

export async function startServer({
  name = "",
  version = "",
  pathname = "/",
  manifest = "/manfest.json",
  content = "/",
  fallback = "/fallback",
  development = false,
  port = 0,
  path = "",
  logger,
  component = true,
  mode = "hydrate",
  config = {}
} = {}) {
  logger.info(`starting development server on port: ${port}`);
  // Fastify provides 2 modules to support hot reloading. "sandbox" and "restartable"
  // This convoluted setup is how you enable restartability in your server
  // Sandbox imports a fresh copy of the server each time to ensure your server
  // code actually changes when you make changes.
  const started = await start({
    logger,
    app: (app, opts, done) => {
      const pluginPath = require.resolve("./lib/fastify-podlet-plugin.js");
      // register podium plugin using sandbox to enable reloading
      app.register(sandbox, {
        path: pluginPath,
        options: { name, version, pathname, fallback, development, content, manifest, component, mode }
      });

      // register user provided plugin using sandbox to enable reloading
      const serverFilePath = join(process.cwd(), "server.js");
      if (existsSync(serverFilePath)) {
        app.register(sandbox, { path, options: { config, app: app.podlet, eik: app.eik } });
      }

      done();
    },
    port,
    ignoreTrailingSlash: true
  });
  await started.listen();
  // restart is a method that can be used to restart the app which will reload in plugin modules defined with sandbox
  // above
  return started.restart;
}

/**
 * Creates temporary directories necessary for builds
 * @param {{ logger: { info(message: string) {} } }} options
 */
export async function mkTempDirs({ logger }) {
  logger.info('creating temporary directories...');
  if (!existsSync(outdir)) {
    mkdirSync(outdir);
  }
  if (!existsSync(tmpdir)) {
    mkdirSync(tmpdir);
  }
}


export async function cleanTempDirs({ logger }) {
  logger.info('clean temporary directories...');
  if (existsSync(tmpdir)) {
    rmSync(tmpdir, { recursive: true, force: true });
  }
}