import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

const base = resolve("apps/chromium-extension/dist");
const manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3, "Must be Manifest V3");
assert.equal(manifest.background.service_worker, "background.js");
assert.ok(!manifest.permissions?.includes("nativeMessaging"), "Native access must remain disabled");
assert.ok(!manifest.permissions?.includes("tabs"), "No broad tabs permission needed");
assert.ok(!manifest.host_permissions?.length, "No automatic host access");
assert.ok(manifest.optional_host_permissions?.length > 0, "Explicit link permissions expected");

for (const name of ["background.js", "viewer.html", "manifest.json"]) {
  const info = await stat(join(base, name));
  assert.ok(info.size > 20, name + " must exist and not be empty");
}
const html = await readFile(join(base, "viewer.html"), "utf8");
const scripts = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
assert.ok(scripts.length > 0, "Viewer must reference bundled scripts");
for (const script of scripts) {
  assert.ok(!/^https?:\/\//.test(script), "No remote executable code");
  const file = join(base, script.replace(/^\.\//, "").replace(/^\//, ""));
  assert.ok((await stat(file)).isFile(), "Missing referenced bundle: " + script);
}
const worker = await readFile(join(base, "background.js"), "utf8");
assert.ok(worker.includes("chrome"), "Background worker must include Chromium API code");
assert.ok(!worker.includes("http://localhost"), "No required resident localhost host");
assert.ok(!worker.includes("eval("), "No executable eval in extension worker");

console.log("MV3 prototype package checks passed.");
console.log({ version: manifest.version, scripts: scripts.length });
