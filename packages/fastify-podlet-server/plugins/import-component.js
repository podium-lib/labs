import { existsSync, readFileSync } from "node:fs";
import { join, parse } from "node:path";
import esbuild from "esbuild";
import fp from "fastify-plugin";

export default fp(async function importComponent(
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
  fastify.decorate("importComponent", async (filepath = "") => {
    const { name } = parse(filepath);
    const outfile = join(outdir, `${name}.js`);

    // if in production mode and the component has already been defined,
    // no more work is needed, so we bail early
    if (!development && customElements.get(`${appName}-${name}`)) {
      return;
    }

    if (!existsSync(filepath)) {
      // handle
    }

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
    }

    let Element;
    try {
      // import fresh copy of the custom element using date string
      Element = (await import(`${outfile}?s=${Date.now()}`)).default;
    } catch (err) {
      fastify.log.error(err);
    }

    try {
      // if already defined from a previous request, delete from registry
      if (customElements.get(`${appName}-${name}`)) {
        // @ts-ignore
        customElements.__definitions.delete(`${appName}-${name}`);
      }
    } catch (err) {
      fastify.log.error(err);
    }

    try {
      // define newly imported custom element in the registry
      customElements.define(`${appName}-${name}`, Element);
    } catch (err) {
      fastify.log.error(err);
    }
  });
});
