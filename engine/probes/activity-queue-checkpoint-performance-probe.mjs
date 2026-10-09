import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { ActivityQueue } from "../core/ActivityQueue.js";
import { compileCl2Activity } from "../core/Cl2Compiler.js";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";

const historicalEntries = 2000;
const loopCount = 80;
const runsPerSample = 10;
const definition = {
  id: "queue-checkpoint-benchmark",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "initialize", port: "flowIn" } } },
      initialize: { id: "initialize", type: "setVariable", inputs: { key: "counter", value: 0 }, next: { flowOut: { nodeId: "check", port: "flowIn" } } },
      check: { id: "check", type: "branch", inputs: { condition: { nodeId: "underLimit", port: "value" } }, next: { true: { nodeId: "increment", port: "flowIn" }, false: { nodeId: "end", port: "flowIn" } } },
      increment: { id: "increment", type: "setVariable", inputs: { key: "counter", value: { nodeId: "nextCounter", port: "value" } }, next: { flowOut: { nodeId: "check", port: "flowIn" } } },
      end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
      currentCounter: { id: "currentCounter", type: "getVariable", inputs: { key: "counter" }, next: {} },
      underLimit: { id: "underLimit", type: "arithmetic", inputs: { operator: "<", left: { nodeId: "currentCounter", port: "value" }, right: loopCount }, next: {} },
      nextCounter: { id: "nextCounter", type: "arithmetic", inputs: { operator: "+", left: { nodeId: "currentCounter", port: "value" }, right: 1 }, next: {} },
    },
    connections: [],
  },
};
definition.compiled = compileCl2Activity(definition.blueprint);

function runBatch(useLinearLookup) {
  for (let runIndex = 0; runIndex < runsPerSample; runIndex += 1) {
    const eventBus = new EventBus();
    const variableStore = new VariableStore(eventBus);
    const queue = new ActivityQueue("main");
    for (let index = 0; index < historicalEntries; index += 1) {
      queue.append({ activityId: `history-${index}` }).status = "resolved";
    }
    if (useLinearLookup) {
      queue.get = function getByScan(instanceId) {
        return this.entries.find((entry) => entry.instanceId === instanceId) || null;
      };
    }
    const instance = queue.append({ activityId: definition.id });
    new ActivityExecutionService(eventBus).run({ queue, definition, instance, variableStore });
    assert.equal(instance.status, "resolved");
    assert.equal(variableStore.get("counter"), loopCount);
    assert.equal(instance.executionTrace.length, loopCount * 2 + 4);
    assert.equal(queue.get(instance.instanceId), instance);
  }
}

function measure(useLinearLookup) {
  const start = performance.now();
  runBatch(useLinearLookup);
  return performance.now() - start;
}

// Warm both paths, then alternate order to limit order and JIT-up bias.
runBatch(false);
runBatch(true);
const indexedSamples = [];
const linearSamples = [];
for (let sample = 0; sample < 7; sample += 1) {
  const first = sample % 2 === 0 ? [false, indexedSamples] : [true, linearSamples];
  const second = sample % 2 === 0 ? [true, linearSamples] : [false, indexedSamples];
  first[1].push(measure(first[0]));
  second[1].push(measure(second[0]));
}
function median(samples) {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)];
}
const indexedMs = median(indexedSamples);
const linearMs = median(linearSamples);
console.log(`activity-queue-checkpoint-performance-probe: ${runsPerSample * 7} full Activity runs per mode, ${historicalEntries} queued entries; linear=${linearMs.toFixed(2)}ms indexed=${indexedMs.toFixed(2)}ms speedup=${(linearMs / indexedMs).toFixed(2)}x`);
