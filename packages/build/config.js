import { existsSync } from "node:fs";
import { join } from "node:path";
import convict from "convict";
import { schema, formats } from "@nmp/config-schema";

convict.addFormats(formats);

// load additional config if provided
let userSchema = {};
if (existsSync(join(process.cwd(), "config/schema.js"))) {
  userSchema = (await import(join(process.cwd(), "config/schema.js"))).default;
}

const config = convict({ ...schema, ...userSchema });

const domain = config.get("app.domain");
const env = config.get("app.env");

const { name } = (
  await import(join(process.cwd(), "package.json"), {
    assert: { type: "json" },
  })
).default;
config.load({ app: { name } });

if (existsSync(join(process.cwd(), "fallback.js"))) {
  config.load({ podlet: { fallback: "/fallback" } });
}

// load comon config overrides if provided
if (existsSync(join(process.cwd(), "config/common.json"))) {
  config.loadFile(join(process.cwd(), "config/common.json"));
}

if (existsSync(join(process.cwd(), `config/domains/${domain}/config.${env}.json`))) {
  config.loadFile(join(process.cwd(), `config/domains/${domain}/config.${env}.json`));
}

config.validate();

export default config;
