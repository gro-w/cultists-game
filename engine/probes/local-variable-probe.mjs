import assert from "node:assert/strict";
import { createActivityRunner } from "../core/ActivityRunner.js";
import { createActivityInstance } from "../core/ActivityInstance.js";
import VariableStore from "../core/VariableStore.js";
import EventBus from "../core/EventBus.js";

const eventBus = new EventBus();
const globals = new VariableStore(eventBus);
const instance = createActivityInstance({ instanceId: "local:1", activityId: "local", queueId: "probe", currentNodeId: "start" });
const definition = { blueprint: { startNodeId: "start", nodes: {
  start: { id: "start", type: "flowStart", next: { flowOut: { nodeId: "set", port: "flowIn" } } },
  set: { id: "set", type: "setLocalVariable", inputs: { key: "answer", value: 42 }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
  end: { id: "end", type: "activityEnd" },
} } };
const runner = createActivityRunner({ definition, instance, variableStore: globals, eventBus });
runner.start();
assert.equal(instance.status, "resolved");
assert.equal(instance.localVariables.answer, 42);
assert.equal(globals.get("answer"), undefined);
console.log("local-variable-probe: ok");
