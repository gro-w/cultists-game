import assert from "node:assert/strict";
import { createActivityEditorModel } from "../dev/ActivityEditorModel.js";

const model = createActivityEditorModel({
  activityId: "layout-probe",
  blueprint: {
    nodes: {
      first: { id: "first", type: "flowStart", inputs: {}, next: {} },
      second: { id: "second", type: "flowEnd", inputs: {}, next: {} },
    },
    startNodeId: "first",
  },
});

for (const node of model.listNodes()) {
  assert.equal(Number.isFinite(node.x), true, `${node.id}.x must be finite`);
  assert.equal(Number.isFinite(node.y), true, `${node.id}.y must be finite`);
}

console.log("activity-editor-layout-probe: ok");
