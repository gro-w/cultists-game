import assert from "node:assert/strict";
import { createWindowEditorModel } from "../dev/WindowEditorModel.js";
import { WindowEditorView } from "../dev/WindowEditorView.js";

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    fire(type, event) {
      for (const callback of listeners.get(type) || []) callback.call(this, event);
    },
  };
}

const documentEl = eventTarget();
function element(rect, ownerDocument = documentEl) {
  return {
    ...eventTarget(),
    style: {},
    dataset: {},
    ownerDocument,
    capturedPointer: null,
    releasedPointer: null,
    setPointerCapture(id) { this.capturedPointer = id; },
    releasePointerCapture(id) { this.releasedPointer = id; },
    getBoundingClientRect() { return rect; },
  };
}

const model = createWindowEditorModel({
  definition: {
    id: "drag-layout",
    root: {
      widgetId: "root",
      type: "container",
      flow: "vertical",
      padding: 8,
      children: [
        { widgetId: "first", type: "label", text: "First" },
        { widgetId: "second", type: "button", text: "Second" },
      ],
    },
  },
});
const view = Object.create(WindowEditorView.prototype);
view.model = model;
view.render = () => {};
const rootEl = element({ left: 100, top: 100, width: 400, height: 300 });
const firstEl = element({ left: 110, top: 110, width: 150, height: 24 });
const secondEl = element({ left: 110, top: 142, width: 150, height: 30 });
const widgetEls = new Map([["root", rootEl], ["first", firstEl], ["second", secondEl]]);
view._bindPreviewDrag(rootEl, widgetEls);

firstEl.fire("pointerdown", {
  pointerId: 7,
  button: 0,
  clientX: 114,
  clientY: 114,
  preventDefault() {},
});
documentEl.fire("pointermove", {
  pointerId: 7,
  clientX: 240,
  clientY: 190,
  preventDefault() {},
});
documentEl.fire("pointerup", {
  pointerId: 7,
  clientX: 240,
  clientY: 190,
});

const root = model.findWidget("root").node;
assert.equal(root.flow, "stack");
assert.deepEqual(
  { x: model.findWidget("second").node.x, y: model.findWidget("second").node.y },
  { x: 10, y: 42 },
  "non-dragged siblings must retain their rendered positions when a flow container becomes a stack",
);
assert.deepEqual(
  { x: model.findWidget("first").node.x, y: model.findWidget("first").node.y },
  { x: 240 - 100 - 4, y: 190 - 100 - 4 },
  "the dragged item must land at the drop point relative to its original pointer offset",
);
assert.equal(firstEl.capturedPointer, 7, "the dragged widget must capture its pointer");
assert.equal(firstEl.releasedPointer, 7, "the dragged widget must release its pointer");
assert.equal(secondEl.style.position, "absolute");
assert.equal(secondEl.style.left, "10px", "live preview positions siblings while the pointer is held");
view.previewDragCleanup();

const nestedDocument = eventTarget();
const nestedModel = createWindowEditorModel({
  definition: {
    id: "cross-container-drag",
    root: {
      widgetId: "root",
      type: "container",
      flow: "vertical",
      children: [
        { widgetId: "movable", type: "label", text: "Move" },
        { widgetId: "target", type: "container", flow: "vertical", children: [
          { widgetId: "existing", type: "label", text: "Keep" },
        ] },
      ],
    },
  },
});
const nestedView = Object.create(WindowEditorView.prototype);
nestedView.model = nestedModel;
nestedView.render = () => {};
const nestedRootEl = element({ left: 100, top: 100, width: 500, height: 300 }, nestedDocument);
const movableEl = element({ left: 110, top: 110, width: 120, height: 24 }, nestedDocument);
const targetEl = element({ left: 250, top: 100, width: 200, height: 200 }, nestedDocument);
const existingEl = element({ left: 260, top: 110, width: 120, height: 24 }, nestedDocument);
targetEl.dataset.widgetId = "target";
existingEl.dataset.widgetId = "existing";
nestedDocument.elementFromPoint = () => existingEl;
nestedView._bindPreviewDrag(nestedRootEl, new Map([
  ["root", nestedRootEl],
  ["movable", movableEl],
  ["target", targetEl],
  ["existing", existingEl],
]));
movableEl.fire("pointerdown", { pointerId: 8, button: 0, clientX: 114, clientY: 114, stopPropagation() {} });
nestedDocument.fire("pointermove", { pointerId: 8, clientX: 275, clientY: 125, preventDefault() {} });
nestedDocument.fire("pointerup", { pointerId: 8, clientX: 275, clientY: 125 });
assert.deepEqual(
  nestedModel.findWidget("target").node.children.map((widget) => widget.widgetId),
  ["existing", "movable"],
  "dropping onto a different container must reparent the widget instead of leaving it in its source flow",
);
assert.deepEqual(
  { x: nestedModel.findWidget("existing").node.x, y: nestedModel.findWidget("existing").node.y },
  { x: 10, y: 10 },
  "destination siblings must keep their visual positions during reparenting",
);
assert.deepEqual(
  { x: nestedModel.findWidget("movable").node.x, y: nestedModel.findWidget("movable").node.y },
  { x: 21, y: 21 },
  "the moved widget must use destination-local coordinates",
);
nestedView.previewDragCleanup();

console.log("window-editor-drag-probe: flow-to-stack conversion preserves sibling layout and pointer offset");
