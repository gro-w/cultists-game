import assert from "node:assert/strict";
import "./register-framework-nodes.mjs";
import { createActivityEditorModel } from "../dev/ActivityEditorModel.js";
import { ActivityEditorView } from "../dev/ActivityEditorView.js";
import { serializeCl2 } from "../core/Cl2Serializer.js";

function blueprint(endNodeId) {
  return {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", x: 40, y: 40, inputs: {} },
      [endNodeId]: { id: endNodeId, type: "activityEnd", x: 220, y: 40, inputs: {} },
    },
    connections: [
      { id: "edge-1", fromNodeId: "start", fromPort: "flowOut", toNodeId: endNodeId, toPort: "flowIn" },
    ],
  };
}

const statuses = [];
const view = Object.create(ActivityEditorView.prototype);
view.generatedSourcePanelEl = { hidden: true };
view.generatedSourceEl = { value: "stale source" };
view.generatedSourceErrorEl = { hidden: true, textContent: "" };
view.el = { classList: { add() {}, remove() {} } };
view.editorMode = "graph";
view.dataFileName = "demo.CL2.txt";
view.sourceEl = { value: "" };
view._setStatus = (message, isError = false) => statuses.push({ message, isError });

view.model = createActivityEditorModel({ activityId: "demo", blueprint: blueprint("finish") });
view._showCompiledJavaScript();
const firstSource = view.generatedSourceEl.value;
assert.match(firstSource, /hooks\.enterNode\("finish",/);
assert.doesNotMatch(firstSource, /hooks\.executeNode/);
assert.equal(view.generatedSourcePanelEl.hidden, false);
assert.equal(view.generatedSourceErrorEl.hidden, true);

// A second click must compile the current graph draft instead of reusing output.
view.model = createActivityEditorModel({ activityId: "demo", blueprint: blueprint("finishUpdated") });
view._showCompiledJavaScript();
const secondSource = view.generatedSourceEl.value;
assert.match(secondSource, /hooks\.enterNode\("finishUpdated",/);
assert.notEqual(secondSource, firstSource);
assert.equal(statuses.at(-1).isError, false);

// CL2 mode must parse and recompile the latest text instead of compiling the
// model's older graph snapshot.
view.editorMode = "source";
view.model = createActivityEditorModel({ activityId: "demo", blueprint: blueprint("modelOnly") });
view.sourceEl.value = serializeCl2(blueprint("sourceFinish"), { activityId: "demo" });
view._showCompiledJavaScript();
const firstTextSource = view.generatedSourceEl.value;
assert.match(firstTextSource, /hooks\.enterNode\("sourceFinish",/);
assert.doesNotMatch(firstTextSource, /hooks\.enterNode\("modelOnly",/);

view.sourceEl.value = serializeCl2(blueprint("sourceFinishUpdated"), { activityId: "demo" });
view._showCompiledJavaScript();
assert.match(view.generatedSourceEl.value, /hooks\.enterNode\("sourceFinishUpdated",/);
assert.notEqual(view.generatedSourceEl.value, firstTextSource);

// A failed compilation must not leave the previous successful source visible.
view.editorMode = "graph";
view.model = createActivityEditorModel({ activityId: "demo", blueprint: { startNodeId: "missing", nodes: {}, connections: [] } });
view._showCompiledJavaScript();
assert.equal(view.generatedSourceEl.value, "");
assert.equal(view.generatedSourceErrorEl.hidden, false);
assert.equal(statuses.at(-1).isError, true);

console.log("activity-editor-javascript-probe: recompile, current draft and failure paths passed");
