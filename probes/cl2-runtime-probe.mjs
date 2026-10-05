import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodeCl2Blueprints } from "../core/Cl2Embedded.js";
import { parseCl2 } from "../core/Cl2Parser.js";
import { registerCustomActivityNode } from "../core/ActivityNodeRegistry.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { createActivityRunner } from "../core/ActivityRunner.js";
import EventBus from "../core/EventBus.js";

const read = (file) => fs.readFileSync(file, "utf8");
const customNodes = decodeCl2Blueprints(JSON.parse(read("data/blueprint-nodes.framework.json")), "blueprint-nodes");
customNodes.forEach((node) => registerCustomActivityNode(node));

const manifest = JSON.parse(read("data/activity-manifest.json"));
const loader = { loadText: async (file) => read(path.join("data", file)) };
const store = new ActivityDefinitionStore(loader);
const definitions = await store.loadManifest(manifest.activityIds, "activities/");
assert.equal(definitions.length, manifest.activityIds.length, "every manifest Activity must load through CL2");
assert.ok(definitions.every((definition) => definition.format === "CL2"));
assert.ok(definitions.every((definition) => definition.sourcePath.endsWith(".CL2.txt")));
assert.ok(definitions.every((definition) => definition.compiled?.mode === "javascript"));
assert.ok(definitions.every((definition) => definition.compiled.blueprint === definition.blueprint));
assert.ok(definitions.every((definition) => !/hooks\.executeNode\s*\(/.test(definition.compiled.debugInfo.source)));
const generatedSourceBytes = definitions.reduce((total, definition) => total + Buffer.byteLength(definition.compiled.debugInfo.source), 0);

let embeddedCount = 0;
let multilineCount = 0;
function scan(value, sourcePath) {
  if (Array.isArray(value)) return value.forEach((item, index) => scan(item, `${sourcePath}[${index}]`));
  if (!value || typeof value !== "object") return;
  if (typeof value.cl2 === "string") {
    embeddedCount += 1;
    if (/\r|\n/.test(value.cl2)) multilineCount += 1;
    assert.ok(!value.cl2.includes("//"), `${sourcePath} must not use line comments`);
    assert.equal(parseCl2(value.cl2, { sourcePath, validate: false }).ok, true, sourcePath);
    return;
  }
  Object.entries(value).forEach(([key, child]) => scan(child, `${sourcePath}.${key}`));
}
for (const file of [
  ...fs.readdirSync("data/windows").map((name) => path.join("data/windows", name)),
  "data/databases/inventoryItems.json",
  "data/blueprint-nodes.framework.json",
]) scan(JSON.parse(read(file)), file);
assert.ok(embeddedCount > 0);
assert.equal(multilineCount, 0, "embedded CL2 must be one line in JSON");
assert.equal(parseCl2("/* header */start: flowStart();end: end();", { validate: false }).ok, true);
assert.equal(parseCl2("// forbidden\nstart: flowStart();", { validate: false }).ok, false);

const runtimeGraph = parseCl2(
  "start: flowStart() -> set; set: setVariable(\"probe\", 7) -> end; end: activityEnd();",
  { validate: false },
).graph;
const values = new Map();
const instance = { instanceId: "cl2-probe", status: "unresolved", executedNodeIds: [], localVariables: {} };
const runner = createActivityRunner({
  definition: { blueprint: runtimeGraph },
  instance,
  variableStore: { get: (key) => values.get(key), set: (key, value) => values.set(key, value), delta: () => {} },
});
runner.start();
assert.equal(values.get("probe"), 7);
assert.equal(instance.status, "resolved");
assert.equal(instance.resolutionReason, "completed");

const waitingGraph = parseCl2(
  "start: flowStart() -> set; set: setVariable(\"hits\", 1) -> wait; wait: blockUntil(\"ready\", true) -> end; end: activityEnd();",
  { validate: false },
).graph;
const waitingValues = new Map();
const waitBus = new EventBus();
const waitingInstance = { instanceId: "compiled-wait", status: "unresolved", executedNodeIds: [], localVariables: {} };
const waitingRunner = createActivityRunner({
  definition: { blueprint: waitingGraph },
  instance: waitingInstance,
  variableStore: {
    get: (key) => waitingValues.get(key),
    set: (key, value) => { waitingValues.set(key, value); waitBus.emit("variable:changed", { key, value }); },
    delta: () => {},
  },
  eventBus: waitBus,
});
waitingRunner.start();
assert.equal(waitingInstance.waitingNodeId, "wait", "compiled flow must suspend at the same CL2 node");
assert.equal(waitingValues.get("hits"), 1);
const waitDebugState = waitingRunner.getDebugState();
assert.equal(waitDebugState.currentNodeId, "wait");
assert.deepEqual(waitDebugState.compiled.nodeIds, ["start", "set", "wait", "end"]);
assert.ok(waitDebugState.compiled.sourceMap.wait.sourceLine > 0);
assert.ok(waitDebugState.compiled.source.includes("case 2:"));
assert.doesNotMatch(waitDebugState.compiled.source, /hooks\.executeNode/);
assert.match(waitDebugState.compiled.source, /variableStore\.set\(key, \(1\)\)/);
waitingValues.set("ready", true);
waitBus.emit("variable:changed", { key: "ready", value: true });
assert.equal(waitingInstance.status, "resolved", "compiled flow must resume after its wait condition changes");
assert.equal(waitingValues.get("hits"), 1, "resuming must not repeat an already completed side effect");

const restoreGraph = parseCl2(
  "start: flowStart() -> set; set: setVariable(\"restored\", 9) -> end; end: activityEnd();",
  { validate: false },
).graph;
const restoredValues = new Map([["restored", 3]]);
const restoredInstance = {
  instanceId: "compiled-restore",
  status: "unresolved",
  currentNodeId: "set",
  executedNodeIds: ["set"],
  localVariables: {},
};
createActivityRunner({
  definition: { blueprint: restoreGraph },
  instance: restoredInstance,
  variableStore: { get: (key) => restoredValues.get(key), set: (key, value) => restoredValues.set(key, value), delta: () => {} },
  eventBus: new EventBus(),
}).start();
assert.equal(restoredValues.get("restored"), 3, "restoring at an executed one-shot node must preserve its prior side-effect result");
assert.equal(restoredInstance.status, "resolved");
console.log(`cl2-runtime-probe: ${definitions.length} activities, ${embeddedCount} embedded blueprints, ${generatedSourceBytes} generated JS bytes, ok`);
