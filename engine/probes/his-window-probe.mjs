// Phase 8 HIS window probe (rebuilt for legacy 1:1 parity): proves
// `data/windows/his.json`'s `onCreate` lifecycle blueprint + every
// widget's inline event blueprint runs end-to-end against a real DataStore
// seeded from `data/structures.framework.json`/`data/databases.framework.json`/
// `data/seed-records.json` - patient roster + diagnosis/medicine category
// load, patient selection (which resets every diagnosis/prescription
// field and looks up existing cases for that patient), diagnosis
// category -> diagnosis option cascading, medicine category -> medicine
// option cascading across all 5 static prescription rows, submit (creates
// a `medicalCases` record, applies bonus/commission to money via public
// variable id 2, and produces the legacy-style feedback message), and the
// "开始问诊" button resolving the selected patient's `dialogueActivityId`
// dynamically through the value-node graph. Only exercises the generic
// node set + widget-tree wiring - no domain-specific engine code touched.
import "./register-framework-nodes.mjs";
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
import { RuntimeCollectionRegistry } from "../core/RuntimeCollectionRegistry.js";
import { EventActivityRouter } from "../core/EventActivityRouter.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { OnboardingManager } from "../core/OnboardingManager.js";
import { decodeCl2Blueprints } from "../core/Cl2Embedded.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../../data");
const readJSON = (relPath) => decodeCl2Blueprints(JSON.parse(fs.readFileSync(path.join(dataDir, relPath), "utf8")), relPath);

const dataStructureManager = new DataStructureManager();
dataStructureManager.loadDefinitions(readJSON("structures.framework.json"));
const dataStore = new DataStore(dataStructureManager);
dataStore.loadDefinitions(readJSON("databases.framework.json"));
const databaseDefinitions = readJSON("databases.framework.json");
dataStore.loadRecordSet(Object.fromEntries(databaseDefinitions.map(({ databaseId, recordFile }) => {
  const value = readJSON(recordFile);
  return [databaseId, value[databaseId] || []];
})));

const refResolver = new RuntimeRefResolver();
const eventBus = new EventBus();
const publicVariableManager = new PublicVariableManager(refResolver, eventBus);
publicVariableManager.loadDefinitions(readJSON("public-variables.framework.json"));
const onboardingManager = new OnboardingManager({ eventBus });
const variableStore = new VariableStore(eventBus);
const runtimeGateway = new RuntimeCollectionRegistry({ eventBus });
runtimeGateway.loadDefinitions(readJSON("framework-runtime.framework.json").collections);
const eventRouter = new EventActivityRouter({
  eventBus,
  variableStore,
  runtimeGateway,
  routes: readJSON("game-manifest.json").eventRoutes,
}).start();

const his = readJSON("windows/his.json");

const activityQueueRegistry = new ActivityQueueRegistry();
const queue = activityQueueRegistry.register("test", { nonBlocking: true });
const activityExecutionService = new ActivityExecutionService(eventBus);

let lastActivityGatewayCall = null;
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
    activityGateway: (activityId, queueId) => { lastActivityGatewayCall = { activityId, queueId }; },
    eventGateway: (eventName, payload) => eventBus.emit(eventName, payload),
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

function fireChange(widgetId, value) {
  variableStore.set("event:value", value);
  runBlueprint(findWidget(his.root, widgetId).events.onChange, `${widgetId}:${value}`);
}

// --- every inline blueprint on the window is structurally valid ----------
{
  const blueprints = [["window.onCreate", his.events.onCreate]];
  (function collect(node, prefix) {
    if (!node) return;
    for (const [name, bp] of Object.entries(node.events || {})) if (bp) blueprints.push([`${prefix}.${name}`, bp]);
    for (const child of node.children || []) collect(child, `${prefix}>${child.widgetId}`);
  })(his.root, "root");
  for (const [label, bp] of blueprints) {
    const { ok, errors } = validateBlueprint(bp);
    assert.equal(ok, true, `${label}: ${errors?.join("；")}`);
  }
  // onCreate + patient list + start dialogue + diagnosis category/select +
  // one dynamic medicine row + row add/remove + submit = 1 + 1 + 1 + 2 + 2 + 2 + 1.
  assert.equal(blueprints.length, 10);
  const prescriptionRows = his.root.children.flatMap((panel) => panel.children || [])
    .flatMap((panel) => panel.widgetId === "his-prescription-panel" ? panel.children || [] : [])
    .find((node) => node.widgetId === "his-prescription-rows");
  assert.equal(prescriptionRows.children.length, 1);
  assert.equal(prescriptionRows.children[0].events.onAdd.nodes.add.type, "addWindowComponent");
  assert.equal(prescriptionRows.children[0].events.onAdd.nodes.add.inputs.maxCount, 5);
  assert.equal(prescriptionRows.children[0].events.onRemove.nodes.remove.type, "removeWindowComponent");
  assert.deepEqual(prescriptionRows.children[0].events.onRemove.nodes.remove.inputs.componentId, { variable: "event:componentId" });
}

// --- onCreate loads the roster + category reference data -----------------
runBlueprint(his.events.onCreate, "onCreate");
assert.equal(variableStore.get("his:patients").length, 57);
assert.ok(variableStore.get("his:diagnosisCategories").length > 0);
assert.ok(variableStore.get("his:medicineCategories").length > 0);
assert.equal(variableStore.get("his:selectedPatient"), null);
assert.deepEqual(variableStore.get("his:existingCases"), []);
for (let n = 1; n <= 5; n += 1) {
  assert.equal(variableStore.get(`his:medChoice${n}`), "");
  assert.deepEqual(variableStore.get(`his:medOptions${n}`), []);
}
assert.ok(onboardingManager.hasMilestone("his_opened"));

// --- selecting a patient resets every diagnosis/prescription field and ----
// looks up any existing (already-submitted) medical case for them.
const patients = variableStore.get("his:patients");
const firstPatient = patients.find((p) => p.id === "patient_lin_ruoqing_01");
variableStore.set("event:value", firstPatient.id);
runBlueprint(findWidget(his.root, "his-patient-list").events.onItemClick, "onItemClick");
assert.equal(variableStore.get("his:selectedPatient").id, firstPatient.id);
assert.equal(variableStore.get("his:diagnosisCategoryChoice"), "");
assert.equal(variableStore.get("his:diagnosisChoice"), "");
assert.equal(variableStore.get("his:selectedDiagnosisRecord"), null);
assert.deepEqual(variableStore.get("his:existingCases"), []);
assert.ok(onboardingManager.hasMilestone("first_patient_selected"));

// --- "开始问诊" resolves the selected patient's dialogueActivityId dynamically
runBlueprint(findWidget(his.root, "his-start-dialogue").events.onClick, "startDialogue");
assert.equal(lastActivityGatewayCall.activityId, firstPatient.dialogueActivityId);
assert.ok(lastActivityGatewayCall.activityId, "dialogueActivityId must be non-empty");

// --- diagnosis category -> diagnosis option cascading ---------------------
const correctDiagnosisId = firstPatient.correctDiagnosisId;
const correctDiagnosis = dataStore.getRecord("diagnoses", correctDiagnosisId);
fireChange("his-diagnosis-category-select", correctDiagnosis.categoryId);
assert.equal(variableStore.get("his:diagnosisCategoryChoice"), correctDiagnosis.categoryId);
const diagnosisOptions = variableStore.get("his:diagnosisOptions");
assert.ok(diagnosisOptions.length > 0);
assert.ok(diagnosisOptions.every((d) => d.categoryId === correctDiagnosis.categoryId));
assert.equal(variableStore.get("his:diagnosisChoice"), "");
assert.equal(variableStore.get("his:selectedDiagnosisRecord"), null);

fireChange("his-diagnosis-select", correctDiagnosisId);
assert.equal(variableStore.get("his:diagnosisChoice"), correctDiagnosisId);
assert.equal(variableStore.get("his:selectedDiagnosisRecord").id, correctDiagnosisId);

// --- medicine category -> medicine option cascading (dynamic row 1) --------
const medicine1 = dataStore.getRecord("medicines", "med_paracetamol");
fireChange("his-medicine-category-1", medicine1.categoryId);
assert.equal(variableStore.get("his:medCategoryChoice1"), medicine1.categoryId);
assert.ok(variableStore.get("his:medOptions1").every((m) => m.categoryId === medicine1.categoryId));
assert.equal(variableStore.get("his:medChoice1"), "");
fireChange("his-medicine-select-1", medicine1.id);
assert.equal(variableStore.get("his:medChoice1"), medicine1.id);

const medicine2 = dataStore.getRecord("medicines", "med_001");
// The second row is now created by the addWindowComponent blueprint. This
// headless probe supplies its selection directly; DOM creation is covered by
// the runtime component-node probe.
variableStore.set("his:medCategoryChoice2", medicine2.categoryId);
variableStore.set("his:medChoice2", medicine2.id);
assert.equal(variableStore.get("his:medChoice2"), medicine2.id);

// --- submit creates a medicalCases record, applies bonus+commission to ---
// money (public variable id 2), and produces the legacy-style feedback
// message; rows 3-5 are left empty and must not contribute commission.
const moneyBefore = publicVariableManager.get(2);
runBlueprint(findWidget(his.root, "his-submit").events.onClick, "submit");
const lastCase = variableStore.get("his:lastCase");
assert.equal(lastCase.patientId, firstPatient.id);
assert.equal(lastCase.diagnosisId, correctDiagnosisId);
assert.deepEqual(lastCase.prescribedMedicineIds, [medicine1.id, medicine2.id, "", "", ""]);
assert.equal(lastCase.correct, true, "choosing the patient's own correctDiagnosisId must judge as correct");
assert.equal(lastCase.bonus, 200);
assert.equal(lastCase.commission, medicine1.commission + medicine2.commission);
assert.equal(dataStore.getRecord("medicalCases", lastCase.id).id, lastCase.id);
assert.equal(publicVariableManager.get(2), moneyBefore + 200 + medicine1.commission + medicine2.commission);
assert.ok(variableStore.get("his:resultMessage").length > 0);
assert.ok(variableStore.get("his:resultMessage").includes(`${medicine1.commission + medicine2.commission}`));
assert.deepEqual(runtimeGateway.get("medicalState")[0], {
  id: "lastSubmission",
  submitted: true,
  patientId: firstPatient.id,
  case: lastCase,
  resultMessage: variableStore.get("his:resultMessage"),
});
assert.deepEqual(runtimeGateway.get("eventHistory").at(-1), {
  id: "0",
  kind: "his-submit",
  patientId: firstPatient.id,
  caseId: lastCase.id,
  correct: true,
  bonus: 200,
  commission: medicine1.commission + medicine2.commission,
});
assert.ok(onboardingManager.hasMilestone("first_diagnosis_submitted"));

// --- submitting again for the same patient surfaces the existing case ----
variableStore.set("event:value", firstPatient.id);
runBlueprint(findWidget(his.root, "his-patient-list").events.onItemClick, "onItemClickAgain");
assert.equal(variableStore.get("his:existingCases").length, 1);
assert.equal(variableStore.get("his:existingCases")[0].id, lastCase.id);

// --- an incorrect diagnosis is judged as such and earns no bonus ----------
{
  const secondPatient = patients[1];
  variableStore.set("event:value", secondPatient.id);
  runBlueprint(findWidget(his.root, "his-patient-list").events.onItemClick, "onItemClick2");
  // Any diagnosis id other than the patient's own correctDiagnosisId is
  // "wrong"; the previously-loaded correctDiagnosis (a different patient's
  // correct answer) always qualifies since patients never share one.
  assert.notEqual(correctDiagnosisId, secondPatient.correctDiagnosisId);
  fireChange("his-diagnosis-category-select", correctDiagnosis.categoryId);
  fireChange("his-diagnosis-select", correctDiagnosisId);
  runBlueprint(findWidget(his.root, "his-submit").events.onClick, "submit2");
  assert.equal(variableStore.get("his:lastCase").correct, false);
  assert.equal(variableStore.get("his:lastCase").bonus, 0);
}

// --- medical event state survives a save-shaped snapshot/restore ---------
const medicalSnapshot = runtimeGateway.snapshot();
runtimeGateway.restore({});
assert.deepEqual(runtimeGateway.get("medicalState"), []);
runtimeGateway.restore(medicalSnapshot);
assert.deepEqual(runtimeGateway.get("medicalState")[0].case.id, variableStore.get("his:lastCase").id);
assert.equal(runtimeGateway.get("medicalState")[0].case.correct, false);
eventRouter.stop();

console.log("his-window-probe: ok");
