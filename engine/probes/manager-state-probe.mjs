import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { RuntimeCollectionRegistry } from "../core/RuntimeCollectionRegistry.js";
import { EventActivityRouter } from "../core/EventActivityRouter.js";

const bus = new EventBus();
const variables = new VariableStore(bus);
const collections = new RuntimeCollectionRegistry({ eventBus: bus });
collections.loadDefinitions({ managerStates: { stateOnly: true }, eventHistory: { stateOnly: true } });
const router = new EventActivityRouter({
  eventBus: bus,
  variableStore: variables,
  runtimeGateway: collections,
  routes: [
    ...["achievement", "inventory", "keyword"].map((manager) => ({
      event: `${manager}:manager-ready`,
      actions: [
        { type: "collection.set", collectionId: "managerStates", recordId: manager, value: { manager, status: "ready", lastRun: "manager-ready" } },
        { type: "collection.append", collectionId: "eventHistory", value: { kind: "manager-ready", manager } },
      ],
    })),
  ],
}).start();

for (const manager of ["achievement", "inventory", "keyword"]) bus.emit(`${manager}:manager-ready`, { source: `${manager}-manager` });
assert.deepEqual(collections.get("managerStates"), [
  { id: "achievement", manager: "achievement", status: "ready", lastRun: "manager-ready" },
  { id: "inventory", manager: "inventory", status: "ready", lastRun: "manager-ready" },
  { id: "keyword", manager: "keyword", status: "ready", lastRun: "manager-ready" },
]);
assert.equal(collections.get("eventHistory").length, 3);

const snapshot = collections.snapshot();
collections.restore({});
assert.deepEqual(collections.get("managerStates"), []);
collections.restore(snapshot);
assert.deepEqual(collections.get("managerStates")[1], { id: "inventory", manager: "inventory", status: "ready", lastRun: "manager-ready" });
router.stop();
console.log("manager-state-probe: ok");
