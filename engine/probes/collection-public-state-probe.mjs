import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { PublicVariableManager } from "../core/PublicVariableManager.js";
import RuntimeCollectionRegistry from "../core/RuntimeCollectionRegistry.js";
import { DesktopShell } from "../core/desktopDesktopShell.js";

const eventBus = new EventBus();
const publicVariables = new PublicVariableManager(null, eventBus);
publicVariables.register({ id: 1002, name: "playerCollectedData", type: "json", defaultValue: { keywords: {}, inventoryItems: {} } });
const records = {
  keywords: [{ id: "known", content: "已知" }, { id: "hidden", content: "未收集" }],
  inventoryItems: [{ id: "owned", name: "持有" }, { id: "absent", name: "没有" }],
};
const dataStore = { findRecords: (id) => records[id] || [] };
const collections = new RuntimeCollectionRegistry({ dataStore, eventBus, publicVariableManager: publicVariables, publicStateVariableId: 1002 });
collections.loadDefinitions({
  keywords: { databaseId: "keywords", mergeState: true, stateField: "collected", filterState: true, keyField: "id" },
  inventoryItems: { databaseId: "inventoryItems", mergeState: true, stateField: "ownedCount", filterState: true, keyField: "id" },
});
collections.set("keywords", "known", true);
collections.set("inventoryItems", "owned", 2);
assert.deepEqual(collections.get("keywords").map((record) => record.id), ["known"]);
assert.deepEqual(collections.get("inventoryItems").map((record) => record.id), ["owned"]);
assert.equal(publicVariables.get(1002).keywords.known, true);
assert.equal(publicVariables.get(1002).inventoryItems.owned, 2);

const cloned = DesktopShell.prototype._cloneRuntimeComponent.call({}, {
  widgetId: "his-prescription-row-2",
  type: "container",
  children: [{ widgetId: "his-medicine-select-2", value: { variable: "his:medChoice2" } }],
}, 3);
assert.equal(cloned.children[0].value.variable, "his:medChoice3");
console.log("collection-public-state-probe: ok");
