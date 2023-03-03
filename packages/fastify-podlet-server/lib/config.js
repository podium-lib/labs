import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import convict from "convict";
import { schema, formats } from "./config-schema.js";
import merge from "lodash.merge";

convict.addFormats(formats);

// load additional config if provided
// users can define a config schema file with addition config options and this
// will be merged into the base config and can then be overridden as needed
// for specific environments, domains or globally.
let userSchema = {};
if (existsSync(`${join(process.cwd(), "config", "schema")}.js`)) {
  userSchema = (await import(`${join(process.cwd(), "config", "schema")}.js`)).default;
}

merge(schema, userSchema);
const config = convict(schema);

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
// makes it possible to change the path that the app is mounted at by changing config.
// {
//   "app": { "base": "/" }
// }
config.load({ app: { name, base: `/${name}` } });

// if a fallback is defined, set the fallback path
// this is so that the Podlet object fallback setting does not get set if no fallback is defined.
if (existsSync(join(process.cwd(), "fallback.js"))) {
  config.load({ podlet: { fallback: "/fallback" } });
}

// auto detect scripts.js
if (existsSync(join(process.cwd(), "scripts.js"))) {
  config.load({ assets: { scripts: true } });
}

// auto detect lazy.js
if (existsSync(join(process.cwd(), "lazy.js"))) {
  config.load({ assets: { lazy: true } });
}

// load comon config overrides if provided
// common.json is supported so that users can override core config without needing to override for multiple environments or domains
if (existsSync(join(process.cwd(), `${join("config", "common")}.json`))) {
  config.loadFile(join(process.cwd(), `${join("config", "common")}.json`));
}

// load specific overrides if provided
// fine grained config overrides. Domain and env overrides etc.
if (existsSync(join(process.cwd(), `${join("config", "domains", domain, "config")}.${env}.json`))) {
  config.loadFile(join(process.cwd(), `${join("config", "domains", domain, "config")}.${env}.json`));
}

// once all is setup, validate.
config.validate();

export default config;
