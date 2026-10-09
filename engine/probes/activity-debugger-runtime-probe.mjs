import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { createActivityInstance } from "../core/ActivityInstance.js";

const bus = new EventBus();
const registry = new ActivityQueueRegistry(bus);
const events = [];
for (const name of ["activity:appended", "activity:changed"]) bus.on(name, (payload) => events.push({ name, payload }));
const queue = registry.get("main");
const instance = registry.append("main", { activityId: "debuggable", currentNodeId: "node-a" });
assert.equal(events[0].name, "activity:appended");
assert.equal(registry.updateEntry("main", instance.instanceId, { status: "paused" }), true);
assert.equal(queue.get(instance.instanceId).status, "paused");
assert.equal(registry.removeEntry("main", instance.instanceId), true);
assert.equal(events.at(-1).payload.removed, true);

const first = createActivityInstance({ instanceId: "debuggable:1", activityId: "debuggable", queueId: "main", localVariables: { value: 1 } });
const second = createActivityInstance({ instanceId: "debuggable:2", activityId: "debuggable", queueId: "main", localVariables: { value: 2 } });
assert.notEqual(first.localVariables, second.localVariables);
assert.equal(new ActivityExecutionService(bus).setLocalVariable("missing", "value", 3), false);
console.log("activity-debugger-runtime-probe: ok");
