import assert from "node:assert/strict";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { ActivityQueue } from "../core/ActivityQueue.js";
import { ACTIVITY_EVENTS } from "../core/ActivityEvents.js";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";

const iterations = 300;
const definition = {
  id: "checkpoint-coalescing",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "initialize", port: "flowIn" } } },
      initialize: { id: "initialize", type: "setVariable", inputs: { key: "counter", value: 0 }, next: { flowOut: { nodeId: "check", port: "flowIn" } } },
      check: { id: "check", type: "branch", inputs: { condition: { nodeId: "underLimit", port: "value" } }, next: { true: { nodeId: "increment", port: "flowIn" }, false: { nodeId: "end", port: "flowIn" } } },
      increment: { id: "increment", type: "setVariable", inputs: { key: "counter", value: { nodeId: "nextCounter", port: "value" } }, next: { flowOut: { nodeId: "check", port: "flowIn" } } },
      end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
      currentCounter: { id: "currentCounter", type: "getVariable", inputs: { key: "counter" }, next: {} },
      underLimit: { id: "underLimit", type: "arithmetic", inputs: { operator: "<", left: { nodeId: "currentCounter", port: "value" }, right: iterations }, next: {} },
      nextCounter: { id: "nextCounter", type: "arithmetic", inputs: { operator: "+", left: { nodeId: "currentCounter", port: "value" }, right: 1 }, next: {} },
    },
    connections: [],
  },
};
const eventBus = new EventBus();
const variableStore = new VariableStore(eventBus);
const queue = new ActivityQueue("main");
for (let index = 0; index < 2000; index += 1) {
  queue.append({ activityId: `archived-${index}` }).status = "resolved";
}
const instance = queue.append({ activityId: definition.id });
const execution = new ActivityExecutionService(eventBus);
let changedEvents = 0;
let changedAtTerminalState = false;
eventBus.on(ACTIVITY_EVENTS.changed, ({ instance: snapshot }) => {
  changedEvents += 1;
  changedAtTerminalState = snapshot.status === "resolved";
});
execution.run({ queue, definition, instance, variableStore });

assert.equal(instance.status, "resolved");
assert.equal(variableStore.get("counter"), iterations);
assert.equal(instance.executionTrace.length, iterations * 2 + 4);
assert.equal(queue.get(instance.instanceId).executionTrace.length, iterations * 2 + 4);
assert.equal(changedEvents, 1, "synchronous node checkpoints should be coalesced into one observable lifecycle update");
assert.equal(changedAtTerminalState, true, "the coalesced update must expose the final resolved state");

function assertYieldNotification({ breakpoint = false } = {}) {
  const waitDefinition = {
    id: breakpoint ? "breakpoint-yield" : "wait-yield",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "wait", port: "flowIn" } } },
        wait: { id: "wait", type: "blockUntil", inputs: { condition: false }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
        end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
      },
      connections: [],
    },
  };
  const yieldBus = new EventBus();
  const yieldQueue = new ActivityQueue("main");
  const yieldInstance = yieldQueue.append({ activityId: waitDefinition.id });
  if (breakpoint) yieldInstance.breakpointNodeIds = ["wait"];
  let notifications = 0;
  yieldBus.on(ACTIVITY_EVENTS.changed, () => notifications += 1);
  new ActivityExecutionService(yieldBus).run({
    queue: yieldQueue,
    definition: waitDefinition,
    instance: yieldInstance,
    variableStore: new VariableStore(yieldBus),
  });
  assert.equal(notifications, 1, "a wait or breakpoint must publish the yielded Activity state");
  assert.equal(yieldQueue.get(yieldInstance.instanceId).status, breakpoint ? "paused" : "unresolved");
  assert.equal(yieldQueue.get(yieldInstance.instanceId).waitingNodeId, breakpoint ? null : "wait");
}

assertYieldNotification();
assertYieldNotification({ breakpoint: true });
console.log(`activity-checkpoint-coalescing-probe: ${instance.executionTrace.length} saved steps, activity:changed ${instance.executionTrace.length}→${changedEvents}; wait/breakpoint notifications preserved`);
