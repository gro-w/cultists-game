import "./register-framework-nodes.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseCl2 } from "../core/Cl2Parser.js";
import { serializeCl2 } from "../core/Cl2Serializer.js";
import { classifyActivityNodePorts } from "../core/ActivityNodeRegistry.js";
import { evaluateValueOutput } from "../core/ActivityRunner.js";
import { createActivityEditorModel } from "../dev/ActivityEditorModel.js";
import { prepareWindowValueGraph } from "../dev/WindowValueGraph.js";

function valueWireEndpoints(model) {
  return model.listConnections()
    .filter((connection) => connection.id.startsWith("value:"))
    .map(({ fromNodeId, fromPort, toNodeId, toPort }) => `${fromNodeId}.${fromPort}->${toNodeId}.${toPort}`)
    .sort();
}

function nodePositions(model) {
  return Object.fromEntries(model.listNodes().map(({ id, x, y }) => [id, { x, y }]));
}

const source = fs.readFileSync("data/activities/dorm_activity_day1.CL2.txt", "utf8");
const first = parseCl2(source, { validate: true });
assert.equal(first.ok, true, first.diagnostics.map((item) => item.message).join("；"));
const model = createActivityEditorModel({ activityId: "dorm_activity_day1", blueprint: first.graph });
const before = valueWireEndpoints(model);
const positionsBefore = nodePositions(model);
const roundTrip = parseCl2(serializeCl2(model.exportBlueprint(), { activityId: "dorm_activity_day1" }), { validate: true });
assert.equal(roundTrip.ok, true, roundTrip.diagnostics.map((item) => item.message).join("；"));
assert.deepEqual(nodePositions(createActivityEditorModel({ activityId: "dorm_activity_day1", blueprint: roundTrip.graph })), positionsBefore, "CL2 round-trip must preserve graph node positions used to draw wires");
model.loadBlueprint(roundTrip.graph);
const after = valueWireEndpoints(model);
assert.deepEqual(after, before);

const valueBlueprint = {
  nodes: {
    input: { id: "input", type: "getPublicVariable", inputs: { id: 12 } },
    plus: { id: "plus", type: "arithmetic", inputs: { operator: "+", left: { nodeId: "input", port: "value" }, right: 3 } },
    output: { id: "output", type: "valueReceiver", inputs: { value: { nodeId: "plus", port: "value" } } },
  },
};
assert.equal(classifyActivityNodePorts("arithmetic"), "value");
assert.equal(classifyActivityNodePorts("flowStart"), "flowStart");
const valueModel = createActivityEditorModel({ activityId: "window-value", blueprint: valueBlueprint, valueOnly: true });
const valueWiresBefore = valueWireEndpoints(valueModel);
const valuePositionsBefore = nodePositions(valueModel);
assert.equal(valueModel.validateForSave().ok, true);
const valueSource = valueModel.toDownloadPayload();
assert.match(valueSource, /inputvalue output:/);
const parsedValue = parseCl2(valueSource, { validate: false });
assert.equal(parsedValue.ok, true, parsedValue.diagnostics.map((item) => item.message).join("；"));
assert.equal(parsedValue.graph.nodes.output.cl2Class, "valueReceiver");
const reloadedValueModel = createActivityEditorModel({ activityId: "window-value", blueprint: parsedValue.graph, valueOnly: true });
const valueWiresAfter = valueWireEndpoints(reloadedValueModel);
assert.deepEqual(valueWiresAfter, valueWiresBefore, "CL2 source toggle must preserve numeric edges into receiver nodes");
assert.deepEqual(nodePositions(reloadedValueModel), valuePositionsBefore, "CL2 source toggle must preserve value node layout so wire geometry remains finite");
assert.equal(reloadedValueModel.validateForSave().ok, true);
assert.equal(reloadedValueModel.connect("output", "value", "plus", "right").ok, false, "receiver nodes must not be usable as wire sources");
assert.equal(evaluateValueOutput({ nodes: {
  sum: { id: "sum", type: "arithmetic", inputs: { operator: "+", left: 4, right: 3 } },
  result: { id: "result", type: "valueReceiver", inputs: { value: { nodeId: "sum", port: "value" } } },
} }, "result", "value", { get: () => undefined }, new Set()), 7);

const legacyReceiver = parseCl2('reusablevalue base: arithmetic["+", 2, 3]; inputvalue output: arithmetic["*", base[], 4];', { validate: false });
assert.equal(legacyReceiver.ok, true, legacyReceiver.diagnostics.map((item) => item.message).join("；"));
assert.equal(legacyReceiver.graph.nodes.output.type, "valueReceiver", "legacy expression-style inputvalue must normalize to a terminal receiver");
assert.equal(legacyReceiver.graph.nodes.output__value.type, "arithmetic");
valueModel.loadBlueprint(legacyReceiver.graph);
assert.ok(valueModel.listNodes().every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)), "legacy CL2 without position metadata must get drawable fallback coordinates after source reload");

function collectWidgetBindings(value, output = []) {
  if (Array.isArray(value)) value.forEach((item) => collectWidgetBindings(item, output));
  else if (value && typeof value === "object") {
    if (typeof value.nodeId === "string") output.push(value.nodeId);
    for (const [key, child] of Object.entries(value)) if (key !== "events") collectWidgetBindings(child, output);
  }
  return output;
}

for (const file of fs.readdirSync("data/windows").filter((entry) => entry.endsWith(".json")).sort()) {
  const definition = JSON.parse(fs.readFileSync(path.join("data/windows", file), "utf8"));
  if (!definition.valueGraph) continue;
  const prepared = prepareWindowValueGraph(definition);
  for (const receiverId of collectWidgetBindings(prepared.root)) {
    assert.equal(prepared.blueprint.nodes[receiverId]?.cl2Class, "valueReceiver", `${file}: ${receiverId} must be a value receiver`);
    assert.equal(prepared.blueprint.nodes[receiverId]?.type, "valueReceiver", `${file}: ${receiverId} must be outputless`);
  }
  const windowModel = createActivityEditorModel({ activityId: file, blueprint: prepared.blueprint, valueOnly: true });
  assert.equal(windowModel.validateForSave().ok, true, `${file}: ${windowModel.validateForSave().errors.join("；")}`);
  const windowWiresBefore = valueWireEndpoints(windowModel);
  const windowPositionsBefore = nodePositions(windowModel);
  const parsedWindow = parseCl2(windowModel.toDownloadPayload(), { validate: false });
  assert.equal(parsedWindow.ok, true, `${file}: ${parsedWindow.diagnostics.map((item) => item.message).join("；")}`);
  const reloadedWindow = createActivityEditorModel({ activityId: file, blueprint: parsedWindow.graph, valueOnly: true });
  const windowWiresAfter = valueWireEndpoints(reloadedWindow);
  assert.deepEqual(windowWiresAfter, windowWiresBefore, `${file}: all value wires must survive source round-trip`);
  assert.deepEqual(nodePositions(reloadedWindow), windowPositionsBefore, `${file}: CL2 round-trip must preserve all node positions`);
}

model.autoLayout();
const valueNodes = model.listNodes().filter((node) => node.inputs && Object.values(node.inputs).some((value) => value?.nodeId));
assert.ok(valueNodes.length > 1);
assert.ok(new Set(valueNodes.map((node) => node.x)).size > 1, "value nodes must not collapse into one column");
const queueManager = parseCl2(fs.readFileSync("data/activities/patient-queue-manager.CL2.txt", "utf8"), { validate: true });
assert.equal(queueManager.ok, true, queueManager.diagnostics.map((item) => item.message).join("；"));
assert.ok(queueManager.graph.nodes["slot-1-wait"].inputs.condition?.nodeId, "blockUntil boolean must bind to condition");
const social = parseCl2(fs.readFileSync("data/activities/social01b_ajie_honor_of_kings.CL2.txt", "utf8"), { validate: true });
assert.equal(social.ok, true, social.diagnostics.map((item) => item.message).join("；"));
assert.equal(social.graph.nodes.first_choice.inputs.options.length, 2);
assert.equal(social.graph.nodes.first_choice.inputs.selectionKey, "dlg:first_choice:select");
console.log(`cl2-editor-roundtrip-probe: ok (${before.length} value wires)`);
