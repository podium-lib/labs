export const schema = {
  app: {
    name: {
      doc: "Podlet name. Must match ^[a-z-]*$. Defaults to name in package.json.",
      format: "app-name",
      default: null,
    },
    env: {
      doc: "Environments",
      format: ["local", "test", "production"],
      default: "local",
      arg: "env",
    },
    domain: {
      doc: "Domain",
      format: ["localhost", "www.finn.no", "www.tori.fi"],
      default: "localhost",
      env: "DOMAIN",
      arg: "domain",
    },
    port: {
      doc: "The port to expose the http service on",
      format: "port",
      default: 8080,
      env: "PORT",
      arg: "port",
    },
    logLevel: {
      format: ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"],
      default: "INFO",
      env: "LOG_LEVEL",
      arg: "log-level",
    },
    locale: {
      doc: "Locale",
      format: String,
      default: "en-US",
    },
    development: {
      doc: "Development mode",
      format: Boolean,
      env: "DEVELOPMENT",
      default: false,
    },
    component: {
      doc: "Enables/disables custom element output. Default: true",
      format: Boolean,
      default: true,
    },
    mode: {
      doc: "Render mode. Render custom element with hydration, client side only or server side only. Default: hydrate.",
      format: ["hydrate", "csr-only", "ssr-only"],
      default: "hydrate",
    },
  },
  podlet: {
    pathname: {
      doc: "Podlet pathname.",
      format: String,
      default: "/",
    },
    version: {
      doc: "Podlet version. Locally, this should change on every request. In production, this should stay stable between deploys.",
      format: String,
      env: "VERSION",
      default: `${Date.now()}`,
    },
    manifest: {
      doc: "Manifest route pathname",
      format: String,
      default: "/manifest.json",
    },
    content: {
      doc: "Content Route pathname",
      format: String,
      default: "/",
    },
    fallback: {
      doc: "Fallback route pathname",
      format: String,
      default: "",
    },
  },
};

export const formats = {
  "app-name": {
    validate: function (val) {
      if (!/^[a-z-]*$/.test(val)) {
        throw new Error(
          "may only contain lower cases letters and hyphens. (^[a-z-]*$)"
        );
      }
    },
  },
};
