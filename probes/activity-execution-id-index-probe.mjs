import assert from "node:assert/strict";
import { createActivityRunner } from "../core/ActivityRunner.js";

const actionCount = 240;
const nodes = {
  start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "action0", port: "flowIn" } } },
};
for (let index = 0; index < actionCount; index += 1) {
  const id = `action${index}`;
  nodes[id] = {
    id,
    type: "setVariable",
    inputs: { key: id, value: index },
    next: { flowOut: { nodeId: index + 1 < actionCount ? `action${index + 1}` : "end", port: "flowIn" } },
  };
}
nodes.end = { id: "end", type: "activityEnd", inputs: {}, next: {} };
const blueprint = { startNodeId: "start", nodes, connections: [] };
const executedNodeIds = [];
let linearMembershipChecks = 0;
Object.defineProperty(executedNodeIds, "includes", {
  configurable: true,
  value(value, fromIndex) {
    linearMembershipChecks += 1;
    return Array.prototype.includes.call(this, value, fromIndex);
  },
});
const instance = {
  instanceId: "execution-id-index",
  status: "unresolved",
  executedNodeIds,
  localVariables: {},
};
const values = new Map();
createActivityRunner({
  definition: { id: "execution-id-index", blueprint },
  instance,
  variableStore: { get: (key) => values.get(key), set: (key, value) => values.set(key, value), delta: () => {} },
}).start();

delete executedNodeIds.includes;
assert.equal(instance.status, "resolved");
assert.equal(values.get(`action${actionCount - 1}`), actionCount - 1);
assert.equal(instance.executedNodeIds.length, actionCount + 1);
assert.equal(linearMembershipChecks, 0, "recording each completed node must not rescan the execution history array");
console.log(`activity-execution-id-index-probe: ${actionCount + 2} flow steps, ${instance.executedNodeIds.length} unique executed nodes, no linear membership scans`);
