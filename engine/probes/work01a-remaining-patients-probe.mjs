import "./register-framework-nodes.mjs";

// Phase 8 slice: the remaining 6 of `work01a.json`'s 7 patients (only
// patient 1 was wired in the earlier "first playable slice"), batch
// represented by the canonical CL2 Activity definitions
// tool (0 blocked node types, same as patient 1) into
// `work01a-patient{2..7}.json` + `-start.json` wrapper pairs, added to
// `data/activity-lists/default.json`, and seeded into the `patients`
// database (`data/seed-records.json`) with the legacy `age`/
// `correctDiagnosisId`/`diagnosisOptionIds` fields the new HIS window's
// diagnosis judging reads. This probe proves every one of the 7 patient
// blueprints (+ its start wrapper) validates cleanly and that every
// patient's `dialogueActivityId` resolves to a real, registered Activity.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const activitiesDir = path.join(__dirname, "../../data/activities");
const databaseDefinitions = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/databases.framework.json"), "utf8"));
const seedRecords = Object.fromEntries(databaseDefinitions.map(({ databaseId, recordFile }) => {
  const value = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data", recordFile), "utf8"));
  return [databaseId, value[databaseId] || []];
}));
const defaultList = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/activity-lists/default.json"), "utf8"));

function loadDefinition(fileName) {
  const raw = JSON.parse(fs.readFileSync(path.join(activitiesDir, fileName), "utf8"));
  const { ok, errors, blueprint } = validateBlueprint(raw.blueprint);
  assert.equal(ok, true, `${fileName}: ${errors.join(", ")}`);
  return { ...raw, blueprint };
}

// --- all 7 patient + start-wrapper blueprints validate cleanly --------------
const store = new ActivityDefinitionStore();
for (let slot = 1; slot <= 7; slot++) {
  const patient = loadDefinition(`work01a-patient${slot}.json`);
  const start = loadDefinition(`work01a-patient${slot}-start.json`);
  store.register(patient);
  store.register(start);
  assert.ok(defaultList.activityIds.includes(patient.id), `default list should include ${patient.id}`);
  assert.ok(defaultList.activityIds.includes(start.id), `default list should include ${start.id}`);
}

// --- the migrated database contains all 57 patients; this probe covers Day 1's 7 ---
assert.equal(seedRecords.patients.length, 57, "all migrated patients seeded");
const day1Patients = seedRecords.patients.filter(({ dialogueActivityId }) => /^work01a-patient[1-7]-start$/.test(dialogueActivityId || ""));
assert.equal(day1Patients.length, 7, "all 7 work01a patients seeded");
for (const patient of day1Patients) {
  assert.ok(patient.correctDiagnosisId, `${patient.id} needs a correctDiagnosisId`);
  assert.ok(patient.diagnosisOptionIds.length >= 2, `${patient.id} needs >=2 diagnosis options`);
  assert.ok(patient.diagnosisOptionIds.includes(patient.correctDiagnosisId), `${patient.id}'s correct diagnosis must be among its options`);
  assert.ok(store.get(patient.dialogueActivityId), `${patient.id}'s dialogueActivityId "${patient.dialogueActivityId}" must resolve to a registered Activity`);
}

// --- every patient's diagnosis options resolve against the seeded diagnoses database ---
const diagnosisIds = new Set((seedRecords.diagnoses || []).map((d) => d.id));
for (const patient of day1Patients) {
  for (const diagnosisId of patient.diagnosisOptionIds) {
    assert.ok(diagnosisIds.has(diagnosisId), `${patient.id}'s option "${diagnosisId}" must exist in the diagnoses database`);
  }
}

console.log("work01a-remaining-patients-probe: all scenarios passed");
