import assert from "node:assert/strict";
import { ActivityQueue } from "../core/ActivityQueue.js";

const queue = new ActivityQueue("main");
for (let index = 0; index < 2000; index += 1) {
  const archived = queue.append({ activityId: `archived-${index}` });
  archived.status = "resolved";
}
const target = queue.append({ activityId: "hot-path" });
let indexedReads = 0;
queue.entries = new Proxy(queue.entries, {
  get(entries, property, receiver) {
    if (typeof property === "string" && /^\d+$/.test(property)) indexedReads += 1;
    return Reflect.get(entries, property, receiver);
  },
});

assert.equal(queue.get(target.instanceId), target);
assert.equal(queue.update(target.instanceId, { currentNodeId: "next" }), true);
assert.equal(target.currentNodeId, "next");
assert.equal(indexedReads, 0, "hot instance lookup/update must not scan ordered queue entries");

assert.equal(queue.remove(target.instanceId), true);
assert.equal(queue.get(target.instanceId), null);
const appended = queue.append({ activityId: "after-remove" });
assert.equal(queue.get(appended.instanceId), appended);

const duplicateFirst = queue.append({ activityId: "duplicate-id", instanceId: "duplicate-id:fixed" });
const duplicateSecond = queue.append({ activityId: "duplicate-id", instanceId: "duplicate-id:fixed" });
assert.equal(queue.get(duplicateFirst.instanceId), duplicateFirst, "duplicate IDs preserve the first-match lookup contract");
assert.equal(queue.remove(duplicateFirst.instanceId), true);
assert.equal(queue.get(duplicateSecond.instanceId), duplicateSecond, "removing the indexed duplicate promotes the next match");
assert.equal(queue.remove(duplicateSecond.instanceId), true);

const snapshot = queue.snapshot();
const restored = new ActivityQueue("main");
restored.restore(snapshot);
assert.equal(restored.get(appended.instanceId)?.activityId, "after-remove");
assert.equal(restored.update(appended.instanceId, { currentNodeId: "restored" }), true);
assert.equal(restored.get(appended.instanceId).currentNodeId, "restored");
console.log(`activity-queue-index-probe: ${queue.entries.length} ordered entries; hot get/update indexed; remove/restore passed`);
