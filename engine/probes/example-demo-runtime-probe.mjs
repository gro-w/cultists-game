import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AppProgramRegistry } from "../core/AppProgramRegistry.js";
import { createActivityRunner } from "../core/ActivityRunner.js";
import { registerCustomActivityNode } from "../core/ActivityNodeRegistry.js";
import { createActivityInstance } from "../core/ActivityInstance.js";
import { decodeCl2Blueprints } from "../core/Cl2Embedded.js";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { validateCl2 } from "../core/Cl2Validator.js";
import { DataStore } from "../core/DataStore.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import EventBus from "../core/EventBus.js";
import EventStateRegistry from "../core/EventStateRegistry.js";
import { GameClock } from "../core/GameClock.js";
import { PublicVariableManager } from "../core/PublicVariableManager.js";
import { RuntimeCollectionRegistry } from "../core/RuntimeCollectionRegistry.js";
import { VariableStore } from "../core/VariableStore.js";
import { VirtualFileSystem } from "../core/VirtualFileSystem.js";
import { DesktopIconManager } from "../core/DesktopIconManager.js";
import { createApiRegistry } from "../core/engine-api.js";

const base = new URL("../example.data/", import.meta.url);
const json = (file) => readFile(new URL(file, base), "utf8").then(JSON.parse);
const [gameManifest, frameworkManifest, activityManifest, activityList, dataFileManifest,
  appDefinitions, filesystem, structures, databases, itemRecords, runtimeDefinition,
  publicVariableDefinitions, onboardingDefinitions, inventoryWindow, blueprintNodes] = await Promise.all([
  json("game-manifest.json"), json("framework-manifest.json"), json("activity-manifest.json"),
  json("activity-lists/default.json"), json("data-files.json"), json("app-definitions.json"),
  json("virtual-filesystem.json"), json("structures.json"), json("databases.json"),
  json("item-records.json"), json("framework-runtime.json"), json("public-variables.json"),
  json("onboarding.json"), json("windows/inventory.json"), json("blueprint-nodes.json"),
]);

for (const file of dataFileManifest.files) await readFile(new URL(file, base));
assert.equal(gameManifest.tutorialOverlay, true, "example manifest enables onboarding presentation");
assert.deepEqual(new Set(activityList.activityIds), new Set(activityManifest.activityIds.map(({ id }) => id)));
assert.equal(VirtualFileSystem.validateDefaultDocument(filesystem), true);
assert.ok(dataFileManifest.files.includes("bgm.json"), "the optional audio manifest resolves without a missing-file request");
assert.doesNotThrow(() => AppProgramRegistry.validateDocument(appDefinitions));
for (const [programId, shortcut] of [
  ["file-manager", "/home/desktop/文件浏览器.lnk"],
  ["document", "/home/desktop/文档编辑器.lnk"],
  ["terminal", "/home/desktop/终端.lnk"],
]) {
  const vfs = new VirtualFileSystem(filesystem);
  const resolved = vfs.resolveShortcut(shortcut);
  assert.equal(resolved?.target?.content, programId, `${shortcut} resolves through the app registry`);
  const program = appDefinitions.programs.find(({ id }) => id === programId);
  assert.ok(gameManifest.windowManifest.includes(`${program.target}.json`), `${programId} resolves to a loaded window`);
}
const iconManager = new DesktopIconManager([], {
  virtualFileSystem: new VirtualFileSystem(filesystem),
  appRegistry: new AppProgramRegistry(appDefinitions),
});
for (const path of ["/home/desktop/文件浏览器.lnk", "/home/desktop/文档编辑器.lnk", "/home/desktop/终端.lnk"]) {
  assert.ok(iconManager.listDirectory("/home/desktop").some((icon) => icon.sourcePath === path && icon.blueprintId === "desktop.launch-program"));
}

for (const node of blueprintNodes) registerCustomActivityNode(node);
const sources = await Promise.all(activityManifest.activityIds.map(async ({ id, file }) => {
  const source = await readFile(new URL(`activities/${file}`, base), "utf8");
  const validation = validateCl2(source, { sourcePath: file });
  assert.equal(validation.ok, true, `${file}: ${validation.diagnostics.map(({ message }) => message).join("; ")}`);
  return [id, validation.graph];
}));
const activityGraphs = new Map(sources);
const decodedInventory = decodeCl2Blueprints(inventoryWindow, "windows/inventory.json");
for (const eventName of ["onInspect", "onUse"]) {
  const eventGraph = decodedInventory.root.children.find(({ widgetId }) => widgetId === "inventory-list").events[eventName];
  assert.equal(validateBlueprint(eventGraph).ok, true, `${eventName} embedded item action validates`);
}
assert.ok(frameworkManifest.documents.eventState.triggers["example:started"]);
assert.ok(onboardingDefinitions.some(({ id }) => id === "use-item"));

const eventBus = new EventBus();
const variableStore = new VariableStore(eventBus);
for (const [key, value] of Object.entries(gameManifest.initialVariables || {})) variableStore.set(key, value);
const dataStructureManager = new DataStructureManager();
dataStructureManager.loadDefinitions(structures);
const dataStore = new DataStore(dataStructureManager);
dataStore.loadDefinitions(databases);
dataStore.loadRecordSet(itemRecords);
const publicVariableManager = new PublicVariableManager(null, eventBus);
publicVariableManager.loadDefinitions(publicVariableDefinitions);
const gameClock = new GameClock(eventBus, gameManifest.initialState || {});
const runtimeCollections = new RuntimeCollectionRegistry({
  dataStore,
  eventBus,
  variableStore,
  publicVariableManager,
  publicStateVariableId: runtimeDefinition.publicStateVariableId,
  gameClock,
});
runtimeCollections.loadDefinitions(runtimeDefinition.collections);
const runtimeGateway = {
  getCollection: (id) => runtimeCollections.get(id),
  getRecord: (id, recordId) => runtimeCollections.getRecord(id, recordId),
  operateCollection: (id, recordId, options) => runtimeCollections.operation(id, recordId, options),
};
const eventState = new EventStateRegistry({ eventBus, events: frameworkManifest.documents.eventState.events });
eventState.loadDefinitions(onboardingDefinitions);
eventState.bindTriggers(frameworkManifest.documents.eventState.triggers);
const timeService = { consume: (minutes) => gameClock.advance(minutes) };
const apiGateway = createApiRegistry({
  eventBus,
  variableStore,
  publicVariableManager,
  activityQueueRegistry: null,
  shell: { openWindow: () => true },
  timeService,
  dataStore,
  runtimeGateway,
});
const openedWindows = [];
function execute(id, blueprint, parameters = []) {
  const checked = validateBlueprint(blueprint);
  assert.equal(checked.ok, true, `${id}: ${checked.errors.join("; ")}`);
  const instance = createActivityInstance({ activityId: id, currentNodeId: checked.blueprint.startNodeId, parameters });
  createActivityRunner({
    definition: { id, blueprint: checked.blueprint },
    instance,
    variableStore,
    eventBus,
    timeGateway: (minutes) => timeService.consume(minutes),
    windowGateway: (windowId) => { openedWindows.push(windowId); return true; },
    eventGateway: (eventName, payload) => eventBus.emit(eventName, payload),
    dbGateway: dataStore,
    pvGateway: publicVariableManager,
    runtimeGateway,
    eventStateGateway: eventState,
    apiGateway,
  }).start();
  assert.equal(instance.status, "resolved", `${id} completes without waiting`);
  return instance;
}

execute("default", activityGraphs.get("default"));
assert.deepEqual(openedWindows, ["welcome"]);
assert.deepEqual(runtimeCollections.get("inventory").map(({ id, quantity }) => [id, quantity]), [
  ["ticket", 2], ["sealed-letter", 1], ["magnifier", 1],
], "initial quantities are read from canonical item database records");
assert.deepEqual(publicVariableManager.get(12).inventory, { ticket: 2, "sealed-letter": 1, magnifier: 1 });
assert.equal(publicVariableManager.get(10), 20);
assert.equal(publicVariableManager.get(11), 0);
assert.ok(eventState.requested.has("open-file-browser"), "the first onboarding hint follows the startup milestone");

for (const eventName of ["example:file_browser_opened", "example:document_editor_opened", "example:terminal_opened", "example:inventory_opened"]) {
  eventBus.emit(eventName, {});
}
variableStore.set("event:value", "ticket");
const inspectGraph = decodedInventory.root.children.find(({ widgetId }) => widgetId === "inventory-list").events.onInspect;
execute("inventory:onInspect", inspectGraph);
assert.equal(variableStore.get("demo:activeItemId"), "ticket");
assert.ok(eventState.marked.has("tour:item_inspected"));
assert.ok(eventState.requested.has("use-item"));

const useGraph = decodedInventory.root.children.find(({ widgetId }) => widgetId === "inventory-list").events.onUse;
const initialClock = gameClock.snapshot();
variableStore.set("event:value", "ticket");
execute("inventory:onUse:first", useGraph);
assert.equal(runtimeCollections.getRecord("inventory", "ticket").quantity, 1);
assert.equal(runtimeCollections.getRecord("itemUses", "ticket").value, 1);
assert.equal(publicVariableManager.get(10), 25);
assert.equal(publicVariableManager.get(11), 1);
assert.equal(gameClock.snapshot().minutes - initialClock.minutes, 20);
assert.equal(variableStore.get("demo:lastItemResult"), "使用成功：时间已推进、余额已增加");

variableStore.set("event:value", "ticket");
execute("inventory:onUse:second", useGraph);
assert.equal(runtimeCollections.getRecord("inventory", "ticket"), null, "depleted inventory is filtered out");
assert.equal(runtimeCollections.getRecord("itemUses", "ticket").value, 2);
assert.equal(publicVariableManager.get(10), 30);
assert.equal(publicVariableManager.get(11), 2);
assert.equal(gameClock.snapshot().minutes - initialClock.minutes, 40);

variableStore.set("event:value", "ticket");
execute("inventory:onUse:empty", useGraph);
assert.equal(variableStore.get("demo:lastItemResult"), "库存不足：未推进时间，也未增加金钱");
assert.equal(publicVariableManager.get(10), 30, "failed use does not reward money");
assert.equal(publicVariableManager.get(11), 2, "failed use does not increment counters");
assert.equal(gameClock.snapshot().minutes - initialClock.minutes, 40, "failed use does not advance time");
assert.ok(eventState.marked.has("tour:item_used"));

console.log("example-demo-runtime-probe: app launchers, VFS targets, CL2 macros, database-backed inventory, public state, time, failure atomicity, and onboarding passed");
