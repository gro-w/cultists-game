import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BlueprintNodeManagerView } from "../dev/BlueprintNodeManagerView.js";
import { registerCustomActivityNode, getActivityNodeDefinition } from "../core/ActivityNodeRegistry.js";

const source = JSON.parse(await readFile(new URL("../example.data/blueprint-nodes.json", import.meta.url), "utf8"));
const nodes = source.filter((node) => ["example-use-item", "example-inspect-item"].includes(node.id));
assert.equal(nodes.length, 2, "the example package contains both requested custom nodes");
for (const node of nodes) registerCustomActivityNode(node);

const opened = [];
const view = Object.create(BlueprintNodeManagerView.prototype);
Object.assign(view, {
  nodes,
  selectedId: null,
  openEditor: (node, onSave) => opened.push({ node, onSave }),
  render: () => {},
});

for (const node of nodes) {
  assert.equal(view.openBlueprintEditor(node.id), true, `${node.id} can be opened from the manager`);
  const editor = opened.at(-1);
  assert.equal(editor.node.id, node.id);
  const updatedBlueprint = structuredClone(node.blueprint);
  updatedBlueprint.nodes.start.x += 37;
  editor.onSave(updatedBlueprint);
  assert.equal(node.blueprint.nodes.start.x, updatedBlueprint.nodes.start.x,
    `${node.id} saves its edited graph back to the manager's node definition`);
  assert.equal(getActivityNodeDefinition(node.id).blueprint.nodes.start.x, updatedBlueprint.nodes.start.x,
    `${node.id} refreshes the registered runtime definition after save`);
}

console.log("blueprint-node-manager-probe: use-item and inspect-item edit/save path passed");
