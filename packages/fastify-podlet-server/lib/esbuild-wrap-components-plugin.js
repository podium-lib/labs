import { readFile } from "node:fs/promises";
import { minifyHTMLLiterals } from 'minify-html-literals';

const CONTENT_FILTER = /content\.js$/;
const FALLBACK_FILTER = /fallback\.js$/;

/**
 * ESBuild plugin that loads content.js and fallback.js and wraps them with
 * Lit hydrate support (if needed) and code to register them in the custom elements registry
 * @param {{ name: string, hydrate?: boolean, livereload?: boolean }} options
 */
export default function wrapComponents({ name, hydrate = true, livereload = false }) {
  const hydratePrefix = hydrate ? "import 'lit/experimental-hydrate-support.js';" : "";
  const livereloadSnippet = `new EventSource('http://localhost:6935/esbuild').addEventListener('change',()=>location.reload());`;
  const livereloadSuffix = livereload ? livereloadSnippet : "";

  return {
    name: "esbuild-wrap-components-plugin",
    setup(build) {
      build.onLoad({ filter: CONTENT_FILTER }, async (args) => {
        const input = await readFile(args.path, "utf8");
        const contents = `
          ${hydratePrefix}
          ${input};
          window.customElements.define("${name}-content",Content);
          ${livereloadSuffix}
        `;
        return { contents: minifyHTMLLiterals(contents)?.code };
      });
      build.onLoad({ filter: FALLBACK_FILTER }, async (args) => {
        const input = await readFile(args.path, "utf8");
        const contents = `
          ${hydratePrefix}
          ${input};
          window.customElements.define("${name}-fallback",Fallback);
          ${livereloadSuffix}
        `;
        return { contents: minifyHTMLLiterals(contents)?.code };
      });
    },
  };
}
