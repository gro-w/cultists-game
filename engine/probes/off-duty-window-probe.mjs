// Phase 8 off-duty/dorm probe: proves the data-driven legacy dorm layout
// in `data/windows/off-duty.json` renders through the same widget tree
// consumed by the custom window editor and runtime. It covers the three
// roommate records, public-variable bindings and every declared event
// blueprint (including the migrated toolbar actions).
import assert from "node:assert/strict";
import "./register-framework-nodes.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";
import { PublicVariableManager } from "../core/PublicVariableManager.js";
import { RuntimeRefResolver } from "../core/RuntimeRefResolver.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { OnboardingManager } from "../core/OnboardingManager.js";
import { evaluateValueOutput } from "../core/ActivityRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../../data");
const readJSON = (relPath) => JSON.parse(fs.readFileSync(path.join(dataDir, relPath), "utf8"));

const dataStructureManager = new DataStructureManager();
dataStructureManager.loadDefinitions(readJSON("structures.framework.json"));
const dataStore = new DataStore(dataStructureManager);
dataStore.loadDefinitions(readJSON("databases.framework.json"));
dataStore.loadRecordSet(Object.fromEntries(readJSON("databases.framework.json").map(({ databaseId, recordFile }) => {
  const value = readJSON(recordFile);
  return [databaseId, value[databaseId] || []];
})));

const refResolver = new RuntimeRefResolver();
const eventBus = new EventBus();
const publicVariableManager = new PublicVariableManager(refResolver, eventBus);
publicVariableManager.loadDefinitions(readJSON("public-variables.framework.json"));

const variableStore = new VariableStore(eventBus);
const activityQueueRegistry = new ActivityQueueRegistry();
const queue = activityQueueRegistry.register("test", { nonBlocking: true });
const activityExecutionService = new ActivityExecutionService(eventBus);
const onboardingManager = new OnboardingManager({ eventBus });

let consumedMinutes = 0;
function runBlueprint(blueprint, label) {
  const { ok, errors, blueprint: normalized } = validateBlueprint(blueprint);
  assert.equal(ok, true, `${label}: ${errors?.join("；")}`);
  const instance = queue.append({ activityId: label });
  return activityExecutionService.run({
    queue,
    definition: { id: label, blueprint: normalized },
    instance,
    variableStore,
    timeGateway: (minutes) => { consumedMinutes += minutes; },
    apiGateway: { call: (apiId, payload) => { if (apiId === "engine.consumeTime") return consumedMinutes += payload.minutes; throw new Error(`Unexpected API ${apiId}`); } },
    windowGateway: () => {},
    activityGateway: () => {},
    eventGateway: () => {},
    dbGateway: dataStore,
    pvGateway: publicVariableManager,
    onboardingGateway: onboardingManager,
  });
}

function findWidget(root, widgetId) {
  if (!root) return null;
  if (root.widgetId === widgetId) return root;
  for (const child of root.children || []) {
    const found = findWidget(child, widgetId);
    if (found) return found;
  }
  return null;
}

const offDuty = readJSON("windows/off-duty.json");
const ROOMMATES = [
  { npcId: "ajie", name: "阿杰", favId: 40, sanId: 60 },
  { npcId: "awei", name: "阿伟", favId: 41, sanId: 61 },
  { npcId: "binbin", name: "彬彬", favId: 42, sanId: 62 },
];

// --- every inline blueprint is structurally valid -------------------------
{
  const blueprints = [["window.onCreate", offDuty.events.onCreate]];
  (function collect(node, prefix) {
    if (!node) return;
    for (const [name, bp] of Object.entries(node.events || {})) if (bp) blueprints.push([`${prefix}.${name}`, bp]);
    for (const child of node.children || []) collect(child, `${prefix}>${child.widgetId}`);
  })(offDuty.root, "root");
  assert.ok(blueprints.length >= 1 + ROOMMATES.length, "expected onCreate + one interact blueprint per roommate");
  for (const [label, bp] of blueprints) {
    const { ok, errors } = validateBlueprint(bp);
    assert.equal(ok, true, `${label}: ${errors?.join("；")}`);
  }
}

// --- onCreate loads each roommate's npc record and resets the message ----
runBlueprint(offDuty.events.onCreate, "onCreate");
for (const { npcId } of ROOMMATES) {
  const record = variableStore.get(`dorm:npc${ROOMMATES.findIndex((r) => r.npcId === npcId)}`);
  assert.equal(record.id, npcId);
}
assert.equal(variableStore.get("dorm:message"), "");
assert.equal(consumedMinutes, 0, "opening the off-duty window must not consume time");

// Sleeping is an explicit window action and remains the only 480-minute
// transition; opening the window must not perform it implicitly.
const bedButton = findWidget(offDuty.root, "off-duty-bed");
const sleepConsume = Object.values(bedButton.events.onClick.nodes).find((node) => node.type === "framework:consumeTime");
assert.equal(sleepConsume?.inputs?.minutes, 480, "sleeping must consume the full night");

// --- valueGraph derives correct display text for every roommate ----------
for (const { npcId, name, favId, sanId } of ROOMMATES) {
  const evalNode = (nodeId) => evaluateValueOutput(offDuty.valueGraph, nodeId, "value", variableStore, new Set(), publicVariableManager);
  assert.equal(evalNode(`${npcId}Name`), name);
  assert.equal(evalNode(`${npcId}FavText`), `好感度：${publicVariableManager.get(favId)}`);
  assert.equal(evalNode(`${npcId}SanText`), `SAN：${publicVariableManager.get(sanId)}`);
}

// --- roommate and story launchers resolve to migrated Activity ids --------
const activityList = readJSON("activity-lists/default.json");
const migratedIds = [];
for (const { npcId } of ROOMMATES) {
  const button = findWidget(offDuty.root, `off-duty-${npcId}-interact`);
  assert.ok(button, `missing interact button for ${npcId}`);
  const runNode = Object.values(button.events.onClick.nodes).find((node) => node.type === "runActivity");
  assert.ok(runNode, `missing Activity launcher for ${npcId}`);
  assert.ok(activityList.activityIds.includes(runNode.inputs.activityId), `${runNode.inputs.activityId} must be registered`);
  migratedIds.push(runNode.inputs.activityId);
}
const storyList = findWidget(offDuty.root, "off-duty-story-list");
assert.ok(storyList, "missing data-authored dorm story list");
assert.equal(storyList.children.length, 23, "all legacy dorm story entries must be exposed");
for (const button of storyList.children) {
  const runNode = Object.values(button.events.onClick.nodes).find((node) => node.type === "runActivity");
  assert.ok(runNode, `${button.widgetId} must launch an Activity`);
  assert.ok(activityList.activityIds.includes(runNode.inputs.activityId), `${runNode.inputs.activityId} must be registered`);
  migratedIds.push(runNode.inputs.activityId);
}
assert.equal(new Set(migratedIds).size, 23, "story launcher ids should be unique");

console.log("off-duty-window-probe: migrated dorm story ok");
