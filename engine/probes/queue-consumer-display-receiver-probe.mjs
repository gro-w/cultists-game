import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityQueueConsumer } from "../core/ActivityQueueConsumer.js";
import { DisplayReceiverRegistry } from "../core/DisplayReceiverRegistry.js";

const queues = new ActivityQueueRegistry();
const queue = queues.register("social");
const definitions = { get: (id) => id === "scene" ? { id, blueprint: {} } : null };
const instance = queue.append({ activityId: "scene", payload: { displayTo: "social" } });
let consumed = null;
const consumer = new ActivityQueueConsumer({
  queueRegistry: queues,
  activityDefinitionStore: definitions,
  execute: (event) => { consumed = event; return event.instance; },
});
assert.equal(consumer.current("social").instanceId, instance.instanceId);
assert.equal(consumer.consume("social").instanceId, instance.instanceId);
assert.equal(consumed.queue.queueId, "social");
assert.equal(consumer.consume("missing"), null);

const registry = new DisplayReceiverRegistry();
const events = [];
const receiver = { handle: (payload) => events.push(payload) };
const unregister = registry.register("social", receiver);
assert.equal(registry.dispatch("social", { type: "text", text: "hello" }), true);
assert.equal(events[0].text, "hello");
unregister();
assert.equal(registry.dispatch("social", { type: "text" }), false);
const defaultUnregister = registry.register("his-app", receiver);
assert.equal(registry.dispatch("default", { type: "choice", options: ["A"] }), true);
assert.equal(events.at(-1).type, "choice");
defaultUnregister();

const bus = new EventBus();
assert.equal(bus.listenerCount(), 0);
console.log("queue-consumer-display-receiver probe: ok");
