import assert from "node:assert/strict";
import "./register-framework-nodes.mjs";
import EventBus from "../core/EventBus.js";
import { PublicVariableManager } from "../core/PublicVariableManager.js";
import { RuntimeRefResolver } from "../core/RuntimeRefResolver.js";
import { GameClock } from "../core/GameClock.js";
import { VariableStore } from "../core/VariableStore.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { ACTIVITY_EVENTS } from "../core/ActivityEvents.js";
import { validateBlueprint } from "../core/ActivityValidator.js";

// --- ID boundaries (plan §10.1 "ID 0、65535 有效，65536 无效，负数无效") ----
{
  const pv = new PublicVariableManager();
  pv.register({ id: 0, type: "bool" });
  pv.register({ id: 65535, type: "bool" });
  assert.throws(() => pv.register({ id: 65536, type: "bool" }));
  assert.throws(() => pv.register({ id: -1, type: "bool" }));
  assert.throws(() => pv.register({ id: 1.5, type: "bool" }));
}

// --- smallInteger out-of-range rejected -------------------------------------
{
  const pv = new PublicVariableManager();
  pv.register({ id: 1, type: "smallInteger", defaultValue: 0 });
  assert.throws(() => pv.set(1, 256));
  assert.throws(() => pv.set(1, -1));
  pv.set(1, 255);
  assert.equal(pv.get(1), 255);
}

// --- real rejects NaN/Infinity -----------------------------------------------
{
  const pv = new PublicVariableManager();
  pv.register({ id: 2, type: "real", defaultValue: 0 });
  assert.throws(() => pv.set(2, NaN));
  assert.throws(() => pv.set(2, Infinity));
  assert.throws(() => pv.set(2, -Infinity));
  pv.set(2, 3.14);
  assert.equal(pv.get(2), 3.14);
}

// --- object reference save/restore/invalidate-visible -----------------------
{
  const refResolver = new RuntimeRefResolver();
  const registry = new Map([["npc-1", { name: "Alice" }]]);
  refResolver.register("npc", (objectId) => registry.get(objectId));

  const pv = new PublicVariableManager(refResolver);
  pv.register({ id: 3, type: "object" });
  pv.setObjectRef(3, { objectType: "npc", objectId: "npc-1" });
  assert.deepEqual(pv.resolveObject(3), { resolved: true, value: { name: "Alice" } });

  // Persist + restore round-trip preserves only the {objectType, objectId} ref.
  const snapshot = pv.snapshot();
  assert.deepEqual(snapshot[3], { objectType: "npc", objectId: "npc-1" });
  const restored = new PublicVariableManager(refResolver);
  restored.register({ id: 3, type: "object" });
  restored.restore(snapshot);
  assert.deepEqual(restored.resolveObject(3), { resolved: true, value: { name: "Alice" } });

  // Invalidate the referenced object -> resolution must surface as an explicit
  // unresolved state, never silently pointing at something else.
  registry.delete("npc-1");
  assert.deepEqual(restored.resolveObject(3), { resolved: false, value: null });
}

// --- condition/effect composition (all/any/not, delta/toggle) ---------------
{
  const pv = new PublicVariableManager();
  pv.register({ id: 10, type: "integer", defaultValue: 0 });
  pv.register({ id: 11, type: "bool", defaultValue: false });
  pv.set(10, 5);
  assert.equal(pv.evaluateCondition({ id: 10, op: "gte", value: 5 }), true);
  assert.equal(pv.evaluateCondition({ id: 10, op: "lt", value: 5 }), false);
  assert.equal(pv.evaluateCondition({ all: [{ id: 10, op: "gte", value: 1 }, { id: 11, op: "eq", value: false }] }), true);
  assert.equal(pv.evaluateCondition({ any: [{ id: 10, op: "eq", value: 999 }, { id: 11, op: "eq", value: false }] }), true);
  assert.equal(pv.evaluateCondition({ not: { id: 11, op: "eq", value: false } }), false);

  pv.applyEffect({ id: 10, delta: 3 });
  assert.equal(pv.get(10), 8);
  pv.applyEffect({ id: 11, toggle: true });
  assert.equal(pv.get(11), true);
}

// --- ActivityRunner integration: getPublicVariable / publicVariableCondition /
// applyPublicVariableEffect nodes, wired through a pvGateway exactly like
// dbGateway (plan §10 gateway parity) --------------------------------------
{
  const pv = new PublicVariableManager();
  pv.register({ id: 20, type: "integer", defaultValue: 0 });

  const definition = {
    id: "usePublicVariable",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        addFive: { id: "addFive", type: "applyPublicVariableEffect", inputs: { id: 20, delta: 5 } },
        check: { id: "check", type: "publicVariableCondition", inputs: { id: 20, op: "gte", value: 5 } },
        branch: { id: "branch", type: "branch", inputs: {} },
        readInto: { id: "readInto", type: "getVariable", inputs: { key: "readBack" } },
        endTrue: { id: "endTrue", type: "activityEnd", inputs: {} },
        endFalse: { id: "endFalse", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "addFive", toPort: "flowIn" },
        { fromNodeId: "addFive", fromPort: "flowOut", toNodeId: "branch", toPort: "flowIn" },
        { fromNodeId: "check", fromPort: "value", toNodeId: "branch", toPort: "condition" },
        { fromNodeId: "branch", fromPort: "true", toNodeId: "endTrue", toPort: "flowIn" },
        { fromNodeId: "branch", fromPort: "false", toNodeId: "endFalse", toPort: "flowIn" },
      ],
    },
  };
  const { ok, errors } = validateBlueprint(definition.blueprint);
  assert.equal(ok, true, `blueprint should validate: ${(errors || []).join(", ")}`);

  const eventBus = new EventBus();
  const variableStore = new VariableStore(eventBus);
  const activityDefinitionStore = new ActivityDefinitionStore();
  activityDefinitionStore.register(definition);
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);
  const queue = activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "usePublicVariable" });

  activityExecutionService.run({
    queue, definition: activityDefinitionStore.get("usePublicVariable"), instance, variableStore, pvGateway: pv,
  });

  assert.equal(pv.get(20), 5);
  assert.equal(instance.currentNodeId, "endTrue");
}

// --- blockUntil driven by a public-variable/game-clock condition wakes the
// waiting Activity exactly once, never re-triggering (plan §11.2 "医疗对话
// 按 blockUntil 时间触发且不会重复触发") --------------------------------------
{
  const eventBus = new EventBus();
  const variableStore = new VariableStore(eventBus);
  const gameClock = new GameClock(eventBus);
  const pv = new PublicVariableManager(null, eventBus);
  pv.register({ id: 30, type: "integer", defaultValue: 0 }); // absolute minutes "now"
  pv.register({ id: 31, type: "integer", defaultValue: 0 }); // unrelated public variable
  eventBus.on("gameClock:changed", ({ day, minutes }) => pv.set(30, (day - 1) * 1440 + minutes));

  const appointmentAt = 100; // absolute minutes
  const definition = {
    id: "medicalAppointment",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        waitForAppointment: { id: "waitForAppointment", type: "blockUntil", inputs: { condition: { nodeId: "isDue", port: "value" } } },
        isDue: { id: "isDue", type: "publicVariableCondition", inputs: { id: 30, op: "gte", value: appointmentAt } },
        triggerCount: { id: "triggerCount", type: "setVariable", inputs: { key: "triggeredCount", delta: 1 } },
        end: { id: "end", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "waitForAppointment", toPort: "flowIn" },
        { fromNodeId: "waitForAppointment", fromPort: "flowOut", toNodeId: "triggerCount", toPort: "flowIn" },
        { fromNodeId: "triggerCount", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
      ],
    },
  };
  const activityDefinitionStore = new ActivityDefinitionStore();
  activityDefinitionStore.register(definition);
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);
  const queue = activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "medicalAppointment" });

  let completedCount = 0;
  let conditionEvaluationCount = 0;
  eventBus.on(ACTIVITY_EVENTS.completed, () => completedCount += 1);

  activityExecutionService.run({
    queue,
    definition: activityDefinitionStore.get("medicalAppointment"),
    instance,
    variableStore,
    pvGateway: {
      evaluateCondition(condition) {
        conditionEvaluationCount += 1;
        return pv.evaluateCondition(condition);
      },
    },
  });
  assert.equal(queue.get(instance.instanceId).status, "unresolved", "not due yet");
  assert.equal(conditionEvaluationCount, 1, "initial wait condition is evaluated once");

  pv.set(31, 1);
  assert.equal(conditionEvaluationCount, 1, "unrelated public-variable updates do not re-run the wait");

  pv.restore({ 30: 0, 31: 1 });
  assert.equal(conditionEvaluationCount, 2, "public-variable snapshot restores wake dependencies present in the snapshot");

  pv.set(30, 10);
  assert.equal(conditionEvaluationCount, 3, "the referenced public variable wakes the wait");
  assert.equal(queue.get(instance.instanceId).status, "unresolved");

  gameClock.advance(50); // 50 < 100, still not due
  assert.equal(queue.get(instance.instanceId).status, "unresolved");
  assert.equal(conditionEvaluationCount, 4, "clock-synchronized public-variable changes wake the wait");
  assert.equal(completedCount, 0);

  gameClock.advance(50); // now at 100, exactly due
  assert.equal(queue.get(instance.instanceId).status, "resolved");
  assert.equal(completedCount, 1);
  assert.equal(variableStore.get("triggeredCount"), 1);

  // Further clock advances must not re-trigger the already-resolved instance.
  gameClock.advance(1000);
  assert.equal(completedCount, 1);
  assert.equal(variableStore.get("triggeredCount"), 1);
}

// --- Item domain example: use-item Activity queries the database, branches
// on a condition and consumes the record via the API - never bypassing it
// (plan §11.1) ---------------------------------------------------------------
{
  const dataStructureManager = new DataStructureManager();
  dataStructureManager.register({
    id: "item",
    fields: [
      { id: "id", type: "string" },
      { id: "name", type: "string" },
      { id: "quantity", type: "integer" },
      { id: "consumable", type: "bool" },
    ],
  });
  const dataStore = new DataStore(dataStructureManager);
  dataStore.registerDatabase({ databaseId: "inventoryItems", recordType: "item", primaryKey: "id" });
  dataStore.createRecord("inventoryItems", { id: "potion-1", name: "药水", quantity: 2, consumable: true });

  const definition = {
    id: "useItem",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        query: { id: "query", type: "getRecord", inputs: { databaseId: "inventoryItems", key: "potion-1", resultVariable: "item" } },
        branch: { id: "branch", type: "branch", inputs: { condition: true } },
        consume: { id: "consume", type: "updateRecord", inputs: { databaseId: "inventoryItems", key: "potion-1", patch: { quantity: 1 } } },
        useTime: { id: "useTime", type: "framework:consumeTime", inputs: { minutes: 5 } },
        notify: { id: "notify", type: "emitEvent", inputs: { eventName: "item:used", payload: "potion-1" } },
        endTrue: { id: "endTrue", type: "activityEnd", inputs: {} },
        endFalse: { id: "endFalse", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "query", toPort: "flowIn" },
        { fromNodeId: "query", fromPort: "flowOut", toNodeId: "branch", toPort: "flowIn" },
        { fromNodeId: "branch", fromPort: "true", toNodeId: "consume", toPort: "flowIn" },
        { fromNodeId: "branch", fromPort: "false", toNodeId: "endFalse", toPort: "flowIn" },
        { fromNodeId: "consume", fromPort: "flowOut", toNodeId: "useTime", toPort: "flowIn" },
        { fromNodeId: "useTime", fromPort: "flowOut", toNodeId: "notify", toPort: "flowIn" },
        { fromNodeId: "notify", fromPort: "flowOut", toNodeId: "endTrue", toPort: "flowIn" },
      ],
    },
  };
  const { ok, errors } = validateBlueprint(definition.blueprint);
  assert.equal(ok, true, `use-item blueprint should validate: ${(errors || []).join(", ")}`);

  const eventBus = new EventBus();
  const variableStore = new VariableStore(eventBus);
  const activityDefinitionStore = new ActivityDefinitionStore();
  activityDefinitionStore.register(definition);
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);
  const queue = activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "useItem" });
  const emitted = [];
  const timed = [];
  eventBus.on("item:used", (id) => emitted.push(id));

  activityExecutionService.run({
    queue, definition: activityDefinitionStore.get("useItem"), instance, variableStore, dbGateway: dataStore,
    timeGateway: (minutes) => timed.push(minutes),
    apiGateway: { call: (apiId, payload) => { if (apiId === "engine.consumeTime") return timed.push(payload.minutes); throw new Error(`Unexpected API ${apiId}`); } },
    eventGateway: (eventName, payload) => eventBus.emit(eventName, payload),
  });

  assert.equal(queue.get(instance.instanceId).status, "resolved");
  assert.equal(dataStore.getRecord("inventoryItems", "potion-1").quantity, 1, "quantity must only ever change via the database API");
  assert.deepEqual(timed, [5]);
  assert.deepEqual(emitted, ["potion-1"]);
}

console.log("public-variable-probe: all scenarios passed");
