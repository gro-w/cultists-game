import assert from "node:assert/strict";
import { registerCustomActivityNode } from "../core/ActivityNodeRegistry.js";
import { createActivityRunner } from "../core/ActivityRunner.js";
import { createActivityInstance } from "../core/ActivityInstance.js";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { validateBlueprint } from "../core/ActivityValidator.js";

registerCustomActivityNode({
  id: "probe:returnPort",
  label: "Probe Return Port",
  flowInputs: [{ name: "flowIn", kind: "flow" }],
  flowOutputs: [{ name: "left", kind: "flow" }, { name: "right", kind: "flow" }],
  valueInputs: [{ name: "condition", kind: "value", type: "bool" }],
  valueOutputs: [],
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "choose", port: "flowIn" } } },
      choose: { id: "choose", type: "branch", inputs: { condition: { parameter: "condition" } }, next: { true: { nodeId: "left", port: "flowIn" }, false: { nodeId: "right", port: "flowIn" } } },
      left: { id: "left", type: "macroReturn", inputs: { port: "left" }, next: {} },
      right: { id: "right", type: "macroReturn", inputs: { port: "right" }, next: {} },
    },
  },
});

function run(condition) {
  const eventBus = new EventBus();
  const variables = new VariableStore(eventBus);
  const definition = {
    id: "probe",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "macro", port: "flowIn" } } },
        macro: { id: "macro", type: "probe:returnPort", inputs: { condition }, next: { left: { nodeId: "left", port: "flowIn" }, right: { nodeId: "right", port: "flowIn" } } },
        left: { id: "left", type: "setVariable", inputs: { key: "result", value: "left" }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
        right: { id: "right", type: "setVariable", inputs: { key: "result", value: "right" }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
        end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
      },
    },
  };
  const checked = validateBlueprint(definition.blueprint);
  assert.equal(checked.ok, true, checked.errors?.join("；"));
  const instance = createActivityInstance("probe");
  createActivityRunner({ definition, instance, variableStore: variables, eventBus }).start();
  return { status: instance.status, result: variables.get("result") };
}

assert.deepEqual(run(true), { status: "resolved", result: "left" });
assert.deepEqual(run(false), { status: "resolved", result: "right" });
console.log("custom-node-return-probe: all scenarios passed");
