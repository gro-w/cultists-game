import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WindowEditorView } from "../dev/WindowEditorView.js";
import { WindowWidgetSubEditorView } from "../dev/WindowWidgetSubEditorView.js";
import { createWindowEditorModel } from "../dev/WindowEditorModel.js";
import { renderWidgetNode } from "../core/WidgetLayoutRenderer.js";

const inventory = JSON.parse(await readFile(new URL("../example.data/windows/inventory.json", import.meta.url), "utf8"));
const list = inventory.root.children.find((widget) => widget.widgetId === "inventory-list");
assert.ok(list, "the inventory window includes its database-backed list");

const view = Object.create(WindowEditorView.prototype);
const listFields = view._fieldsFor(list);
const listTemplateEditor = listFields.find((field) => field.editorKind === "list-template");
assert.ok(listTemplateEditor, "list template settings are opened from the inspector sub-editor action");
assert.equal(listFields.some((field) => ["itemLabelTemplate", "itemMetaTemplate"].includes(field.key)), false,
  "template strings are not exposed as direct inspector/JSON fields");
assert.equal(listFields.find((field) => field.key === "itemTemplate")?.bindable, true,
  "the complete list template can be provided by a blueprint");
assert.equal(listFields.find((field) => field.key === "items")?.bindable, true,
  "blueprints can still provide the records rendered by the template");

const tabsFields = view._fieldsFor({ widgetId: "settings-tabs", type: "tabs", children: [] });
assert.ok(tabsFields.some((field) => field.editorKind === "tabs"),
  "tabs containers expose an inspector sub-editor for tab options");

const recordTabsFields = view._fieldsFor({ widgetId: "records-tabs", type: "recordTabs", items: [] });
assert.ok(recordTabsFields.some((field) => field.editorKind === "record-tabs"),
  "recordTabs exposes an inspector sub-editor for tab data and display settings");
assert.equal(recordTabsFields.some((field) => field.type === "collection"), false,
  "tab collections and mappings are not edited as raw nested objects in the inspector");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.classList = {
      add: (...names) => names.forEach((name) => this._classes.add(name)),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this._classes.has(name) : Boolean(force);
        if (enabled) this._classes.add(name);
        else this._classes.delete(name);
        return enabled;
      },
    };
    this._classes = new Set();
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(type, listener) {
    const group = this.listeners.get(type) || [];
    group.push(listener);
    this.listeners.set(type, group);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  emit(type) { for (const listener of this.listeners.get(type) || []) listener({ target: this, stopPropagation() {}, preventDefault() {} }); }
  click() { this.emit("click"); }
}

const previousDocument = globalThis.document;
globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
const find = (root, predicate) => {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
};

try {
  let listPatch;
  const listEditor = new WindowWidgetSubEditorView({
    kind: "list-template",
    widget: { widgetId: "inventory-list", itemIconField: "icon", itemLabelTemplate: "{{name}}", itemMetaTemplate: "{{category}}", items: { nodeId: "items", port: "value" } },
    onSave: (patch) => { listPatch = patch; },
  });
  const canvas = find(listEditor.el, (element) => element.className === "ng-list-template-canvas");
  assert.ok(canvas, "the list template sub-editor has a WYSIWYG canvas");
  assert.ok(find(canvas, (element) => element.dataset.templatePart === "label"),
    "the canvas renders a selectable item-label component");
  assert.ok(find(canvas, (element) => element.dataset.templatePart === "meta"),
    "the canvas renders a selectable metadata component");
  assert.match(find(listEditor.inspectorEl, (element) => element.tagName === "H4" && element.textContent.includes("选中组件")).textContent, /图标/,
    "legacy icon fields become a clearly named selectable visual component");
  const metaPart = find(canvas, (element) => element.dataset.templatePart === "meta");
  metaPart.click();
  assert.equal(listEditor.selectedTemplatePartId, "meta", "clicking a preview component selects it for visual editing");
  const partTemplate = find(listEditor.formEl, (element) => element.dataset.editorField === "part-template");
  partTemplate.value = "{{category}} · changed";
  partTemplate.emit("input");
  assert.match(JSON.stringify(listEditor.templateDraft), /category/,
    "editing a selected visual component updates the structured template draft");
  assert.equal(find(listEditor.previewEl, (element) => element.dataset.templatePart === "meta").textContent, "示例分类 · changed",
    "the same runtime-rendered preview updates immediately as the selected component is edited");
  find(listEditor.inspectorEl, (element) => element.dataset.action === "add-template-part" && element.dataset.partType === "spacer").click();
  const spacerId = listEditor.selectedTemplatePartId;
  assert.equal(listEditor.templateDraft.parts.at(-1).id, spacerId, "adding a visual component updates the template order");
  find(listEditor.inspectorEl, (element) => element.dataset.action === "move-up").click();
  assert.equal(listEditor.templateDraft.parts.at(-2).id, spacerId, "visual components can be reordered");
  find(listEditor.inspectorEl, (element) => element.dataset.action === "remove-template-part").click();
  assert.equal(listEditor.templateDraft.parts.some((part) => part.id === spacerId), false, "visual components can be removed");
  find(listEditor.el, (element) => element.dataset.action === "save").click();
  assert.ok(Array.isArray(listPatch.itemTemplate.parts), "the visual template saves as structured parts");
  assert.equal(listPatch.itemTemplate.parts.find((part) => part.id === "meta").template, "{{category}} · changed");
  assert.equal(Object.hasOwn(listPatch, "items"), false, "the list template editor does not overwrite blueprint-provided records");

  let selectedRuntimePart = null;
  const templatedList = renderWidgetNode({
    widgetId: "templated-list",
    type: "list",
    items: [{ id: "item-1", name: "Example", category: "Tools" }],
    itemTemplate: {
      layout: "vertical",
      parts: [
        { id: "meta", type: "meta", template: "{{category}}" },
        { id: "label", type: "text", template: "{{name}}" },
      ],
    },
  }, { onTemplatePartClick: (partId) => { selectedRuntimePart = partId; } });
  const templatedItem = find(templatedList, (element) => element.dataset.itemId === "item-1");
  assert.deepEqual(templatedItem.children.map((element) => element.dataset.templatePart), ["meta", "label"],
    "runtime rendering follows the visual template part order");
  assert.equal(templatedItem.children[0].textContent, "Tools");
  templatedItem.children[1].click();
  assert.equal(selectedRuntimePart, "label", "runtime template parts expose the same visual selection seam");
  const blueprintTemplate = renderWidgetNode({
    widgetId: "blueprint-templated-list",
    type: "list",
    items: [{ id: "item-2", name: "Blueprint item" }],
    itemTemplate: { variable: "listTemplate" },
  }, {
    variableStore: { get: () => ({ layout: "horizontal", parts: [{ id: "blueprint-label", type: "text", template: "{{name}}" }] }) },
  });
  const blueprintItem = find(blueprintTemplate, (element) => element.dataset.itemId === "item-2");
  assert.equal(blueprintItem.children[0].textContent, "Blueprint item",
    "a blueprint-bound complete template is resolved by the runtime renderer");

  let tabsPatch;
  const tabsEditor = new WindowWidgetSubEditorView({
    kind: "tabs",
    widget: {
      widgetId: "settings-tabs",
      children: [
        { widgetId: "tab-1", type: "container", tabLabel: "General", children: [{ widgetId: "child-1", type: "label", text: "Keep" }] },
        { widgetId: "tab-2", type: "container", tabLabel: "Audio", children: [] },
      ],
    },
    onSave: (patch) => { tabsPatch = patch; },
  });
  const firstTab = find(tabsEditor.el, (element) => element.dataset.tabLabelIndex === "0");
  firstTab.value = "Basics";
  firstTab.emit("input");
  find(tabsEditor.el, (element) => element.dataset.action === "add-tab").click();
  find(tabsEditor.el, (element) => element.dataset.action === "remove-tab" && element.dataset.index === "1").click();
  find(tabsEditor.el, (element) => element.dataset.action === "save").click();
  assert.equal(tabsPatch.children.length, 2);
  assert.equal(tabsPatch.children[0].tabLabel, "Basics");
  assert.equal(tabsPatch.children[0].children[0].text, "Keep", "editing tab options preserves panel widget trees");
  assert.equal(new Set(tabsPatch.children.map((tab) => tab.widgetId)).size, 2, "added tab IDs are unique");

  const renderedTabs = renderWidgetNode({
    widgetId: "runtime-tabs",
    type: "tabs",
    children: [
      { widgetId: "runtime-tab-one", type: "container", tabLabel: "One", children: [{ widgetId: "first-content", type: "label", text: "First panel" }] },
      { widgetId: "runtime-tab-two", type: "container", tabLabel: "Two", children: [{ widgetId: "second-content", type: "label", text: "Second panel" }] },
    ],
  });
  const tabButtons = find(renderedTabs, (element) => element.className === "ng-widget-tabs-navigation").children;
  const tabPanels = find(renderedTabs, (element) => element.className === "ng-widget-tabs-panels").children;
  assert.equal(tabButtons.length, 2);
  assert.equal(tabPanels[0].hidden, false);
  assert.equal(tabPanels[1].hidden, true);
  tabButtons[1].click();
  assert.equal(tabPanels[0].hidden, true, "selecting a tab hides the previously active panel");
  assert.equal(tabPanels[1].hidden, false, "selecting a tab reveals its content panel");

  let recordTabsPatch;
  const recordTabsEditor = new WindowWidgetSubEditorView({
    kind: "record-tabs",
    widget: { widgetId: "records", items: [{ id: "one", label: "First" }], panelItemsFields: ["entries"] },
    onSave: (patch) => { recordTabsPatch = patch; },
  });
  const recordLabel = find(recordTabsEditor.el, (element) => element.dataset.recordField === "label");
  recordLabel.value = "Overview";
  recordLabel.emit("input");
  find(recordTabsEditor.el, (element) => element.dataset.action === "add-record-tab").click();
  find(recordTabsEditor.el, (element) => element.dataset.action === "add-mapping" && element.dataset.mappingField === "panelItemsFields").click();
  const recordBindingToggle = find(recordTabsEditor.el, (element) => element.dataset.editorField === "items-binding");
  recordBindingToggle.checked = true;
  recordBindingToggle.emit("change");
  const recordBinding = find(recordTabsEditor.el, (element) => element.dataset.editorField === "items");
  recordBinding.value = "@tabRecords:value";
  recordBinding.emit("input");
  find(recordTabsEditor.el, (element) => element.dataset.action === "save").click();
  assert.deepEqual(recordTabsPatch.items, { nodeId: "tabRecords", port: "value" });
  assert.deepEqual(recordTabsPatch.panelItemsFields, ["entries", ""]);

  const editorModel = createWindowEditorModel({ definition: inventory });
  editorModel.select("inventory-list");
  let openedSubEditor;
  const hostView = Object.create(WindowEditorView.prototype);
  hostView.model = editorModel;
  hostView.openWidgetSubEditor = (context) => { openedSubEditor = context; };
  hostView.render = () => {};
  assert.equal(hostView._openWidgetSubEditor(editorModel.getSelected(), "list-template"), true);
  openedSubEditor.onSave({ itemLabelTemplate: "{{name}}" });
  assert.equal(editorModel.findWidget("inventory-list").node.itemLabelTemplate, "{{name}}",
    "the sub-editor applies its schema-aware patch to the host window draft");

  const rejectedEditor = new WindowWidgetSubEditorView({ kind: "tabs", widget: {}, onSave: () => false });
  assert.equal(rejectedEditor._save(), false, "a rejected host-draft update is not reported as successful");
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}

console.log("window-editor-subeditor-probe: list templates, blueprint bindings, tab CRUD, and host draft save passed");
