// Whhoooops!
// Resolve happens only once, so if the src file changes, the tmp file never does
//



/**
 * Resolves a file if JS and resolves and bundles if TS
 */
import { readFile } from "node:fs/promises";
import { parse, join } from "node:path";
// import { build } from "esbuild";

export default async function resolve(filePath) {
  const meta = parse(filePath);
  const tsSrcPath = join(meta.dir, meta.name) + ".ts";
  try {
    // try to read typescript version first
    await readFile(tsSrcPath, { encoding: "utf8" });
    return tsSrcPath;
    // const resolvedPath = join(process.cwd(), "dist", ".build", meta.name) + ".js";
    // await build({
    //   entryPoints: [tsSrcPath],
    //   outfile: resolvedPath,
    //   // platform: "node",
    //   // format: "esm",
    //   sourcemap: true,
    //   bundle: false,
    // });
    // return resolvedPath;
  } catch (err) {
    if (err.errno !== -2) {
      console.log(err);
    }
    // assume no ts, since reading it failed
    return filePath;
  }
}
