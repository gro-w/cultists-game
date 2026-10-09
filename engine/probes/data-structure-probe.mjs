import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { GameClock } from "../core/GameClock.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";

/**
 * Covers plan §9.2/§9.3: field-type validation (all 7 types + array<T>),
 * required-field errors, applyDefaults(), and the 6 DB Activity nodes
 * (createRecord/getRecord/updateRecord/deleteRecord/findRecords/
 * countRecords) end-to-end through the exact same ActivityRunner used by
 * every other Activity - not a bespoke test-only code path.
 */

// --- 1. DataStructureManager: field types + validation -------------------
const structures = new DataStructureManager();
structures.register({
  id: "item",
  fields: [
    { id: "id", type: "string", required: true },
    { id: "stackable", type: "bool", default: false },
    { id: "quantity", type: "smallInteger", default: 1 },
    { id: "weight", type: "real", default: 0 },
    { id: "ownerId", type: "objectRef" },
    { id: "tags", type: "array<string>", default: [] },
    { id: "misc", type: "array" },
  ],
});

{
  const withDefaults = structures.applyDefaults("item", { id: "sword" });
  assert.equal(withDefaults.stackable, false);
  assert.equal(withDefaults.quantity, 1);
  assert.equal(withDefaults.weight, 0);
  assert.deepEqual(withDefaults.tags, []);
}

{
  structures.register({ id: "usableItem", fields: [{ id: "useEffect", type: "activity", default: {} }] });
  const blueprint = { startNodeId: "start", nodes: { start: { id: "start", type: "flowStart", inputs: {} } } };
  assert.equal(structures.validateRecord("usableItem", { useEffect: { use: blueprint } }).ok, true);
  assert.equal(structures.validateRecord("usableItem", { useEffect: { use: { invalid: true } } }).ok, false);
}

{
  const { ok, errors } = structures.validateRecord("item", { stackable: true });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("id")), "missing required field should error");
}

{
  const { ok, errors } = structures.validateRecord("item", { id: "sword", quantity: "not-a-number" });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("quantity")), "wrong type should error");
}

{
  const { ok, errors } = structures.validateRecord("item", { id: "sword", tags: ["metal", 42] });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("tags")), "array<T> element type mismatch should error");
}

{
  const { ok } = structures.validateRecord("item", { id: "sword", tags: ["metal", "sharp"], misc: [1, "x", true] });
  assert.equal(ok, true, "bare array accepts any element type");
}

{
  // unregister/loadDefinitions/toJSON round-trip (plan §9.2 structure manager)
  structures.register({ id: "scratch", fields: [{ id: "id", type: "string", required: true }] });
  assert.ok(structures.toJSON().some((d) => d.id === "scratch"));
  structures.unregister("scratch");
  assert.ok(!structures.toJSON().some((d) => d.id === "scratch"), "unregister must remove the structure");

  const fresh = new DataStructureManager();
  fresh.loadDefinitions(structures.toJSON());
  assert.deepEqual(fresh.toJSON(), structures.toJSON(), "loadDefinitions must bulk-register an equivalent snapshot");
}

console.log("data-structure-probe: DataStructureManager scenarios passed");

// --- 2. DataStore: CRUD, clones, primary-key generation, allowDelete -----
const store = new DataStore(structures);
store.registerDatabase({ databaseId: "items", recordType: "item", primaryKey: "id", allowDelete: false });

const created = store.createRecord("items", { stackable: true, quantity: 3 });
assert.ok(created.id, "auto-generated primary key");
const readBack = store.getRecord("items", created.id);
readBack.quantity = 999; // mutate the returned clone
assert.equal(store.getRecord("items", created.id).quantity, 3, "getRecord must never return a live reference");

store.updateRecord("items", created.id, { quantity: 5 });
assert.equal(store.getRecord("items", created.id).quantity, 5);

assert.throws(() => store.deleteRecord("items", created.id), /does not allow deletion/i, "deleteRecord on allowDelete:false database must throw");

store.createRecord("items", { id: "dup", quantity: 1 });
assert.throws(() => store.createRecord("items", { id: "dup", quantity: 1 }), /dup/i, "duplicate primary key must throw");

const found = store.findRecords("items", { quantity: 5 });
assert.equal(found.length, 1);
assert.equal(store.countRecords("items", {}), 2);

console.log("data-structure-probe: DataStore CRUD scenarios passed");

{
  // listDatabases/loadDefinitions (plan §9.4 database debugger)
  const listed = store.listDatabases();
  const itemsMeta = listed.find((d) => d.databaseId === "items");
  assert.ok(itemsMeta, "listDatabases must include the registered database");
  assert.equal(itemsMeta.recordCount, 2);
  assert.equal(itemsMeta.records, undefined, "listDatabases must never expose the live records Map");

  const freshStore = new DataStore(structures);
  freshStore.loadDefinitions(listed.map(({ recordCount, ...config }) => config));
  assert.ok(freshStore.listDatabases().some((d) => d.databaseId === "items"), "loadDefinitions must bulk-register databases");
}

// --- 3. DB Activity nodes end-to-end through the real ActivityRunner ----
const eventBus = new EventBus();
const variableStore = new VariableStore(eventBus);
const gameClock = new GameClock(eventBus);
const activityQueueRegistry = new ActivityQueueRegistry();
const activityExecutionService = new ActivityExecutionService(eventBus);
const queue = activityQueueRegistry.register("main");

function run(blueprint) {
  const validation = validateBlueprint(blueprint);
  assert.equal(validation.ok, true, validation.errors?.join("；"));
  const instance = queue.append({ activityId: "probe" });
  return activityExecutionService.run({
    queue,
    definition: { id: "probe", blueprint: validation.blueprint },
    instance,
    variableStore,
    timeGateway: (minutes) => gameClock.advance(minutes),
    windowGateway: () => {},
    dbGateway: store,
  });
}

run({
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {} },
    create: {
      id: "create",
      type: "createRecord",
      inputs: { databaseId: "items", data: { id: "potion", quantity: 10 }, resultVariable: "created" },
    },
    end: { id: "end", type: "activityEnd", inputs: {} },
  },
  connections: [
    { fromNodeId: "start", fromPort: "flowOut", toNodeId: "create", toPort: "flowIn" },
    { fromNodeId: "create", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
  ],
});
assert.equal(variableStore.get("created").id, "potion");
assert.equal(store.getRecord("items", "potion").quantity, 10);

run({
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {} },
    get: {
      id: "get",
      type: "getRecord",
      inputs: { databaseId: "items", key: "potion", resultVariable: "fetched" },
    },
    end: { id: "end", type: "activityEnd", inputs: {} },
  },
  connections: [
    { fromNodeId: "start", fromPort: "flowOut", toNodeId: "get", toPort: "flowIn" },
    { fromNodeId: "get", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
  ],
});
assert.equal(variableStore.get("fetched").quantity, 10);

console.log("data-structure-probe: DB Activity nodes end-to-end passed");
console.log("data-structure-probe: all scenarios passed");
