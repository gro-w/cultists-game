import assert from "node:assert/strict";
import "./register-framework-nodes.mjs";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { ACTIVITY_EVENTS } from "../core/ActivityEvents.js";
import { validateBlueprint } from "../core/ActivityValidator.js";

const defaultDefinition = {
  id: "default",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      setInitialized: { id: "setInitialized", type: "setVariable", inputs: { key: "engine.initialized", value: true } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "setInitialized", toPort: "flowIn" },
      { fromNodeId: "setInitialized", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  },
};

// "loop" is no longer a dedicated node type (plan item 1): a loop is just an
// ordinary flow cycle - a branch's flow output wired back to a node earlier
// in the same flow, broken by the branch's own condition. Here
// `loopBranch` cycles back to itself via `incCounter` while `counter < 3`
// (evaluated by the `counterLT3` arithmetic value node), running the loop
// body exactly 3 times before falling through to `eligibleBranch`.
const combinedDefinition = {
  id: "combined",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      initCounter: { id: "initCounter", type: "setVariable", inputs: { key: "counter", value: 0 } },
      counterLT3: { id: "counterLT3", type: "arithmetic", inputs: { operator: "<", left: { variable: "counter" }, right: 3 } },
      loopBranch: { id: "loopBranch", type: "branch", inputs: { condition: { nodeId: "counterLT3", port: "value" } } },
      incCounter: { id: "incCounter", type: "setVariable", inputs: { key: "counter", delta: 1 } },
      setEligible: { id: "setEligible", type: "setVariable", inputs: { key: "eligible", value: true } },
      eligibleBranch: { id: "eligibleBranch", type: "branch", inputs: { condition: { variable: "eligible" } } },
      consume: { id: "consume", type: "framework:consumeTime", inputs: { minutes: 20 } },
      wait: { id: "wait", type: "blockUntil", inputs: { key: "approved", equals: true } },
      endTrue: { id: "endTrue", type: "activityEnd", inputs: {} },
      endFalse: { id: "endFalse", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "initCounter", toPort: "flowIn" },
      { fromNodeId: "initCounter", fromPort: "flowOut", toNodeId: "loopBranch", toPort: "flowIn" },
      // The loop body: while counter < 3, increment and cycle back to loopBranch.
      { fromNodeId: "loopBranch", fromPort: "true", toNodeId: "incCounter", toPort: "flowIn" },
      { fromNodeId: "incCounter", fromPort: "flowOut", toNodeId: "loopBranch", toPort: "flowIn" },
      // Loop exits (counter reached 3) into the rest of the original scenario.
      { fromNodeId: "loopBranch", fromPort: "false", toNodeId: "setEligible", toPort: "flowIn" },
      { fromNodeId: "setEligible", fromPort: "flowOut", toNodeId: "eligibleBranch", toPort: "flowIn" },
      { fromNodeId: "eligibleBranch", fromPort: "true", toNodeId: "consume", toPort: "flowIn" },
      { fromNodeId: "eligibleBranch", fromPort: "false", toNodeId: "endFalse", toPort: "flowIn" },
      { fromNodeId: "consume", fromPort: "flowOut", toNodeId: "wait", toPort: "flowIn" },
      { fromNodeId: "wait", fromPort: "flowOut", toNodeId: "endTrue", toPort: "flowIn" },
    ],
  },
};

function makeEngine(definitions) {
  const eventBus = new EventBus();
  const variableStore = new VariableStore(eventBus);
  const activityDefinitionStore = new ActivityDefinitionStore();
  definitions.forEach((definition) => activityDefinitionStore.register(definition));
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus, { activityDefinitionStore });
  return { eventBus, variableStore, activityDefinitionStore, activityQueueRegistry, activityExecutionService };
}

// --- Blueprint validation ----------------------------------------------------
{
  const { ok, errors } = validateBlueprint(defaultDefinition.blueprint);
  assert.equal(ok, true, `default blueprint should validate: ${errors.join(", ")}`);

  const broken = validateBlueprint({ nodes: { a: { id: "a", type: "flowStart" } }, connections: [] });
  assert.equal(broken.ok, false);
  assert.ok(broken.errors.some((message) => message.includes("结束")));
}

// --- Scenario 1: default/default auto-runs on the main queue -----------------
{
  const engine = makeEngine([defaultDefinition]);
  const mainQueue = engine.activityQueueRegistry.get("main");
  const instance = mainQueue.append({ activityId: "default" });
  let completedEvents = 0;
  engine.eventBus.on(ACTIVITY_EVENTS.completed, () => completedEvents += 1);

  engine.activityExecutionService.run({
    queue: mainQueue,
    definition: engine.activityDefinitionStore.get("default"),
    instance,
    variableStore: engine.variableStore,
  });

  assert.equal(engine.variableStore.get("engine.initialized"), true);
  assert.equal(mainQueue.get(instance.instanceId).status, "resolved");
  assert.equal(completedEvents, 1);
}

// --- Scenario 2: custom setVariable succeeds on a non-main queue -------------
{
  const engine = makeEngine([defaultDefinition]);
  const queue = engine.activityQueueRegistry.register("social");
  const instance = queue.append({ activityId: "default" });
  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("default"),
    instance,
    variableStore: engine.variableStore,
  });
  assert.equal(engine.variableStore.get("engine.initialized"), true);
}

// --- Scenario 3: branch/loop/blockUntil/consumeTime, resumable across "save" -
{
  const engine = makeEngine([combinedDefinition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "combined" });
  const timedMinutes = [];

  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("combined"),
    instance,
    variableStore: engine.variableStore,
    timeGateway: (minutes) => timedMinutes.push(minutes),
    apiGateway: { call: (apiId, payload) => { if (apiId === "engine.consumeTime") return timedMinutes.push(payload.minutes); throw new Error(`Unexpected API ${apiId}`); } },
  });

  // loop ran 3 times, branch took the true path, consumeTime fired once, then blocked.
  assert.equal(engine.variableStore.get("counter"), 3);
  assert.equal(engine.variableStore.get("eligible"), true);
  assert.deepEqual(timedMinutes, [20]);
  assert.equal(queue.get(instance.instanceId).status, "unresolved");
  assert.equal(queue.get(instance.instanceId).waitingNodeId, "wait");

  // Simulate save/restore: fresh registries built purely from a snapshot.
  const snapshot = engine.activityQueueRegistry.snapshot();
  const restoredEngine = makeEngine([combinedDefinition]);
  restoredEngine.variableStore.restore(engine.variableStore.snapshot());
  restoredEngine.activityQueueRegistry.restore(snapshot);
  const restoredQueue = restoredEngine.activityQueueRegistry.get("main");
  const restoredInstance = restoredQueue.get(instance.instanceId);
  assert.equal(restoredInstance.waitingNodeId, "wait");

  let terminalCount = 0;
  restoredEngine.eventBus.on(ACTIVITY_EVENTS.completed, () => terminalCount += 1);

  restoredEngine.activityExecutionService.run({
    queue: restoredQueue,
    definition: restoredEngine.activityDefinitionStore.get("combined"),
    instance: restoredInstance,
    variableStore: restoredEngine.variableStore,
    timeGateway: (minutes) => timedMinutes.push(minutes),
    apiGateway: { call: (apiId, payload) => { if (apiId === "engine.consumeTime") return timedMinutes.push(payload.minutes); throw new Error(`Unexpected API ${apiId}`); } },
  });
  // Still blocked immediately after restore: "approved" hasn't been set yet.
  assert.equal(restoredQueue.get(instance.instanceId).status, "unresolved");
  assert.equal(terminalCount, 0);
  assert.deepEqual(timedMinutes, [20], "consumeTime must not re-fire for the already-executed node");
  const waitingTraceLength = restoredQueue.get(instance.instanceId).executionTrace.length;
  restoredEngine.variableStore.set("unrelated", true);
  assert.equal(restoredQueue.get(instance.instanceId).executionTrace.length, waitingTraceLength, "unrelated variable changes do not re-evaluate blockUntil");

  // Now satisfy the wait condition and confirm it resumes to completion exactly once.
  restoredEngine.variableStore.set("approved", true);
  assert.equal(restoredQueue.get(instance.instanceId).status, "resolved");
  assert.equal(terminalCount, 1);

  // Firing another variable change after completion must not re-emit a terminal event.
  restoredEngine.variableStore.set("unrelated", false);
  assert.equal(terminalCount, 1);
}

// --- Scenario 4: terminal events (fail/cancel/duplicate-complete) fire once --
{
  const engine = makeEngine([combinedDefinition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "combined" });
  let cancelledCount = 0;
  engine.eventBus.on(ACTIVITY_EVENTS.cancelled, () => cancelledCount += 1);

  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("combined"),
    instance,
    variableStore: engine.variableStore,
    apiGateway: { call: (apiId) => { if (apiId === "engine.consumeTime") return true; throw new Error(`Unexpected API ${apiId}`); } },
  });
  assert.equal(queue.get(instance.instanceId).status, "unresolved"); // blocked on "approved"

  assert.equal(engine.activityExecutionService.cancel(instance.instanceId), true);
  assert.equal(cancelledCount, 1);
  assert.equal(queue.get(instance.instanceId).status, "resolved");
  assert.equal(queue.get(instance.instanceId).resolutionReason, "cancelled");

  // Cancelling an already-resolved instance is a no-op: no duplicate event, no runner to act on.
  assert.equal(engine.activityExecutionService.cancel(instance.instanceId), false);
  assert.equal(cancelledCount, 1);
  assert.equal(queue.complete(instance.instanceId), false, "queue.complete on a resolved instance is a no-op");
}

// --- Scenario 5: value-port wiring - arithmetic + getVariable feed a branch's
// condition via connections instead of a literal/`{variable}` input --------
{
  const valueWiredDefinition = {
    id: "valueWired",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        initThreshold: { id: "initThreshold", type: "setVariable", inputs: { key: "threshold", value: 10 } },
        getThreshold: { id: "getThreshold", type: "getVariable", inputs: { key: "threshold" } },
        addBonus: { id: "addBonus", type: "arithmetic", inputs: { operator: "+", right: 5 } },
        compare: { id: "compare", type: "arithmetic", inputs: { operator: ">", right: 12 } },
        branch: { id: "branch", type: "branch", inputs: {} },
        endTrue: { id: "endTrue", type: "activityEnd", inputs: {} },
        endFalse: { id: "endFalse", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "initThreshold", toPort: "flowIn" },
        { fromNodeId: "initThreshold", fromPort: "flowOut", toNodeId: "branch", toPort: "flowIn" },
        // addBonus.left <- getThreshold.value (chained value node)
        { fromNodeId: "getThreshold", fromPort: "value", toNodeId: "addBonus", toPort: "left" },
        // compare.left <- addBonus.value (threshold(10) + 5 = 15)
        { fromNodeId: "addBonus", fromPort: "value", toNodeId: "compare", toPort: "left" },
        // branch.condition <- compare.value (15 > 12 => true)
        { fromNodeId: "compare", fromPort: "value", toNodeId: "branch", toPort: "condition" },
        { fromNodeId: "branch", fromPort: "true", toNodeId: "endTrue", toPort: "flowIn" },
        { fromNodeId: "branch", fromPort: "false", toNodeId: "endFalse", toPort: "flowIn" },
      ],
    },
  };
  const { ok, errors } = validateBlueprint(valueWiredDefinition.blueprint);
  assert.equal(ok, true, `value-wired blueprint should validate: ${errors.join(", ")}`);

  const engine = makeEngine([valueWiredDefinition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "valueWired" });
  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("valueWired"),
    instance,
    variableStore: engine.variableStore,
  });
  assert.equal(queue.get(instance.instanceId).status, "resolved");
  // The chained value graph (getVariable -> arithmetic -> arithmetic -> branch)
  // must have evaluated to true: (10 + 5) > 12, so the flow must reach endTrue.
  assert.equal(instance.currentNodeId, "endTrue");
  assert.equal(instance.executedNodeIds.includes("initThreshold"), true);
}

// --- Scenario 6: breakpoints and exact progress survive a queue snapshot ---
{
  const breakpointDefinition = {
    id: "breakpoint-resume",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        effect: { id: "effect", type: "setVariable", inputs: { key: "breakpoint.value", value: 42 } },
        end: { id: "end", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "effect", toPort: "flowIn" },
        { fromNodeId: "effect", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
      ],
    },
  };
  const engine = makeEngine([breakpointDefinition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "breakpoint-resume" });
  assert.equal(engine.activityExecutionService.update(queue, instance.instanceId, { breakpointNodeIds: ["missing-node"] }), false);
  assert.equal(engine.activityExecutionService.update(queue, instance.instanceId, { breakpointNodeIds: ["effect"] }), true);
  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("breakpoint-resume"),
    instance,
    variableStore: engine.variableStore,
  });
  assert.equal(instance.status, "paused");
  assert.equal(instance.currentNodeId, "effect");
  assert.equal(instance.pausedAtBreakpointId, "effect");
  assert.equal(engine.variableStore.get("breakpoint.value"), undefined, "a breakpoint stops before its node side effect");
  assert.equal(instance.executionTrace.at(-1).status, "breakpoint");
  const savedQueues = engine.activityQueueRegistry.snapshot();

  const restoredEngine = makeEngine([breakpointDefinition]);
  restoredEngine.activityQueueRegistry.restore(savedQueues);
  const restoredQueue = restoredEngine.activityQueueRegistry.get("main");
  const restoredInstance = restoredQueue.get(instance.instanceId);
  assert.deepEqual(restoredInstance.breakpointNodeIds, ["effect"]);
  assert.equal(restoredInstance.pausedAtBreakpointId, "effect");
  assert.deepEqual(restoredInstance.executionTrace, instance.executionTrace);
  const restoredRunner = restoredEngine.activityExecutionService.run({
    queue: restoredQueue,
    definition: restoredEngine.activityDefinitionStore.get("breakpoint-resume"),
    instance: restoredInstance,
    variableStore: restoredEngine.variableStore,
  });
  assert.ok(restoredRunner, "restore must reattach a paused instance to a runner");
  assert.equal(restoredEngine.variableStore.get("breakpoint.value"), undefined);
  assert.equal(restoredEngine.activityExecutionService.update(restoredQueue, restoredInstance.instanceId, { status: "unresolved" }), true);
  assert.equal(restoredEngine.variableStore.get("breakpoint.value"), 42);
  assert.equal(restoredInstance.status, "resolved");
  assert.equal(restoredInstance.executionTrace.filter((step) => step.nodeId === "effect" && step.status === "executed").length, 1);
  assert.equal(restoredInstance.executionStep, restoredInstance.executionTrace.length);
}

// --- Scenario 7: debugger step selection cancels a stale wait and resumes at the selected node ---
{
  const seekDefinition = {
    id: "debugger-seek",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        wait: { id: "wait", type: "blockUntil", inputs: { key: "approved", equals: true } },
        effect: { id: "effect", type: "setVariable", inputs: { key: "debug-seek.value", value: 1 } },
        end: { id: "end", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "wait", toPort: "flowIn" },
        { fromNodeId: "wait", fromPort: "flowOut", toNodeId: "effect", toPort: "flowIn" },
        { fromNodeId: "effect", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
      ],
    },
  };
  const engine = makeEngine([seekDefinition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: seekDefinition.id });
  engine.activityExecutionService.run({ queue, definition: engine.activityDefinitionStore.get(seekDefinition.id), instance, variableStore: engine.variableStore });
  assert.equal(instance.waitingNodeId, "wait");
  assert.equal(engine.activityExecutionService.update(queue, instance.instanceId, { currentNodeId: "effect" }), true);
  assert.equal(instance.status, "paused");
  assert.equal(instance.waitingNodeId, null);
  assert.equal(instance.executionTrace.at(-1).status, "debug-seek");
  assert.equal(engine.activityExecutionService.update(queue, instance.instanceId, { status: "unresolved" }), true);
  assert.equal(instance.status, "resolved");
  assert.equal(engine.variableStore.get("debug-seek.value"), 1);
  engine.variableStore.set("approved", true);
  assert.equal(engine.variableStore.get("debug-seek.value"), 1, "old wait subscriptions must not resume a manually selected step");
}

// --- Scenario: openWindow node calls windowGateway once and does not
// re-fire on resume (plan §7.4 "打开窗口本身不推进时间"; one-shot like consumeTime) --
{
  const openWindowDefinition = {
    id: "openWindowActivity",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        open: { id: "open", type: "openWindow", inputs: { windowId: "off-duty" } },
        consume: { id: "consume", type: "framework:consumeTime", inputs: { minutes: 20 } },
        wait: { id: "wait", type: "blockUntil", inputs: { key: "leftWindow", equals: true } },
        end: { id: "end", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "open", toPort: "flowIn" },
        { fromNodeId: "open", fromPort: "flowOut", toNodeId: "consume", toPort: "flowIn" },
        { fromNodeId: "consume", fromPort: "flowOut", toNodeId: "wait", toPort: "flowIn" },
        { fromNodeId: "wait", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
      ],
    },
  };
  const engine = makeEngine([openWindowDefinition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "openWindowActivity" });
  const openedWindowIds = [];
  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("openWindowActivity"),
    instance,
    variableStore: engine.variableStore,
    windowGateway: (windowId) => openedWindowIds.push(windowId),
    apiGateway: { call: (apiId) => { if (apiId === "engine.consumeTime") return true; throw new Error(`Unexpected API ${apiId}`); } },
  });
  assert.deepEqual(openedWindowIds, ["off-duty"]);
  assert.equal(queue.get(instance.instanceId).waitingNodeId, "wait");

  // Resume (e.g. after save/reload): openWindow must not be called again.
  const snapshot = engine.activityQueueRegistry.snapshot();
  const restoredEngine = makeEngine([openWindowDefinition]);
  restoredEngine.activityQueueRegistry.restore(snapshot);
  const restoredQueue = restoredEngine.activityQueueRegistry.get("main");
  const restoredInstance = restoredQueue.get(instance.instanceId);
  restoredEngine.activityExecutionService.run({
    queue: restoredQueue,
    definition: restoredEngine.activityDefinitionStore.get("openWindowActivity"),
    instance: restoredInstance,
    variableStore: restoredEngine.variableStore,
    windowGateway: (windowId) => openedWindowIds.push(windowId),
    apiGateway: { call: (apiId) => { if (apiId === "engine.consumeTime") return true; throw new Error(`Unexpected API ${apiId}`); } },
  });
  assert.deepEqual(openedWindowIds, ["off-duty"], "openWindow must not re-fire on resume");
}

console.log("activity-runtime-probe: all scenarios passed");
