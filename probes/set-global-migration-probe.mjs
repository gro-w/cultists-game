import "../engine/probes/register-framework-nodes.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createActivityRunner } from "../engine/core/ActivityRunner.js";
import EventBus from "../engine/core/EventBus.js";
import { parseCl2 } from "../engine/core/Cl2Parser.js";
import { PublicVariableManager } from "../engine/core/PublicVariableManager.js";

const activitiesDir = path.join("data", "activities");
let migratedCount = 0;

for (const fileName of fs.readdirSync(activitiesDir).filter((name) => name.endsWith(".json")).sort()) {
  const activityId = fileName.slice(0, -".json".length);
  const legacyPath = path.join(activitiesDir, fileName);
  const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  const legacyNodes = Object.values(legacy.blueprint?.nodes || {});
  const effectNodes = legacyNodes.filter((node) => node.type === "setGlobal" && Object.hasOwn(node.inputs || {}, "delta"));
  if (!effectNodes.length) continue;

  const canonicalPath = path.join(activitiesDir, `${activityId}.CL2.txt`);
  const canonicalSource = fs.readFileSync(canonicalPath, "utf8");
  const parsed = parseCl2(canonicalSource, { sourcePath: canonicalPath, validate: false });
  assert.equal(parsed.ok, true, `${activityId}: ${parsed.diagnostics.map((item) => item.message).join("；")}`);

  for (const legacyNode of effectNodes) {
    migratedCount += 1;
    const current = parsed.graph.nodes[legacyNode.id];
    assert.ok(current, `${activityId}/${legacyNode.id}: canonical node is missing`);
    assert.equal(current.type, "applyPublicVariableEffect", `${activityId}/${legacyNode.id}: migrate legacy setGlobal delta to the explicit public effect node`);
    assert.deepEqual(
      { id: current.inputs.id, value: current.inputs.value, delta: current.inputs.delta },
      { id: legacyNode.inputs.variableId, value: null, delta: legacyNode.inputs.delta },
      `${activityId}/${legacyNode.id}: public-variable ID/delta must match the legacy graph`,
    );
  }
}

assert.equal(migratedCount, 23, "all 23 legacy setGlobal delta nodes must be migrated");

const eventLegacy = JSON.parse(fs.readFileSync(path.join(activitiesDir, "event__cn05.json"), "utf8"));
const legacyTalismanCost = eventLegacy.blueprint.nodes.use_talisman_cost;
assert.equal(legacyTalismanCost.type, "statOperation");
assert.deepEqual(legacyTalismanCost.inputs, { statId: "sanity", delta: -5 });
const eventManifest = JSON.parse(fs.readFileSync("data/activity-manifest.json", "utf8"));
assert.ok(eventManifest.activityIds.some((entry) => entry.id === "event__追逐事件" && entry.file === "event__追逐事件.CL2.txt"));
const canonicalEventPath = path.join(activitiesDir, "event__追逐事件.CL2.txt");
const canonicalEventSource = fs.readFileSync(canonicalEventPath, "utf8");
const canonicalEvent = parseCl2(canonicalEventSource, { sourcePath: canonicalEventPath, validate: false });
assert.equal(canonicalEvent.ok, true, canonicalEvent.diagnostics.map((item) => item.message).join("；"));
assert.deepEqual(
  {
    type: canonicalEvent.graph.nodes.use_talisman_cost.type,
    id: canonicalEvent.graph.nodes.use_talisman_cost.inputs.id,
    value: canonicalEvent.graph.nodes.use_talisman_cost.inputs.value,
    delta: canonicalEvent.graph.nodes.use_talisman_cost.inputs.delta,
  },
  { type: "applyPublicVariableEffect", id: 1, value: null, delta: -5 },
  "legacy sanity delta must remain mapped to the canonical public SAN variable ID 1",
);
assert.ok(/use_talisman_cost:\s*applyPublicVariableEffect\(1,\s*null,\s*-5\)/.test(canonicalEventSource));
const sanityDefinition = JSON.parse(fs.readFileSync("data/public-variables.framework.json", "utf8"))
  .find((definition) => definition.id === 1);
assert.equal(sanityDefinition.name, "主角SAN");

const eventBus = new EventBus();
const publicVariables = new PublicVariableManager(null, eventBus);
publicVariables.loadDefinitions(JSON.parse(fs.readFileSync("data/public-variables.framework.json", "utf8")));
const runtimeParsed = parseCl2(
  "start: flowStart() { default add; }; add: applyPublicVariableEffect(40, null, 5) { default subtract; }; subtract: applyPublicVariableEffect(40, null, -3) { default finish; }; finish: activityEnd();",
  { validate: false },
);
assert.equal(runtimeParsed.ok, true, runtimeParsed.diagnostics.map((item) => item.message).join("；"));
const runtimeInstance = { instanceId: "set-global-migration-probe", status: "unresolved", executedNodeIds: [], localVariables: {} };
createActivityRunner({
  definition: { blueprint: runtimeParsed.graph },
  instance: runtimeInstance,
  variableStore: { get: () => undefined, set: () => {}, delta: () => {} },
  pvGateway: publicVariables,
  eventBus,
}).start();
assert.equal(publicVariables.get(40), 62, "migrated public effects must increment through the managed variable gateway");
assert.equal(runtimeInstance.status, "resolved");

console.log(`set-global-migration-probe: ${migratedCount} legacy setGlobal deltas plus talisman SAN mapping match; managed +5/-3 effects execute`);
