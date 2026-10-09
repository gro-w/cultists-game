// Phase 8 legacy content migration: proves the generic `text`/`choice`
// flow nodes, the pure-value `prerequisite`/`activityExpiry` nodes, and the
// `arithmetic` "random" operator behave per plan §15 风险 F (still
// domain-agnostic — nothing here references dialogue/item/medical content,
// only opaque `displayTo`/`eventName` strings, exactly like `emitEvent`).
import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { resolveInput } from "../core/ActivityRunner.js";

function makeEngine(definitions) {
  const eventBus = new EventBus();
  const variableStore = new VariableStore(eventBus);
  const activityDefinitionStore = new ActivityDefinitionStore();
  definitions.forEach((definition) => activityDefinitionStore.register(definition));
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);
  return { eventBus, variableStore, activityDefinitionStore, activityQueueRegistry, activityExecutionService };
}

// --- text: no continueKey auto-advances, emits once per visit ---------------
{
  const definition = {
    id: "textAuto",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        line: { id: "line", type: "text", inputs: { speaker: "npc", text: "hello", displayTo: "his-app" } },
        end: { id: "end", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "line", toPort: "flowIn" },
        { fromNodeId: "line", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
      ],
    },
  };
  const { ok, errors } = validateBlueprint(definition.blueprint);
  assert.equal(ok, true, `text blueprint should validate: ${errors.join(", ")}`);

  const engine = makeEngine([definition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "textAuto" });
  const emitted = [];
  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("textAuto"),
    instance,
    variableStore: engine.variableStore,
    eventGateway: (eventName, payload) => emitted.push({ eventName, payload }),
  });
  assert.equal(queue.get(instance.instanceId).status, "resolved");
  assert.deepEqual(emitted, [
    { eventName: "display:text", payload: { instanceId: instance.instanceId, speaker: "npc", text: "hello", displayTo: "his-app", keywordIds: [], continueKey: null } },
    { eventName: "display:complete", payload: { instanceId: instance.instanceId, displayTo: "his-app", reason: "completed" } },
  ]);
}

// --- text: continueKey blocks until a widget-event blueprint sets it --------
{
  const definition = {
    id: "textWait",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        line: { id: "line", type: "text", inputs: { speaker: "npc", text: "hi", continueKey: "dlg:line:ack" } },
        end: { id: "end", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "line", toPort: "flowIn" },
        { fromNodeId: "line", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
      ],
    },
  };
  const engine = makeEngine([definition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "textWait" });
  let emitCount = 0;
  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("textWait"),
    instance,
    variableStore: engine.variableStore,
    eventGateway: () => emitCount += 1,
  });
  assert.equal(queue.get(instance.instanceId).waitingNodeId, "line");
  assert.equal(queue.get(instance.instanceId).status, "unresolved");

  // Simulate a "继续" button's onClick blueprint: setVariable(dlg:line:ack, true).
  engine.variableStore.set("dlg:line:ack", true);
  assert.equal(queue.get(instance.instanceId).status, "resolved", "setting the continueKey must wake and resolve the activity");
  assert.equal(engine.variableStore.get("dlg:line:ack"), null, "continueKey must be consumed (reset) once acted on");
  assert.ok(emitCount >= 2, "text re-emits on each wait re-check, same as blockUntil");
}

// --- choice: branches on the selected option, resets selectionKey -----------
{
  const definition = {
    id: "choiceFlow",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        pick: {
          id: "pick", type: "choice",
          inputs: { options: [{ label: "A" }, { label: "B" }], optionCount: 2, selectionKey: "dlg:pick:selected" },
        },
        onA: { id: "onA", type: "setVariable", inputs: { key: "path", value: "A" } },
        onB: { id: "onB", type: "setVariable", inputs: { key: "path", value: "B" } },
        end: { id: "end", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "pick", toPort: "flowIn" },
        { fromNodeId: "pick", fromPort: "option0", toNodeId: "onA", toPort: "flowIn" },
        { fromNodeId: "pick", fromPort: "option1", toNodeId: "onB", toPort: "flowIn" },
        { fromNodeId: "onA", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
        { fromNodeId: "onB", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
      ],
    },
  };
  const { ok, errors } = validateBlueprint(definition.blueprint);
  assert.equal(ok, true, `choice blueprint (only 2 of 6 option ports wired) should validate: ${errors.join(", ")}`);

  const engine = makeEngine([definition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "choiceFlow" });
  const emitted = [];
  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("choiceFlow"),
    instance,
    variableStore: engine.variableStore,
    eventGateway: (eventName, payload) => emitted.push(payload),
  });
  assert.equal(queue.get(instance.instanceId).waitingNodeId, "pick");
  assert.deepEqual(emitted[0].options, [{ label: "A" }, { label: "B" }]);

  engine.variableStore.set("dlg:pick:selected", 1);
  assert.equal(queue.get(instance.instanceId).status, "resolved");
  assert.equal(engine.variableStore.get("path"), "B");
  assert.equal(engine.variableStore.get("dlg:pick:selected"), null, "selectionKey must be consumed");
}

// --- choice: out-of-range selection throws, doesn't silently misroute -------
{
  const definition = {
    id: "choiceInvalid",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        pick: { id: "pick", type: "choice", inputs: { options: [{ label: "A" }], optionCount: 1, selectionKey: "sel" } },
        onA: { id: "onA", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "pick", toPort: "flowIn" },
        { fromNodeId: "pick", fromPort: "option0", toNodeId: "onA", toPort: "flowIn" },
      ],
    },
  };
  const engine = makeEngine([definition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "choiceInvalid" });
  engine.variableStore.set("sel", 7);
  assert.throws(() => engine.activityExecutionService.run({
    queue, definition: engine.activityDefinitionStore.get("choiceInvalid"), instance, variableStore: engine.variableStore,
  }), /out-of-range/);
}

// --- prerequisite/activityExpiry: pure value nodes, never flow-reachable ----
{
  const blueprint = {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      end: { id: "end", type: "activityEnd", inputs: {} },
      __prerequisite__: { id: "__prerequisite__", type: "prerequisite", inputs: { condition: true } },
      __activity_expiry__: { id: "__activity_expiry__", type: "activityExpiry", inputs: { expires: false, expiresAt: 0 } },
    },
    connections: [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" }],
  };
  const { ok, errors, blueprint: normalized } = validateBlueprint(blueprint);
  assert.equal(ok, true, `prerequisite/activityExpiry nodes unreached by flow should still validate: ${errors.join(", ")}`);

  // Mirrors how future Activity-selection logic will read these: find by
  // type, then resolve their inputs directly (no value-output pull needed).
  const prerequisiteNode = Object.values(normalized.nodes).find((node) => node.type === "prerequisite");
  const expiryNode = Object.values(normalized.nodes).find((node) => node.type === "activityExpiry");
  assert.equal(resolveInput(normalized, prerequisiteNode, "condition", new VariableStore(), false), true);
  assert.equal(resolveInput(normalized, expiryNode, "expires", new VariableStore(), true), false);
}

// --- arithmetic "random": bounded, non-deterministic -------------------------
{
  const blueprint = {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      roll: { id: "roll", type: "arithmetic", inputs: { operator: "random" } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" }],
  };
  const { blueprint: normalized } = validateBlueprint(blueprint);
  const store = new VariableStore();
  const samples = Array.from({ length: 20 }, () => resolveInput(normalized, { inputs: { value: { nodeId: "roll", port: "value" } } }, "value", store, undefined, new Set()));
  assert.ok(samples.every((value) => value >= 0 && value < 1), "random samples must be in [0, 1)");
  assert.ok(new Set(samples).size > 1, "random must not return a constant value");
}

console.log("dialogue-node-probe: all scenarios passed");
