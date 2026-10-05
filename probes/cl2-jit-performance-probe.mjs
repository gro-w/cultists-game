import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { compileCl2Activity } from "../core/Cl2Compiler.js";
import { resolveInput } from "../core/ActivityRunner.js";

const iterations = 80;
const blueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "init", port: "flowIn" } } },
    init: { id: "init", type: "setVariable", inputs: { key: "counter", value: 0 }, next: { flowOut: { nodeId: "branch", port: "flowIn" } } },
    branch: { id: "branch", type: "branch", inputs: { condition: { nodeId: "keepGoing", port: "value" } }, next: { true: { nodeId: "increment", port: "flowIn" }, false: { nodeId: "end", port: "flowIn" } } },
    increment: { id: "increment", type: "setVariable", inputs: { key: "counter", value: { nodeId: "incremented", port: "value" } }, next: { flowOut: { nodeId: "branch", port: "flowIn" } } },
    end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
    current: { id: "current", type: "getVariable", inputs: { key: "counter" }, next: {} },
    keepGoing: { id: "keepGoing", type: "arithmetic", inputs: { operator: "<", left: { nodeId: "current", port: "value" }, right: iterations }, next: {} },
    incremented: { id: "incremented", type: "arithmetic", inputs: { operator: "+", left: { nodeId: "current", port: "value" }, right: 1 }, next: {} },
  },
  connections: [],
};

const compiled = compileCl2Activity(blueprint);
assert.doesNotMatch(compiled.source, /hooks\.executeNode/);

function createHooks() {
  const values = new Map();
  let visitCount = 0;
  const variableStore = {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    delta: (key, amount) => values.set(key, (Number(values.get(key)) || 0) + (Number(amount) || 0)),
  };
  return {
    values,
    get visitCount() { return visitCount; },
    hooks: {
      enterNode: () => { visitCount += 1; return 0; },
      afterStep: () => {},
      onWait: () => {},
      finish: () => {},
      instance: { instanceId: "jit-benchmark", transcript: [] },
      variableStore,
      timeGateway: () => {},
      windowGateway: () => {},
      activityGateway: () => {},
      eventGateway: () => {},
      dbGateway: null,
      pvGateway: null,
      runtimeGateway: null,
      eventStateGateway: null,
      onboardingGateway: null,
      apiGateway: null,
      executionState: { lastDialogueDisplayTo: null },
      errorMessage: (key) => key,
      applyArithmetic: () => { throw new Error("unexpected dynamic arithmetic fallback"); },
      runMacro: () => { throw new Error("unexpected macro call"); },
    },
  };
}

function runLegacy(startNodeId, hooks) {
  let current = startNodeId;
  let steps = 0;
  let isResumeEntry = true;
  while (current && steps++ < 1000) {
    const node = blueprint.nodes[current];
    const gate = hooks.enterNode(current, node.type, isResumeEntry, null);
    if (gate === 2) return { status: "stopped", nodeId: current, steps };
    if (gate === 1) {
      current = node.next?.flowOut?.nodeId ?? null;
      isResumeEntry = false;
      continue;
    }
    let result;
    switch (current) {
      case "start": result = { next: node.next?.flowOut?.nodeId ?? null }; break;
      case "init":
      case "increment": {
        const key = resolveInput(blueprint, node, "key", hooks.variableStore, undefined, undefined, null, null, null);
        const value = resolveInput(blueprint, node, "value", hooks.variableStore, undefined, undefined, null, null, null);
        hooks.variableStore.set(key, value);
        result = { next: node.next?.flowOut?.nodeId ?? null };
        break;
      }
      case "branch": {
        const condition = Boolean(resolveInput(blueprint, node, "condition", hooks.variableStore, false, undefined, null, null, null));
        result = { next: node.next?.[condition ? "true" : "false"]?.nodeId ?? null };
        break;
      }
      case "end": hooks.finish("completed"); return { status: "stopped", nodeId: current, steps };
      default: throw new Error(`unexpected benchmark node: ${current}`);
    }
    if (result.stop) return { status: "stopped", nodeId: current, steps };
    const next = result.next ?? null;
    hooks.afterStep(current, node, next);
    current = next;
    isResumeEntry = false;
  }
  return { status: current ? "limit" : "completed", nodeId: current, steps };
}

function measureOnce(run) {
  const start = performance.now();
  for (let index = 0; index < 500; index += 1) {
    const context = createHooks();
    const { values, hooks } = context;
    const result = run(hooks);
    assert.equal(result.status, "stopped");
    assert.equal(values.get("counter"), iterations);
    assert.equal(context.visitCount, iterations * 2 + 4);
  }
  return performance.now() - start;
}

function median(samples) {
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const directRun = (hooks) => compiled.run("start", hooks);
const legacyRun = (hooks) => runLegacy("start", hooks);
for (let index = 0; index < 100; index += 1) {
  directRun(createHooks().hooks);
  legacyRun(createHooks().hooks);
}
const legacySamples = [];
const directSamples = [];
for (let sample = 0; sample < 9; sample += 1) {
  const first = sample % 2 === 0 ? [legacyRun, legacySamples] : [directRun, directSamples];
  const second = sample % 2 === 0 ? [directRun, directSamples] : [legacyRun, legacySamples];
  first[1].push(measureOnce(first[0]));
  second[1].push(measureOnce(second[0]));
}
const legacyMs = median(legacySamples);
const directMs = median(directSamples);
const speedup = legacyMs / directMs;
console.log(`cl2-jit-performance-probe: legacy=${legacyMs.toFixed(2)}ms direct=${directMs.toFixed(2)}ms speedup=${speedup.toFixed(2)}x (4500 runs each, alternating order)`);
