import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import convict from "convict";
import { schema, formats } from "./config-schema.js";

convict.addFormats(formats);

// load additional config if provided
// users can define a config schema file with addition config options and this
// will be merged into the base config and can then be overridden as needed
// for specific environments, domains or globally.
let userSchema = {};
if (existsSync(join(process.cwd(), "config/schema.js"))) {
  userSchema = (await import(join(process.cwd(), "config/schema.js"))).default;
}

const config = convict({ ...schema, ...userSchema });

// we need to do this manually as using NODE_ENV as the default in schema produces some
// weird results.
// essentially, everytime you call load, NODE_ENV overwrites the value of app.env again.
if (process.env.NODE_ENV === "development") {
  config.set("app.env", "local");
}

// The expectation is that DOMAIN and NODE_ENV env vars will be set in production
const domain = config.get("app.domain");
const env = config.get("app.env");

// programmatically set defaults for cases
// locally, default to development mode
if (env === "local") {
  config.load({ app: { development: true } });
}

// name defaults to the name field in package.json
const { name } = JSON.parse(await readFile(join(process.cwd(), "package.json"), { encoding: "utf8" }));
config.load({ app: { name } });

// if a fallback is defined, set the fallback path
// this is so that the Podlet object fallback setting does not get set if no fallback is defined.
if (existsSync(join(process.cwd(), "fallback.js"))) {
  config.load({ podlet: { fallback: "/fallback" } });
}

// load comon config overrides if provided
// common.json is supported so that users can override core config without needing to override for multiple environments or domains
if (existsSync(join(process.cwd(), "config/common.json"))) {
  config.loadFile(join(process.cwd(), "config/common.json"));
}

// load specific overrides if provided
// fine grained config overrides. Domain and env overrides etc.
if (existsSync(join(process.cwd(), `config/domains/${domain}/config.${env}.json`))) {
  config.loadFile(join(process.cwd(), `config/domains/${domain}/config.${env}.json`));
}

// once all is setup, validate.
config.validate();

export default config;
