import assert from "node:assert/strict";
import { DataLoader } from "../core/DataLoader.js";

const calls = [];
const responses = new Map([
  ["data/example.json", { ok: true, json: async () => ({ value: 1 }) }],
  ["/api/files", { ok: false, status: 404 }],
  ["data/missing.json", { ok: false, status: 404 }],
]);
const loader = new DataLoader({
  root: "data/",
  fetchImpl: async (url) => {
    calls.push(url);
    const response = responses.get(url);
    if (!response) throw new Error(`unexpected URL: ${url}`);
    return response;
  },
});

const first = await loader.loadJSON("example.json");
const second = await loader.loadJSON("example.json");
assert.deepEqual(first, { value: 1 });
assert.equal(first, second);
assert.deepEqual(calls, ["data/example.json"]);

loader.clearCache("example.json");
await loader.loadJSON("example.json");
assert.deepEqual(calls, ["data/example.json", "data/example.json"]);
assert.equal(await loader.loadJSON("missing.json", { optional: true }), null);
assert.equal(await loader.detectDevServer(), false);
console.log("data-loader probe: ok");
