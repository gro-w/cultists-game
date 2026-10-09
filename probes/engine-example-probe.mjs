import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AppProgramRegistry } from "../engine/core/AppProgramRegistry.js";
import { registerCustomActivityNode } from "../engine/core/ActivityNodeRegistry.js";
import { decodeCl2Blueprints } from "../engine/core/Cl2Embedded.js";
import { validateCl2 } from "../engine/core/Cl2Validator.js";
import { validateBlueprint } from "../engine/core/ActivityValidator.js";
import { VirtualFileSystem } from "../engine/core/VirtualFileSystem.js";

const dataUrl = (path) => new URL(`../engine/example.data/${path}`, import.meta.url);
const [gameManifest, activityManifest, activityList, dataFileManifest, appDefinitions, filesystem, welcome, features, blueprintNodes] = await Promise.all([
  readFile(dataUrl("game-manifest.json"), "utf8").then(JSON.parse),
  readFile(dataUrl("activity-manifest.json"), "utf8").then(JSON.parse),
  readFile(dataUrl("activity-lists/default.json"), "utf8").then(JSON.parse),
  readFile(dataUrl("data-files.json"), "utf8").then(JSON.parse),
  readFile(dataUrl("app-definitions.json"), "utf8").then(JSON.parse),
  readFile(dataUrl("virtual-filesystem.json"), "utf8").then(JSON.parse),
  readFile(dataUrl("windows/welcome.json"), "utf8").then(JSON.parse),
  readFile(dataUrl("windows/features.json"), "utf8").then(JSON.parse),
  readFile(dataUrl("blueprint-nodes.json"), "utf8").then(JSON.parse),
]);

assert.equal(gameManifest.contentRoot, "./");
assert.equal(gameManifest.defaultActivity?.activityId, "default");
assert.deepEqual(new Set(activityList.activityIds), new Set(activityManifest.activityIds.map(({ id }) => id)));
assert.ok(Array.isArray(dataFileManifest.files), "dev-mode data editor receives a file manifest");
for (const file of dataFileManifest.files) {
  await readFile(dataUrl(file));
}
assert.doesNotThrow(() => AppProgramRegistry.validateDocument(appDefinitions));
assert.equal(VirtualFileSystem.validateDefaultDocument(filesystem), true);
assert.equal(welcome.id, "welcome");
assert.equal(features.id, "features");
assert.ok(filesystem.entries.some((entry) => entry.path === "/home/desktop/引擎演示.lnk"));
assert.equal(appDefinitions.programs.find(({ id }) => id === "welcome")?.target, "welcome");
for (const [id, windowId] of [["file-manager", "file-manager"], ["document", "document"], ["terminal", "terminal"]]) {
  assert.equal(appDefinitions.programs.find((program) => program.id === id)?.target, windowId);
  assert.ok(gameManifest.windowManifest.includes(`${windowId}.json`));
  const [reference, example] = await Promise.all([
    readFile(new URL(`../data/windows/${windowId}.json`, import.meta.url), "utf8").then(JSON.parse),
    readFile(dataUrl(`windows/${windowId}.json`), "utf8").then(JSON.parse),
  ]);
  for (const key of ["title", "icon", "width", "height", "resizable", "singleInstance"]) {
    assert.equal(example[key], reference[key], `${windowId} ${key} matches the game window`);
  }
  assert.deepEqual(example.root, reference.root, `${windowId} widget root and app class match the game window`);
}

for (const node of blueprintNodes) registerCustomActivityNode(node);
for (const file of ["default.CL2.txt", "showcase.CL2.txt"]) {
  const source = await readFile(dataUrl(`activities/${file}`), "utf8");
  const result = validateCl2(source, { sourcePath: file });
  assert.equal(result.ok, true, `${file}: ${result.diagnostics.map(({ message }) => message).join("; ")}`);
}
const decodedWelcome = decodeCl2Blueprints(welcome, "windows/welcome.json");
const launchButton = decodedWelcome.root.children.find(({ widgetId }) => widgetId === "welcome-features");
assert.ok(launchButton, "welcome window exposes a feature-demo button");
assert.equal(validateBlueprint(launchButton.events.onClick).ok, true, "button event is valid CL2 and can run the showcase Activity");

console.log("engine example probe: manifests, VFS, app registry, windows and CL2 Activities passed");
