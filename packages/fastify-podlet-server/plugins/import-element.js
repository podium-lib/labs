import { join, parse } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";
import fp from "fastify-plugin";

const require = createRequire(import.meta.url);

/**
 * Flag used in proxy to decide whether to intercept calls to
 * customElements.define() or not.
 *
 * We switch this on, collect up registrations then we switch it off
 * and call it manually ourselves
 */
let interceptDefineCalls = true;
const definitions = new Map();

/**
 * Create a proxy to intercept calls to customElements.define.
 *
 * customElements.define may be called in userland as they import different component depenedencies and if they do so,
 * each time we do a hot/live reload of code, we will redefine the same components again which will throw.
 * In order to solve this, we collect up the arguments using the proxy defined below and store them in a map called "definitions"
 * and then once we are ready, we wipe the registry from before code change and then define all components again manually.
 *
 * We cannot simply wipe the registry and let things occur organically or else we get race conditions due to the delay between
 * wiping the registry and the time it takes to import the bundle (which contains define calls). Hence, we intercept the define calls,
 * store the args in "definitions" and then once everything has settled we do the registry wipe and redefine in one go.
 */
// @ts-ignore
const proxy = new Proxy(customElements, {
  get(target, prop) {
    // this first bit just replicates the normal behavior when we don't intercept
    let ret = Reflect.get(target, prop);
    if (typeof ret === "function") {
      ret = ret.bind(target);
    }
    // if the prop being accessed is define, and the variable "collecting" is currently true
    // we intercept the define call and return a function that collects args in the "definitions" map.
    if (prop === "define" && interceptDefineCalls) {
      return (name, ctor) => definitions.set(name, ctor);
    }

    // in all other cases, including if collecting is false, we just return default behaviour for define.
    return ret;
  },
});
// we then overwrite the custom elements object with our proxy to allow interception.
customElements = proxy;

export default fp(async function importElement(
  fastify,
  { appName = "", development = false, plugins = [], cwd = process.cwd() }
) {
  // ensure custom elements registry has been enabled
  await import("@lit-labs/ssr");
  const outdir = join(cwd, "dist", "server");

  /**
   * Imports a custom element by pathname, bundles it and registers it in the server side custom element
   * registry.
   * In production mode, this happens 1x for each unique filepath after which this function will noop
   * In development mode, every call to this function will yield a fresh version of the custom element being re-registered
   * to the custom element registry.
   */
  fastify.decorate("importElement", async (path = "") => {
    const { name } = parse(path);

    if (!name || name === ".") {
      throw new Error(
        `Invalid path '${path}' given to importElement. path must be a path (relative or absolute) to a file including filename and extension.`
      );
    }

    const outfile = join(outdir, `${name}.js`);

    // if in production mode and the component has already been defined,
    // no more work is needed, so we bail early
    if (!development && customElements.get(`${appName}-${name}`)) {
      return;
    }

    let filepath = "";
    try {
      filepath = require.resolve(path, { paths: [cwd] });
    } catch (err) {
      fastify.log.error(err);
      // throw in production
      if (!development) throw err;
    }

    // bundle up SSR version of component. I wish this wasn't necessary but all experimentation so far
    // has led me to the conclusion that we need to bundle an SSR to avoid lit complaining about client/server hydration mismatches
    try {
      await esbuild.build({
        entryPoints: [filepath],
        bundle: true,
        format: "esm",
        outfile,
        minify: !development,
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

    interceptDefineCalls = false;

    // if already defined from a previous request, delete from registry
    try {
      // @ts-ignore
      customElements.__definitions.clear();
    } catch (err) {
      fastify.log.error(err);
      if (!development) throw err;
    }

    // define newly imported custom element in the registry
    try {
      for (const [name, ctor] of definitions.entries()) {
        customElements.define(name, ctor);
      }
      definitions.clear();
      interceptDefineCalls = true;
      customElements.define(`${appName}-${name}`, Element);
    } catch (err) {
      fastify.log.error(err);
      if (!development) throw err;
    }
  });
});
