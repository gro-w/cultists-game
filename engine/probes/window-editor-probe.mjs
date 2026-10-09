import assert from "node:assert/strict";
import { createWindowEditorModel } from "../dev/WindowEditorModel.js";

const baseDefinition = {
  id: "off-duty",
  title: "下班模式",
  mode: "window",
  fullscreen: true,
  geometry: { x: 0, y: 0, width: 800, height: 600 },
  root: {
    widgetId: "root",
    type: "container",
    flow: "vertical",
    gap: 8,
    padding: 10,
    children: [
      { widgetId: "title-label", type: "label", text: "下班模式" },
    ],
  },
  events: { onCreate: null, onDestroy: null },
};

// --- add/select/inspect ---
{
  const model = createWindowEditorModel({ definition: baseDefinition });
  assert.equal(model.listWidgets().length, 2);

  const button = model.addWidget("button", "root");
  assert.ok(button);
  assert.equal(model.getSelectedId(), button.widgetId);
  assert.equal(model.listWidgets().length, 3);

  model.updateWidgetProps(button.widgetId, { text: "去睡觉" });
  assert.equal(model.getSelected().text, "去睡觉");
}

// --- duplicate ---
{
  const model = createWindowEditorModel({ definition: baseDefinition });
  const original = model.findWidget("title-label").node;
  const copy = model.duplicateWidget("title-label");
  assert.notEqual(copy.widgetId, original.widgetId);
  assert.equal(copy.text, original.text);
  assert.equal(model.listWidgets().length, 3);
}

// --- move (reorder within same container) ---
{
  const model = createWindowEditorModel({ definition: baseDefinition });
  const a = model.addWidget("button", "root");
  const b = model.addWidget("button", "root");
  const rootChildren = () => model.findWidget("root").node.children.map((c) => c.widgetId);
  assert.deepEqual(rootChildren(), ["title-label", a.widgetId, b.widgetId]);
  model.moveWidget(b.widgetId, "root", 0);
  assert.deepEqual(rootChildren(), [b.widgetId, "title-label", a.widgetId]);
}

// --- move into a nested container (reparent) ---
{
  const model = createWindowEditorModel({ definition: baseDefinition });
  const inner = model.addWidget("container", "root");
  const btn = model.addWidget("button", "root");
  model.moveWidget(btn.widgetId, inner.widgetId, 0);
  assert.deepEqual(model.findWidget(inner.widgetId).node.children.map((c) => c.widgetId), [btn.widgetId]);
  assert.equal(model.findWidget("root").node.children.some((c) => c.widgetId === btn.widgetId), false);
}

// --- cannot move a container into its own subtree ---
{
  const model = createWindowEditorModel({ definition: baseDefinition });
  const outer = model.addWidget("container", "root");
  const inner = model.addWidget("container", outer.widgetId);
  const moved = model.moveWidget(outer.widgetId, inner.widgetId, 0);
  assert.equal(moved, false, "moving a container into its own descendant must be rejected");
}

// --- remove; root cannot be removed ---
{
  const model = createWindowEditorModel({ definition: baseDefinition });
  assert.equal(model.removeWidget("root"), false);
  assert.equal(model.removeWidget("title-label"), true);
  assert.equal(model.listWidgets().length, 1);
}

// --- undo/redo round-trips a mutation ---
{
  const model = createWindowEditorModel({ definition: baseDefinition });
  model.updateWidgetProps("title-label", { text: "changed" });
  assert.equal(model.getSelected(), null); // updateWidgetProps doesn't change selection
  model.select("title-label");
  assert.equal(model.getSelected().text, "changed");
  model.undo();
  assert.equal(model.findWidget("title-label").node.text, "下班模式");
  model.redo();
  assert.equal(model.findWidget("title-label").node.text, "changed");
}

// --- window-level props (fullscreen etc.) update without touching the widget tree ---
{
  const model = createWindowEditorModel({ definition: baseDefinition });
  model.updateWindowProps({ fullscreen: false });
  assert.equal(model.toDefinition().fullscreen, false);
  assert.equal(model.toDefinition().root.children.length, 1);
}

// --- toDefinition() round-trips through the shared renderer's expected schema ---
{
  const model = createWindowEditorModel({ definition: baseDefinition });
  const definition = model.toDefinition();
  assert.equal(definition.root.type, "container");
  assert.equal(definition.geometry.width, 800);
  // mutating the returned snapshot must never leak back into the model
  definition.title = "mutated";
  assert.equal(model.toDefinition().title, "下班模式");
}

// --- a definition without a `root` widget tree (e.g. body-only legacy
// windows like example.json) never crashes the model; a default empty
// root is synthesized so renderNode()-style tree walks always see a node ---
{
  const model = createWindowEditorModel({ definition: { id: "example", title: "Example", body: "<p>hi</p>" } });
  assert.ok(model.definition.root);
  assert.equal(model.definition.root.type, "container");
  assert.equal(model.listWidgets().length, 1);
}

// --- greenfield definition, add-inspector defaults, rename and collection round-trip ---
{
  const model = createWindowEditorModel();
  assert.equal(model.definition.width, 480);
  assert.equal(model.definition.height, 320);
  const list = model.addWidget("list", "root");
  assert.deepEqual(list.items, []);
  model.updateWidgetProps(list.widgetId, {
    items: [{ id: "item", label: "Ticket", metadata: { price: 5 } }],
    itemActions: [{ id: "use", label: "Use", eventName: "onUse" }],
  });
  assert.equal(model.renameWidget(list.widgetId, "inventory-list"), true);
  assert.equal(model.getSelectedId(), "inventory-list");
  assert.equal(model.renameWidget("inventory-list", "root"), false, "widget IDs must remain unique");
  const saved = model.toDefinition();
  assert.equal(saved.root.children[0].items[0].metadata.price, 5);
  assert.equal(saved.root.children[0].itemActions[0].eventName, "onUse");
  assert.equal(model.renameWidget("inventory-list", "bad/id"), false, "widget IDs cannot include path separators");
}

console.log("window-editor-probe: all scenarios passed");
