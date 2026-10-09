import assert from "node:assert/strict";
import { resolvePropertyValue, isBoundValue } from "../core/PropertyBinding.js";
import { VariableStore } from "../core/VariableStore.js";
import EventBus from "../core/EventBus.js";

// --- literal values pass through unchanged ---------------------------------
{
  assert.equal(resolvePropertyValue("hello", {}), "hello");
  assert.equal(resolvePropertyValue(42, {}), 42);
  assert.equal(resolvePropertyValue(undefined, {}, "fallback"), "fallback");
  assert.equal(isBoundValue("hello"), false);
  assert.equal(isBoundValue(42), false);
}

// --- {variable} binding reads straight from the VariableStore -------------
{
  const variableStore = new VariableStore(new EventBus());
  variableStore.set("playerName", "阿七");
  assert.equal(isBoundValue({ variable: "playerName" }), true);
  assert.equal(resolvePropertyValue({ variable: "playerName" }, { variableStore }), "阿七");
  // an unset variable resolves to undefined, same as VariableStore.get()
  assert.equal(resolvePropertyValue({ variable: "missing" }, { variableStore }), undefined);
}

// --- {nodeId, port} binding evaluates a pure value node in the window's
// own valueGraph, mirroring ActivityRunner's value-port resolution --------
{
  const variableStore = new VariableStore(new EventBus());
  variableStore.set("san", 40);
  const valueGraph = {
    nodes: {
      halveSan: { id: "halveSan", type: "arithmetic", inputs: { operator: "/", left: { variable: "san" }, right: 2 } },
    },
  };
  assert.equal(isBoundValue({ nodeId: "halveSan" }), true);
  assert.equal(resolvePropertyValue({ nodeId: "halveSan" }, { valueGraph, variableStore }), 20);
  valueGraph.nodes.halveSanReceiver = {
    id: "halveSanReceiver",
    type: "valueReceiver",
    cl2Class: "valueReceiver",
    inputs: { value: { nodeId: "halveSan", port: "value" } },
  };
  assert.equal(resolvePropertyValue({ nodeId: "halveSanReceiver" }, { valueGraph, variableStore }), 20);
}

// --- a bound value with no valueGraph/variableStore available falls back
// safely instead of throwing (e.g. an editor preview with no live store) --
{
  assert.equal(resolvePropertyValue({ nodeId: "missing" }, {}, "fallback"), "fallback");
}

console.log("property-binding-probe: all scenarios passed");
