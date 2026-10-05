import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { DataStore } from "../core/DataStore.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { RuntimeCollectionRegistry } from "../core/RuntimeCollectionRegistry.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data");
const readJSON = (relativePath) => JSON.parse(fs.readFileSync(path.join(dataDir, relativePath), "utf8"));
const structures = new DataStructureManager();
structures.loadDefinitions(readJSON("structures.framework.json"));
const patients = readJSON("databases/patients.json").patients;
assert.equal(patients.length, 57, "probe uses the canonical 57-patient database");

const dataStore = new DataStore(structures);
dataStore.registerDatabase({ databaseId: "patients", recordType: "patient", primaryKey: "id" });
dataStore.loadRecords("patients", patients);
// A later duplicate must not replace the first matching patient record.
dataStore.createRecord("patients", { ...patients[0], id: "patient_duplicate_late", name: "later duplicate" });

const activityQueueRegistry = new ActivityQueueRegistry();
const workQueue = activityQueueRegistry.register("work");
for (let index = 1; index <= 7; index += 1) workQueue.append({ activityId: `work01a-patient${index}` });
const resolvedEntry = workQueue.append({ activityId: "work01a-patient1" });
workQueue.update(resolvedEntry.instanceId, { status: "resolved" });
workQueue.append({ activityId: "not-in-patient-database" });

let patientQueryCount = 0;
const originalFindRecords = dataStore.findRecords.bind(dataStore);
dataStore.findRecords = (databaseId, query) => {
  if (databaseId === "patients") patientQueryCount += 1;
  return originalFindRecords(databaseId, query);
};
const runtimeCollections = new RuntimeCollectionRegistry({ dataStore, activityQueueRegistry });
runtimeCollections.loadDefinitions(readJSON("framework-runtime.framework.json").collections);

const projection = runtimeCollections.get("hisPatients");
assert.equal(patientQueryCount, 1, "one collection projection performs one patient database query");
assert.deepEqual(projection.map((record) => record.id), patients.slice(0, 7).map((record) => record.id), "queue order and patient join are preserved");
assert.equal(projection[0].name, patients[0].name, "the first database match wins when join keys are duplicated");
assert.equal(projection[0].queueInstanceId, workQueue.entries[0].instanceId);
assert.equal(projection[0].queueStatus, "unresolved");
assert.equal(projection.some((record) => record.activityId === "not-in-patient-database"), false, "unmatched queue entries remain omitted");

const missingDataStoreRegistry = new RuntimeCollectionRegistry({ activityQueueRegistry });
missingDataStoreRegistry.register("missingDataStoreJoin", {
  activityQueueId: "work",
  databaseId: "patients",
  joinField: "dialogueActivityId",
  joinActivitySuffix: "-start",
  unresolvedOnly: true,
});
assert.deepEqual(missingDataStoreRegistry.get("missingDataStoreJoin"), [], "a missing optional datastore keeps queue joins empty");

// The lookup is local to a read: changes made between renders must be visible.
dataStore.updateRecord("patients", patients[0].id, { name: "updated between projections" });
patientQueryCount = 0;
const refreshedProjection = runtimeCollections.get("hisPatients");
assert.equal(patientQueryCount, 1, "each later projection makes one fresh database query");
assert.equal(refreshedProjection[0].name, "updated between projections", "a projection never reuses stale joined records");

console.log("runtime-collection-join-performance-probe: canonical patient join, filtering, ordering, first-match and one fresh query per projection passed");
