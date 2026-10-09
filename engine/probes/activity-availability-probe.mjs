import assert from "node:assert/strict";
import "./register-framework-nodes.mjs";
import fs from "node:fs";
import { parseCl2 } from "../core/Cl2Parser.js";
import { evaluateActivityAvailability } from "../core/ActivityAvailabilityEvaluator.js";

const clock = { day: 1, minutes: 40, snapshot() { return { day: this.day, minutes: this.minutes }; } };
const context = {
  gameClock: clock,
  variableStore: { get: () => undefined },
  evaluateCondition: () => true,
};
const definition = {
  id: "gated",
  blueprint: {
    nodes: {
      start: { id: "start", type: "flowStart" },
      gate: { id: "gate", type: "prerequisite", inputs: { condition: true } },
      expiry: { id: "expiry", type: "activityExpiry", inputs: { expires: false, expiresAt: 100 } },
      end: { id: "end", type: "activityEnd" },
    },
    startNodeId: "start",
  },
};
assert.equal(evaluateActivityAvailability(definition, context).ok, true);
definition.blueprint.nodes.expiry.inputs.expiresAt = 0;
assert.equal(evaluateActivityAvailability(definition, context).ok, true);
definition.blueprint.nodes.expiry.inputs.expiresAt = 100;
definition.blueprint.nodes.expiry.inputs.expires = true;
definition.blueprint.nodes.gate.inputs.condition = false;
assert.equal(evaluateActivityAvailability(definition, context).reason, "prerequisite");
definition.blueprint.nodes.gate.inputs.condition = true;
clock.minutes = 100;
assert.equal(evaluateActivityAvailability(definition, context).reason, "expired");
const social = parseCl2(fs.readFileSync("data/activities/social01b_ajie_honor_of_kings.CL2.txt", "utf8"), { validate: false });
assert.equal(social.ok, true, social.diagnostics.map((item) => item.message).join("；"));
clock.minutes = 480;
assert.equal(evaluateActivityAvailability({ id: "social", blueprint: social.graph }, context).ok, true);
console.log("activity-availability probe: ok");
