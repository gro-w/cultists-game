// Proves two generic value nodes added for the Phase 8 HIS/ChatGTP window
// work: `getProperty` reads one field off an object value (e.g. a
// `getRecord`/`findRecords` result already stored in variableStore) so a
// window's `valueGraph` can feed a widget's `text`/`options` property with
// e.g. a selected patient's `name`; `arrayAppend` builds up a list one
// click at a time (e.g. an "add to prescription" button). Neither node is
// domain-specific.
import assert from "node:assert/strict";
import { VariableStore } from "../core/VariableStore.js";
import EventBus from "../core/EventBus.js";
import { evaluateValueOutput } from "../core/ActivityRunner.js";

const eventBus = new EventBus();
const variableStore = new VariableStore(eventBus);
variableStore.set("selectedPatient", { id: "p1", name: "林若晴", age: 24 });
variableStore.set("nothing", null);

const blueprint = {
  nodes: {
    patient: { id: "patient", type: "getVariable", inputs: { key: "selectedPatient" } },
    name: { id: "name", type: "getProperty", inputs: { value: { nodeId: "patient", port: "value" }, key: "name" } },
    missing: { id: "missing", type: "getProperty", inputs: { value: { variable: "nothing" }, key: "name" } },
  },
};

// --- reads a nested field off a chained value node ---------------------
{
  const value = evaluateValueOutput(blueprint, "name", "value", variableStore, new Set());
  assert.equal(value, "林若晴");
}

// --- null/undefined target reads back undefined, never throws -----------
{
  const value = evaluateValueOutput(blueprint, "missing", "value", variableStore, new Set());
  assert.equal(value, undefined);
}

// --- direct literal object + missing key ---------------------------------
{
  const directBlueprint = {
    nodes: { age: { id: "age", type: "getProperty", inputs: { value: { variable: "selectedPatient" }, key: "age" } } },
  };
  const value = evaluateValueOutput(directBlueprint, "age", "value", variableStore, new Set());
  assert.equal(value, 24);
}

// --- arrayAppend: builds up a list one click at a time -------------------
{
  variableStore.set("picked", ["a"]);
  const appendBlueprint = {
    nodes: {
      append: { id: "append", type: "arrayAppend", inputs: { array: { variable: "picked" }, item: "b" } },
    },
  };
  const value = evaluateValueOutput(appendBlueprint, "append", "value", variableStore, new Set());
  assert.deepEqual(value, ["a", "b"]);
}

// --- arrayAppend: missing/non-array input treated as empty ---------------
{
  const appendBlueprint = {
    nodes: {
      append: { id: "append", type: "arrayAppend", inputs: { array: { variable: "nothing" }, item: "first" } },
    },
  };
  const value = evaluateValueOutput(appendBlueprint, "append", "value", variableStore, new Set());
  assert.deepEqual(value, ["first"]);
}

// --- conditionalValue: ternary selection ----------------------------------
{
  const bp = {
    nodes: {
      lt: { id: "lt", type: "arithmetic", inputs: { operator: "<", left: "flu", right: "cough" } },
      pick: { id: "pick", type: "conditionalValue", inputs: { condition: { nodeId: "lt", port: "value" }, whenTrue: "flu-first", whenFalse: "cough-first" } },
    },
  };
  assert.equal(evaluateValueOutput(bp, "pick", "value", variableStore, new Set()), "cough-first");
}

// --- arithmetic "concat": string join, not numeric coercion --------------
{
  const bp = { nodes: { join: { id: "join", type: "arithmetic", inputs: { operator: "concat", left: "flu", right: "cough" } } } };
  assert.equal(evaluateValueOutput(bp, "join", "value", variableStore, new Set()), "flucough");
}

console.log("get-property-node-probe: ok");
