import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WindowEditorView } from "../dev/WindowEditorView.js";
import { createWindowEditorModel } from "../dev/WindowEditorModel.js";

const inventory = JSON.parse(await readFile(new URL("../example.data/windows/inventory.json", import.meta.url), "utf8"));
const list = inventory.root.children.find((widget) => widget.widgetId === "inventory-list");
assert.ok(list, "example inventory must expose its data-driven list widget");

const view = Object.create(WindowEditorView.prototype);
const fields = new Map(view._fieldsFor(list).map((field) => [field.key, field]));
assert.equal(fields.get("itemTemplate")?.type, "subEditor", "the item template is edited in a dedicated visual child editor");
assert.equal(fields.get("itemTemplate")?.bindable, true, "the complete template can be supplied by a blueprint");
assert.equal(fields.has("itemLabelTemplate"), false, "template strings are not directly exposed in the right-hand inspector");
assert.equal(fields.get("items")?.bindable, true, "the blueprint must be able to provide the records to fill the template");

const model = createWindowEditorModel({ definition: inventory });
model.updateWidgetProps("inventory-list", {
  itemTemplate: { nodeId: "itemTemplate", port: "value" },
  items: { nodeId: "items", port: "value" },
});
const savedList = model.toDefinition().root.children.find((widget) => widget.widgetId === "inventory-list");
assert.deepEqual(savedList.itemTemplate, { nodeId: "itemTemplate", port: "value" });
assert.deepEqual(savedList.items, { nodeId: "items", port: "value" });
assert.ok(model.toDefinition().valueGraph.nodes.items, "the item records remain sourced from the window's blueprint graph");

console.log("window-editor-template-probe: list templates are sub-edited and blueprint-bound template/data round-trip passed");
