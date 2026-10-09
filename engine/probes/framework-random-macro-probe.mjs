import assert from "node:assert/strict";
import "./register-framework-nodes.mjs";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { createActivityRunner } from "../core/ActivityRunner.js";
import { createActivityInstance } from "../core/ActivityInstance.js";

function run(type, input, random) {
  const oldRandom = Math.random;
  Math.random = () => random;
  try {
    const eventBus = new EventBus();
    const variables = new VariableStore(eventBus);
    const outputs = type === "framework:randomBranch"
      ? Array.from({ length: 20 }, (_, i) => [`flowOut${i}`, String(i)])
      : [["largeSuccess", "largeSuccess"], ["success", "success"], ["failure", "failure"], ["largeFailure", "largeFailure"]];
    const nodes = {
      start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "macro", port: "flowIn" } } },
      macro: { id: "macro", type, inputs: { n: input }, next: Object.fromEntries(outputs.map(([port], i) => [port, { nodeId: `out${i}`, port: "flowIn" }])) },
      ...Object.fromEntries(outputs.map(([port, value], i) => [`out${i}`, { id: `out${i}`, type: "setVariable", inputs: { key: "result", value }, next: { flowOut: { nodeId: "end", port: "flowIn" } } }])),
      end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
    };
    const instance = createActivityInstance("probe");
    createActivityRunner({ definition: { id: "probe", blueprint: { startNodeId: "start", nodes } }, instance, variableStore: variables, eventBus }).start();
    return variables.get("result");
  } finally {
    Math.random = oldRandom;
  }
}

assert.equal(run("framework:randomBranch", 4, 0.51), "2");
assert.equal(run("framework:diceCheck", 10, 0.99), "largeSuccess");
assert.equal(run("framework:diceCheck", 10, 0.60), "success");
assert.equal(run("framework:diceCheck", 10, 0.10), "failure");
assert.equal(run("framework:diceCheck", 15, 0.01), "largeFailure");
console.log("framework-random-macro-probe: all scenarios passed");
