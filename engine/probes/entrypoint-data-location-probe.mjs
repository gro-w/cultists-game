import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DataLoader } from "../core/DataLoader.js";
import { bootstrap } from "../core/engine-bootstrap.js";
import { resolveAssetPath, setAssetRoot } from "../core/AssetPath.js";

const [rootHtml, demoHtml, entrypoint, manifest, welcome] = await Promise.all([
  readFile(new URL("../../index.html", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../core/entrypoint.js", import.meta.url), "utf8"),
  readFile(new URL("../example.data/game-manifest.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../example.data/windows/welcome.json", import.meta.url), "utf8").then(JSON.parse),
]);
assert.equal(rootHtml, '<script src="./engine/core/entrypoint.js"></script>\n<div id="data-location">data</div>\n', "game root points to the engine core entrypoint");
assert.equal(demoHtml, '<script src="./core/entrypoint.js"></script>\n<div id="data-location">example.data</div>\n', "standalone engine index declares its demo data package");
assert.match(entrypoint, /getElementById\("data-location"\)/, "entrypoint reads the explicit HTML data location");
assert.match(entrypoint, /bootstrap\(root, \{ dataRoot \}\)/, "entrypoint passes the configured data root into bootstrap");
assert.match(entrypoint, /new URL\("\.\/engine-bootstrap\.js", entrypointUrl\)/, "entrypoint imports core bootstrap relative to its own script URL");
assert.equal(manifest.contentRoot, "./", "demo content root stays inside the HTML-selected package");
assert.equal(manifest.defaultActivity.activityId, "default");
assert.deepEqual(manifest.windowManifest, ["welcome.json", "features.json"]);
assert.equal(welcome.root.children.find((widget) => widget.widgetId === "welcome-features")?.type, "button");
await assert.rejects(bootstrap(null), /requires an explicit dataRoot/, "bootstrap cannot silently fall back to a built-in data directory");
assert.throws(() => new DataLoader(), /requires an explicit content root/, "DataLoader has no implicit data/ default");

const requestedUrls = [];
const loader = new DataLoader({
  root: "https://example.test/alternate-content/",
  fetchImpl: async (url) => {
    requestedUrls.push(url);
    return { ok: true, json: async () => ({ ok: true }) };
  },
});
await loader.loadJSON("game-manifest.json");
assert.deepEqual(requestedUrls, ["https://example.test/alternate-content/game-manifest.json"], "loader honors the supplied data root");
setAssetRoot("https://example.test/alternate-content/");
assert.equal(resolveAssetPath("data/assets/portrait.png"), "https://example.test/alternate-content/assets/portrait.png", "data asset paths use the selected package root");

console.log("entrypoint data-location probe passed");
