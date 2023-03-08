import { join, parse } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";
import fp from "fastify-plugin";

const require = createRequire(import.meta.url);

export default fp(async function importElement(
  fastify,
  { appName = "", development = false, plugins = [], cwd = process.cwd() }
) {
  // ensure custom elements registry has been enabled
  await import("@lit-labs/ssr");
  const outdir = join(cwd, "dist", "server");

  // support user defined plugins via a build.js file
  // const BUILD_FILEPATH = join(cwd, "build.js");

  // const plugins = [];
  // if (existsSync(BUILD_FILEPATH)) {
  //   try {
  //     const userDefinedBuild = (await import(BUILD_FILEPATH)).default;
  //     const userDefinedPlugins = await userDefinedBuild({ config });
  //     if (Array.isArray(userDefinedPlugins)) {
  //       plugins.unshift(...userDefinedPlugins);
  //     }
  //   } catch (err) {
  //     // noop
  //   }
  // }
  /**
   * Imports a custom element by pathname, bundles it and registers it in the server side custom element
   * registry.
   * In production mode, this happens 1x for each unique filepath after which this function will noop
   * In development mode, every call to this function will yield a fresh version of the custom element being re-registered
   * to the custom element registry.
   */
  fastify.decorate("importElement", async (path = "") => {
    let filepath = "";
    try {
      filepath = require.resolve(path, { paths: [cwd] });
    } catch (err) {
      fastify.log.error(err);
      // throw in production
      if (!development) throw err;
    }
    const { name } = parse(filepath);
    const outfile = join(outdir, `${name}.js`);

    // if in production mode and the component has already been defined,
    // no more work is needed, so we bail early
    if (!development && customElements.get(`${appName}-${name}`)) {
      return;
    }

    // bundle up SSR version of component. I wish this wasn't necessary but all experimentation so far
    // has led me to the conclusion that we need to bundle an SSR to avoid lit complaining about client/server hydration mismatches
    try {
      await esbuild.build({
        entryPoints: [filepath],
        bundle: true,
        format: "esm",
        outfile,
        minify: true,
        plugins,
        legalComments: `none`,
        sourcemap: development ? "inline" : false,
        external: ["lit"],
      });
    } catch (err) {
      fastify.log.error(err);
      if (!development) throw err;
    }

    // import fresh copy of the custom element using date string to break module cache
    // in development, this makes it possible for the dev to keep making changes to the file and on
    // subsequent calls to importComponent, the newest version will be imported.
    let Element;
    try {
      Element = (await import(`${outfile}?s=${Date.now()}`)).default;
    } catch (err) {
      fastify.log.error(err);
      if (!development) throw err;
    }

    // if already defined from a previous request, delete from registry
    try {
      if (customElements.get(`${appName}-${name}`)) {
        // @ts-ignore
        customElements.__definitions.delete(`${appName}-${name}`);
      }
    } catch (err) {
      fastify.log.error(err);
      if (!development) throw err;
    }

    // define newly imported custom element in the registry
    try {
      customElements.define(`${appName}-${name}`, Element);
    } catch (err) {
      fastify.log.error(err);
      if (!development) throw err;
    }
  });
});
