import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, "..", "..", "data");
const seed = JSON.parse(fs.readFileSync(path.join(data, "databases/turtleSoupPuzzles.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(data, "game-manifest.json"), "utf8"));
const dbs = JSON.parse(fs.readFileSync(path.join(data, "databases.framework.json"), "utf8"));
const window = JSON.parse(fs.readFileSync(path.join(data, "windows", "turtle-soup.json"), "utf8"));

assert.ok(manifest.seedRecords.includes("databases/turtleSoupPuzzles.json"));
assert.ok(manifest.windowManifest.includes("turtle-soup.json"));
assert.ok(dbs.some((db) => db.databaseId === "turtleSoupPuzzles"));
assert.equal(seed.turtleSoupPuzzles.length, 6);
assert.deepEqual(seed.turtleSoupPuzzles.map(({ id }) => id), [
  "binbin_turtle_01",
  "binbin_turtle_02",
  "binbin_turtle_03",
  "binbin_turtle_04",
  "binbin_turtle_05",
  "binbin_turtle_06",
]);
assert.equal(window.id, "turtle-soup");
assert.ok(window.root.children.some((child) => child.widgetId === "turtle-soup-state"));
console.log(`turtle-soup-data-probe: ${seed.turtleSoupPuzzles.length} puzzles, canonical database owner verified`);
