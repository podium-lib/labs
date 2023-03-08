import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fp from "fastify-plugin";

export default fp(async function locale(fastify, { cwd, locale }) {
    const localFilePath = join(cwd, "locale", locale) + ".json";
    if (existsSync(localFilePath)) {
      try {
        const translation = JSON.parse(readFileSync(localFilePath, { encoding: "utf8" }));
        fastify.decorate("translations", translation);
      } catch (err) {
        fastify.log.error(`Error reading translation file: ${localFilePath}`, err);
      }
    }
});
