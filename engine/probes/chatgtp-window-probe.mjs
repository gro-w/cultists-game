// Phase 8 ChatGTP window probe: proves `data/windows/chatgtp.json`
// actually runs end-to-end against the real seeded 48,195-entry QA table
// (`data/databases/chatgtpQaEntries.json`) plus `chatgtpSettings`/`keywords` -
// keyword-combo lookup (order-independent, matching
// the canonical sorted keyword-id `entryKey()` convention), SAN gating
// via public variable id 5 ("ChatGTP SAN"), per-query SAN cost, offline
// fallback when SAN is depleted, and a not-found combo's graceful
// fallback message. Only exercises the generic node set + widget-tree
// wiring - no domain-specific engine code.
import assert from "node:assert/strict";
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
import { decodeCl2Blueprints } from "../core/Cl2Embedded.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../../data");
const readJSON = (relPath) => JSON.parse(fs.readFileSync(path.join(dataDir, relPath), "utf8"));
const entryKey = (keywordIds) => [...keywordIds].map((id) => String(id).trim().toLowerCase()).sort().join("+");

const dataStructureManager = new DataStructureManager();
dataStructureManager.loadDefinitions(readJSON("structures.framework.json"));
const dataStore = new DataStore(dataStructureManager);
dataStore.loadDefinitions(readJSON("databases.framework.json"));
const databaseDefinitions = readJSON("databases.framework.json");
const chatgtpSeed = readJSON("databases/chatgtpQaEntries.json");
dataStore.loadRecordSet(Object.fromEntries(databaseDefinitions.map(({ databaseId, recordFile }) => {
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

function runBlueprint(blueprint, label) {
  const { ok, errors, blueprint: normalized } = validateBlueprint(blueprint);
  assert.equal(ok, true, `${label}: ${errors?.join("；")}`);
  const instance = queue.append({ activityId: label });
  return activityExecutionService.run({
    queue,
    definition: { id: label, blueprint: normalized },
    instance,
    variableStore,
    timeGateway: () => {},
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

const chatgtp = decodeCl2Blueprints(readJSON("windows/chatgtp.json"));
const CHATGTP_SAN_VARIABLE_ID = 5;

// --- every inline blueprint is structurally valid -------------------------
{
  const blueprints = [["window.onCreate", chatgtp.events.onCreate]];
  (function collect(node, prefix) {
    if (!node) return;
    for (const [name, bp] of Object.entries(node.events || {})) if (bp) blueprints.push([`${prefix}.${name}`, bp]);
    for (const child of node.children || []) collect(child, `${prefix}>${child.widgetId}`);
  })(chatgtp.root, "root");
  for (const [label, bp] of blueprints) {
    const { ok, errors } = validateBlueprint(bp);
    assert.equal(ok, true, `${label}: ${errors?.join("；")}`);
  }
  assert.equal(blueprints.length, 6, "expected onCreate + source/category/keyword1/keyword2/query blueprints");
  assert.ok(findWidget(chatgtp.root, "chatgtp-keyword2-select"), "expected second keyword selector");
  assert.ok(findWidget(chatgtp.root, "chatgtp-source-row"), "expected source row");
  assert.ok(findWidget(chatgtp.root, "chatgtp-category-row"), "expected category row");
  assert.ok(findWidget(chatgtp.root, "chatgtp-keyword-row"), "expected keyword row");
}

// --- onCreate loads keywords + settings, resets query state ---------------
runBlueprint(chatgtp.events.onCreate, "onCreate");
assert.equal(variableStore.get("chatgtp:keywords").length, 645);
assert.equal(variableStore.get("chatgtp:settings").id, "default");
assert.equal(variableStore.get("chatgtp:answer"), "");
const startingSan = 255;
publicVariableManager.set(CHATGTP_SAN_VARIABLE_ID, startingSan);

// --- a real keyword resolves through the third column --------------------
const comboEntry = chatgtpSeed.chatgtpQaEntries.find((e) => e.keywords.length === 1);
assert.ok(comboEntry, "fixture data must contain at least one single-keyword entry");
assert.equal(comboEntry.id, entryKey(comboEntry.keywords));

variableStore.set("event:value", comboEntry.keywords[0]);
runBlueprint(findWidget(chatgtp.root, "chatgtp-keyword1-select").events.onChange, "keywordChange");
runBlueprint(findWidget(chatgtp.root, "chatgtp-query").events.onClick, "query1");
assert.equal(variableStore.get("chatgtp:answer"), comboEntry.answer);
assert.deepEqual(variableStore.get("chatgtp:history"), [comboEntry.answer]);
assert.equal(publicVariableManager.get(CHATGTP_SAN_VARIABLE_ID), startingSan - variableStore.get("chatgtp:settings").sanCostPerQuery);

// --- an unmatched combo falls back gracefully, still costs SAN ------------
const sanBeforeMiss = publicVariableManager.get(CHATGTP_SAN_VARIABLE_ID);
variableStore.set("event:value", "__no_such_keyword_a__");
runBlueprint(findWidget(chatgtp.root, "chatgtp-keyword1-select").events.onChange, "keywordMiss");
runBlueprint(findWidget(chatgtp.root, "chatgtp-query").events.onClick, "queryMiss");
assert.notEqual(variableStore.get("chatgtp:answer"), comboEntry.answer);
assert.ok(variableStore.get("chatgtp:answer").length > 0);
assert.equal(variableStore.get("chatgtp:history").length, 2);
assert.equal(publicVariableManager.get(CHATGTP_SAN_VARIABLE_ID), sanBeforeMiss - variableStore.get("chatgtp:settings").sanCostPerQuery);

// --- SAN depleted -> offline answer, no further SAN cost ------------------
publicVariableManager.set(CHATGTP_SAN_VARIABLE_ID, 0);
runBlueprint(findWidget(chatgtp.root, "chatgtp-query").events.onClick, "queryOffline");
assert.equal(variableStore.get("chatgtp:answer"), variableStore.get("chatgtp:settings").offlineAnswer);
assert.equal(publicVariableManager.get(CHATGTP_SAN_VARIABLE_ID), 0);

console.log("chatgtp-window-probe: ok");
