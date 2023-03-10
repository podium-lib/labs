import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { test, beforeEach, afterEach } from "tap";
import fastify from "fastify";
import plugin from "../../lib/plugin.js";

const tmp = join(tmpdir(), "./plugin.test.js");

const contentFile = `
import { html, LitElement } from "lit";
export default class Element extends LitElement {
  render() { 
    return html\`<div>hello world</div>\`;
  }
}
`.trim();

beforeEach(async (t) => {
  await mkdir(tmp);
  await writeFile(
    join(tmp, "package.json"),
    JSON.stringify({ name: "test-app", type: "module", dependencies: { lit: "*" } })
  );
  await mkdir(join(tmp, "dist"));
  await writeFile(join(tmp, "content.js"), contentFile);
  await writeFile(join(tmp, "fallback.js"), contentFile);
  execSync("npm install", { cwd: tmp });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("simple app", async (t) => {
  const app = fastify({ logger: false });
  await app.register(plugin, { 
    cwd: tmp,
    name: "test-app",
    version: "1.0.0",
    fallback: "/fallback",
  });
  const address = await app.listen({ port: 0 });
  const manifest = await fetch(`${address}/manifest.json`);
  const content = await fetch(`${address}/`);
  const fallback = await fetch(`${address}/`);
  const markup = await content.text();
  t.equal(manifest.status, 200, "manifest file should be sucessfully served");
  t.equal(content.status, 200, "content file should be sucessfully served");
  t.equal(fallback.status, 200, "fallback file should be sucessfully served");
  t.match(markup, "<!--lit-part", "should contain lit comment tags");
  t.match(markup, "<test-app-content", "should contain the correct html tag");
  t.match(markup, `<template shadowroot="open">`, "should contain evidence of shadow dom");
  t.match(markup, `<div>hello world</div>`, "should contain component rendered markup");
  t.match(markup, `hasOwnProperty("shadowRoot")`, "should contain evidence of dsd polyfill");
  await app.close();
});
