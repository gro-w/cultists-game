import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = process.env.TMPDIR || os.tmpdir();
const tempDir = fs.mkdtempSync(path.join(scratch, "cultists-callsite-audit-"));
const outputPath = path.join(tempDir, "inventory.json");

try {
  const result = spawnSync(process.execPath, [
    path.join(root, "probes", "blueprint-callsite-audit.mjs"),
    "--output",
    outputPath,
    "--allow-diagnostics",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const inventory = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(inventory.sourceCount, 352);
  assert.equal(inventory.graphCount, 352,
    "call-site inventory must traverse parsed graphs even when structural diagnostics exist");
  assert.equal(inventory.parsedCount, 352,
    "all original canonical sources must parse; editor saves must not drop legacy flow targets");
  assert.equal(inventory.failedCount, 0,
    "a clean canonical corpus has no parse diagnostics");
  assert.deepEqual(inventory.diagnostics, []);
  assert.equal(inventory.typedPortCollisionCandidates.length, 34);
  assert.ok(inventory.typedPortCollisionCandidates.every((row) => typeof row.rawCall === "string"));
  assert.ok(inventory.typedPortCollisionCandidates.every((row) => row.rawCall.startsWith(`${row.nodeId}: ${row.type}(`)),
    "every typed-port raw call must begin at its exact node declaration");

  const mirroredEffects = inventory.typedPortCollisionCandidates.filter((row) => row.type === "applyPublicVariableEffect");
  assert.equal(mirroredEffects.length, 9);
  assert.ok(mirroredEffects.every((row) => row.legacyCorroboration?.type === "applyPublicVariableEffect"));
  assert.ok(mirroredEffects.every((row) => row.rawCall.startsWith(`${row.nodeId}: applyPublicVariableEffect(`)),
    "every extracted raw call must begin at its exact node declaration");
  assert.equal(mirroredEffects.filter((row) => Object.hasOwn(row.legacyCorroboration.inputs, "value")).length, 9);
  const booleanEffects = mirroredEffects.filter((row) => Object.hasOwn(row.legacyCorroboration.inputs, "value"));
  assert.ok(booleanEffects.every((row) =>
    row.inputs.id === row.legacyCorroboration.inputs.id
    && row.inputs.value === row.legacyCorroboration.inputs.value),
  "boolean canonical effects must preserve all legacy id/value pairs");
  const recordKeyCollisions = inventory.typedPortCollisionCandidates.filter((row) => row.type === "getRecord");
  assert.equal(recordKeyCollisions.length, 4);
  assert.ok(recordKeyCollisions.every((row) => typeof row.inputs.key === "string" && typeof row.inputs.resultScope === "string"),
    "getRecord must retain the literal database key and separate legacy result target");
  const updateKeyCollisions = inventory.typedPortCollisionCandidates.filter((row) => row.type === "updateRecord");
  assert.equal(updateKeyCollisions.length, 2);
  assert.ok(updateKeyCollisions.every((row) =>
    typeof row.inputs.key === "string" && row.inputs.patch && !Object.hasOwn(row.inputs, "resultScope")),
  "updateRecord must retain its literal database key and patch without inventing a result target");

  assert.equal(inventory.statOperationNodes.length, 3);
  assert.ok(inventory.statOperationNodes.every((row) => row.rawCall?.startsWith(`${row.nodeId}: statOperation(`)));
  assert.deepEqual(
    inventory.statOperationNodes.map((row) => row.inputs).sort((a, b) => a.statId.localeCompare(b.statId) || a.value - b.value),
    [{ statId: "physical", value: -3 }, { statId: "satiety", value: 6 }, { statId: "satiety", value: 90 }],
  );
  assert.deepEqual(inventory.statChangeEntries, [{
    source: "data/databases/inventoryItems.json",
    jsonPath: "$.inventoryItems[8].sanVariants.50-70.inspectEffect.statChanges.mental",
    recordId: "book_nahan",
    statId: "mental",
    value: -5,
  }]);

  const globalWrites = inventory.typedPortCollisionCandidates.filter((row) => row.type === "setGlobal");
  assert.equal(globalWrites.length, 16);
  assert.deepEqual(
    Object.fromEntries([...new Set(globalWrites.map((row) => row.inputs.variableId))].sort((a, b) => a - b)
      .map((id) => [id, globalWrites.filter((row) => row.inputs.variableId === id).length])),
    { 1: 16 },
  );
  assert.equal(globalWrites.filter((row) => row.inputs.value < 0).length, 5);
  assert.ok(globalWrites.every((row) => !Object.hasOwn(row.inputs, "delta") && Object.hasOwn(row.inputs, "value")),
    "remaining setGlobal calls still place numeric arguments in value rather than delta");
  assert.equal(globalWrites.filter((row) => row.legacyCorroboration?.inputs?.delta != null).length, 4);
  assert.equal(globalWrites.filter((row) => row.legacyCorroboration == null).length, 12);

  const booleanEffect = inventory.typedPortCollisionCandidates.find((row) =>
    row.type === "applyPublicVariableEffect" && row.source === "dorm_activity_day1" && row.nodeId === "study_set");
  assert.ok(booleanEffect, "the canonical boolean effect must be inventoried");
  assert.match(booleanEffect.rawCall, /applyPublicVariableEffect\(false,\s*113\)/);
  assert.deepEqual(booleanEffect.legacyCorroboration.inputs, { value: false, id: 113 });

  const embeddedEffect = inventory.typedPortCollisionCandidates.find((row) =>
    row.type === "setGlobal" && row.source.includes("inventoryItems[2]") && row.nodeId === "criticalFailure_effect");
  assert.ok(embeddedEffect, "the embedded inventory effect must be inventoried");
  assert.match(embeddedEffect.rawCall, /setGlobal\(1,\s*-3\)/);
  assert.equal(embeddedEffect.legacyCorroboration, null, "embedded source must not claim an Activity legacy mirror");

  const embeddedStat = inventory.typedPortCollisionCandidates.find((row) =>
    row.type === "statOperation" && row.nodeId === "use_stat_satiety" && row.source.includes("inventoryItems[4]"));
  assert.ok(embeddedStat, "the embedded stat call must be inventoried");
  assert.match(embeddedStat.rawCall, /statOperation\("satiety",\s*6\)/);

  const resultTarget = inventory.resultCandidates.find((row) =>
    row.type === "getRecord" && row.source === "data/windows/chatgtp.json:$.events.onCreate.cl2" && row.nodeId === "settings");
  assert.ok(resultTarget, "the window result target must be inventoried");
  assert.match(resultTarget.rawCall, /getRecord\("chatgtpSettings",\s*"default",\s*"chatgtp:settings"\)/);
  assert.ok(inventory.resultCandidates.every((row) => row.rawCall.startsWith(`${row.nodeId}: ${row.type}(`)),
    "every result-target raw call must begin at its exact node declaration");

  const offDutyNpc = inventory.embeddedGraphVariableNodes.find((row) =>
    row.source === "data/windows/off-duty.json" && row.nodeId === "ajieNpc");
  assert.ok(offDutyNpc, "window value-graph variable nodes must be inventoried");
  assert.deepEqual({ type: offDutyNpc.type, key: offDutyNpc.key }, { type: "getVariable", key: "dorm:npc0" });
  assert.equal(inventory.embeddedGraphVariableNodes.length, 11);
  assert.equal(new Set(inventory.embeddedGraphVariableNodes.map((row) => row.key)).size, 10);
  const offDutyRecord = inventory.resultCandidates.find((row) =>
    row.source === "data/windows/off-duty.json:$.events.onCreate.cl2" && row.nodeId === "get-ajie");
  assert.ok(offDutyRecord, "the off-duty record result must be inventoried");
  assert.ok(offDutyRecord.targetReaders.embeddedGraphVariableNodes.some((row) => row.nodeId === "ajieNpc"),
    "the result target must link to its value-graph reader");

  assert.equal(inventory.exampleGraphVariableNodes.length, 3);
  assert.deepEqual(
    inventory.exampleGraphVariableNodes.map((row) => row.key).sort(),
    ["demo:activeItemId", "demo:lastItemResult", "demo:lastItemResult"],
  );
  console.log("blueprint-callsite-audit-probe: raw CL2 and legacy crosswalk ok");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
