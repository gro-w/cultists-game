import assert from "node:assert/strict";
import { registerCustomActivityNode } from "../core/ActivityNodeRegistry.js";
import { createActivityRunner } from "../core/ActivityRunner.js";
import { compileCl2Activity } from "../core/Cl2Compiler.js";

const blueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "set", port: "flowIn" } } },
    set: { id: "set", type: "setVariable", inputs: { key: "compiled", value: { nodeId: "sum", port: "value" } }, next: { flowOut: { nodeId: "branch", port: "flowIn" } } },
    branch: { id: "branch", type: "branch", inputs: { condition: { nodeId: "decision", port: "value" } }, next: { true: { nodeId: "success", port: "flowIn" }, false: { nodeId: "failure", port: "flowIn" } } },
    success: { id: "success", type: "setVariable", inputs: { key: "result", value: true }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
    failure: { id: "failure", type: "setVariable", inputs: { key: "result", value: false }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
    end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
    sum: { id: "sum", type: "arithmetic", inputs: { operator: "+", left: 2, right: 5 }, next: {} },
    decision: { id: "decision", type: "arithmetic", inputs: { operator: ">", left: { nodeId: "sum", port: "value" }, right: 6 }, next: {} },
  },
  connections: [],
};

const compiled = compileCl2Activity(blueprint);
assert.doesNotMatch(compiled.source, /hooks\.executeNode/, "generated code must not delegate each node to the runtime interpreter");
assert.doesNotMatch(compiled.source, /resolveInput|evaluateValueOutput/, "pure CL2 values must be emitted as JavaScript expressions");
assert.match(compiled.source, /variableStore\.set\(key, \(7\)\)/, "constant arithmetic should be folded during compilation");
assert.match(compiled.source, /hooks\.afterStep\("branch", "success"\)/, "constant branches should be resolved at compile time");
assert.deepEqual(compiled.debugInfo.optimizations, { constantFolds: 3, constantBranches: 1 });

const values = new Map();
const instance = { instanceId: "jit-direct", status: "unresolved", executedNodeIds: [], localVariables: {} };
const runner = createActivityRunner({
  definition: { id: "jit-direct", blueprint, compiled },
  instance,
  variableStore: { get: (key) => values.get(key), set: (key, value) => values.set(key, value), delta: () => {} },
});
runner.start();
assert.equal(values.get("compiled"), 7);
assert.equal(values.get("result"), true);
assert.equal(instance.status, "resolved");

const dynamicOperatorBlueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "set", port: "flowIn" } } },
    set: { id: "set", type: "setVariable", inputs: { key: "result", value: { nodeId: "sum", port: "value" } }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
    end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
    operator: { id: "operator", type: "getVariable", inputs: { key: "operator" }, next: {} },
    sum: { id: "sum", type: "arithmetic", inputs: { operator: { nodeId: "operator", port: "value" }, left: 2, right: 3 }, next: {} },
  },
  connections: [],
};
const dynamicOperatorCompiled = compileCl2Activity(dynamicOperatorBlueprint);
assert.match(dynamicOperatorCompiled.source, /switch \(operator\)/);
assert.doesNotMatch(dynamicOperatorCompiled.source, /hooks\.applyArithmetic/);
const dynamicValues = new Map([["operator", "+"]]);
const dynamicInstance = { instanceId: "jit-dynamic-op", status: "unresolved", executedNodeIds: [], localVariables: {} };
createActivityRunner({
  definition: { id: "jit-dynamic-op", blueprint: dynamicOperatorBlueprint, compiled: dynamicOperatorCompiled },
  instance: dynamicInstance,
  variableStore: { get: (key) => dynamicValues.get(key), set: (key, value) => dynamicValues.set(key, value), delta: () => {} },
}).start();
assert.equal(dynamicValues.get("result"), 5);
assert.equal(dynamicInstance.status, "resolved");

const protoValue = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
const objectBlueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "store", port: "flowIn" } } },
    store: { id: "store", type: "setVariable", inputs: { key: "object", value: protoValue }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
    end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
  },
  connections: [],
};
const objectValues = new Map();
const objectCompiled = compileCl2Activity(objectBlueprint);
createActivityRunner({
  definition: { id: "jit-proto", blueprint: objectBlueprint, compiled: objectCompiled },
  instance: { instanceId: "jit-proto", status: "unresolved", executedNodeIds: [], localVariables: {} },
  variableStore: { get: (key) => objectValues.get(key), set: (key, value) => objectValues.set(key, value), delta: () => {} },
}).start();
assert.equal(Object.hasOwn(objectValues.get("object"), "__proto__"), true);
assert.deepEqual(objectValues.get("object").__proto__, { polluted: true });
assert.equal(Object.getPrototypeOf(objectValues.get("object")), Object.prototype);

const sourceMapBlueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "payload", port: "flowIn" } } },
    payload: { id: "payload", type: "setVariable", inputs: { key: "text", value: "case 2: {" }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
    end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
  },
  connections: [],
};
const sourceMapCompiled = compileCl2Activity(sourceMapBlueprint);
const mappedLine = sourceMapCompiled.debugInfo.source.split("\n")[sourceMapCompiled.debugInfo.sourceMap.end.sourceLine - 1];
assert.match(mappedLine.trim(), /^case 2: \{/);

registerCustomActivityNode({
  id: "probe:optionalOutput",
  label: "Probe Optional Output",
  flowInputs: [{ name: "flowIn", kind: "flow" }],
  flowOutputs: [{ name: "left", kind: "flow" }, { name: "flowOut", kind: "flow" }],
  valueInputs: [],
  valueOutputs: [],
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "left", port: "flowIn" } } },
      left: { id: "left", type: "macroReturn", inputs: { port: "left" }, next: {} },
    },
  },
});
const macroBlueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "macro", port: "flowIn" } } },
    macro: { id: "macro", type: "probe:optionalOutput", inputs: {}, next: { flowOut: { nodeId: "fallback", port: "flowIn" } } },
    fallback: { id: "fallback", type: "setVariable", inputs: { key: "macroFallback", value: true }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
    end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
  },
  connections: [],
};
const macroValues = new Map();
const macroInstance = { instanceId: "jit-macro-fallback", status: "unresolved", executedNodeIds: [], localVariables: {} };
const macroCompiled = compileCl2Activity(macroBlueprint);
createActivityRunner({
  definition: { id: "jit-macro-fallback", blueprint: macroBlueprint, compiled: macroCompiled },
  instance: macroInstance,
  variableStore: { get: (key) => macroValues.get(key), set: (key, value) => macroValues.set(key, value), delta: () => {} },
}).start();
assert.equal(macroValues.get("macroFallback"), true);
assert.equal(macroInstance.status, "resolved");

console.log("cl2-jit-direct-codegen-probe: node/value codegen, optimizations, safe constants, source maps and macro fallbacks passed");
