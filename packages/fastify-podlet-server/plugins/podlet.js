import { readFileSync } from "node:fs";
import { SemVer } from "semver";
import Podlet from "@podium/podlet";
import fastifyPodletPlugin from "@podium/fastify-podlet";
import fp from "fastify-plugin";

export default fp(async function podlet(
  fastify,
  { name, version, pathname, manifest, content, fallback, development }
) {
  const podlet = new Podlet({
    name,
    version,
    pathname,
    manifest,
    content,
    fallback,
    development,
    logger: fastify.log,
  });
  fastify.decorate("podlet", podlet);
  fastify.register(fastifyPodletPlugin, podlet);

  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), { encoding: "utf8" }));
  const podiumVersion = new SemVer(packageJson.dependencies["@podium/podlet"].replace("^", "").replace("~", ""));

  /**
   * Generate a metric for which major version of the Podium podlet is being run
   * Metric is pushed into the podlet metrics stream which is then collected
   */
  // @ts-ignore
  const gauge = podlet.metrics.gauge({
    name: "active_podlet",
    description: "Indicates if a podlet is mounted and active",
    labels: { podium_version: podiumVersion.major, podlet_name: name },
  });
  setImmediate(() => gauge.set(1));

  // @ts-ignore
  if (!fastify.metricStreams) {
    fastify.decorate("metricStreams", []);
  }

  // @ts-ignore
  fastify.metricStreams.push(podlet.metrics);
});
