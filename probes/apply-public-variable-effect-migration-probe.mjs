import "../engine/probes/register-framework-nodes.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseCl2 } from "../engine/core/Cl2Parser.js";

const activityIds = [
  "dorm_activity_day1",
  "dorm_activity_day2",
  "dorm_activity_day3",
  "dorm_activity_day4",
  "medical_complaint_work",
  "medical_riot_work",
  "social02a_awei_chat",
  "social04a_ajie_chat",
  "social04a_awei_chat",
  "social05b_ajie_goods_high",
  "social05b_ajie_goods_low",
  "social05b_awei_record_high",
  "social05b_awei_record_low",
];

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let numericCount = 0;
let valueCount = 0;
for (const activityId of activityIds) {
  const canonicalPath = path.join("data", "activities", `${activityId}.CL2.txt`);
  const legacyPath = path.join("data", "activities", `${activityId}.json`);
  const canonicalSource = fs.readFileSync(canonicalPath, "utf8");
  const parsed = parseCl2(canonicalSource, { sourcePath: canonicalPath, validate: false });
  assert.equal(parsed.ok, true, `${activityId}: ${parsed.diagnostics.map((item) => item.message).join("；")}`);
  const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));

  for (const oldNode of Object.values(legacy.blueprint?.nodes || {})) {
    if (oldNode.type !== "applyPublicVariableEffect") continue;
    const current = parsed.graph.nodes[oldNode.id];
    assert.ok(current, `${activityId}/${oldNode.id}: canonical CL2 node is missing`);
    assert.equal(current.type, oldNode.type, `${activityId}/${oldNode.id}: node type changed`);
    if (Object.hasOwn(oldNode.inputs || {}, "delta")) {
      numericCount += 1;
      assert.deepEqual(
        { id: current.inputs.id, value: current.inputs.value, delta: current.inputs.delta },
        { id: oldNode.inputs.id, value: null, delta: oldNode.inputs.delta },
        `${activityId}/${oldNode.id}: canonical numeric effect must preserve legacy ID/delta ports`,
      );
      const declaration = new RegExp(
        `(?:^|[;\\n])\\s*${escapeRegExp(oldNode.id)}\\s*:\\s*applyPublicVariableEffect\\(([^)]*)\\)`,
        "m",
      ).exec(canonicalSource);
      assert.ok(declaration, `${activityId}/${oldNode.id}: exact CL2 call not found`);
      assert.deepEqual(
        declaration[1].split(",").map((argument) => argument.trim()),
        [String(oldNode.inputs.id), "null", String(oldNode.inputs.delta)],
        `${activityId}/${oldNode.id}: null must retain the empty value port before delta`,
      );
    } else {
      valueCount += 1;
      assert.deepEqual(
        { id: current.inputs.id, value: current.inputs.value },
        { id: oldNode.inputs.id, value: oldNode.inputs.value },
        `${activityId}/${oldNode.id}: boolean set must preserve legacy ID/value ports`,
      );
      assert.equal(Object.hasOwn(current.inputs, "delta"), false, `${activityId}/${oldNode.id}: boolean set must not become a delta`);
    }
  }
}

assert.equal(numericCount, 20, "all 20 numeric effect calls with legacy delta evidence must be checked");
assert.equal(valueCount, 9, "all 9 boolean value calls must remain unchanged");
console.log("apply-public-variable-effect-migration-probe: 20 deltas and 9 values match legacy graphs");
