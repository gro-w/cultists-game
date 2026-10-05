// DEV-TOOLS:START
import { getActivityNodeDefinition } from "../core/ActivityNodeRegistry.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function visitWidgetBindings(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach((item) => visitWidgetBindings(item, visitor));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.nodeId === "string") visitor(value);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "events") visitWidgetBindings(child, visitor);
  }
}

function isValueOutputNode(node) {
  const definition = getActivityNodeDefinition(node?.type);
  return Boolean(definition?.valueOutputs?.length)
    && !definition?.flowInputs?.length
    && !definition?.flowOutputs?.length;
}

/**
 * Prepare a detached window value graph for its editor. Widget property
 * bindings are graph outputs, represented by terminal `valueReceiver` nodes.
 * Bound expressions remain reusable value nodes and each component binding
 * gets an outputless receiver wrapper at the graph boundary.
 */
export function prepareWindowValueGraph(definition) {
  const root = clone(definition?.root || {});
  const blueprint = clone(definition?.valueGraph || {});
  blueprint.nodes ||= {};

  const bindings = [];
  visitWidgetBindings(root, (binding) => bindings.push(binding));
  const replacements = new Map();
  for (const binding of bindings) {
    const nodeId = binding.nodeId;
    const node = blueprint.nodes[nodeId];
    if (!isValueOutputNode(node)) continue;
    const outputKey = `${nodeId}:${binding.port || "value"}`;
    if (replacements.has(outputKey)) continue;
    let receiverId = `${nodeId}__receiver`;
    let suffix = 2;
    while (blueprint.nodes[receiverId]) receiverId = `${nodeId}__receiver${suffix++}`;
    blueprint.nodes[receiverId] = {
      id: receiverId,
      type: "valueReceiver",
      inputs: { value: { nodeId, port: binding.port || "value" } },
      next: {},
      cl2Class: "valueReceiver",
      x: Number.isFinite(Number(node.x)) ? Number(node.x) + 220 : undefined,
      y: Number.isFinite(Number(node.y)) ? Number(node.y) + 40 : undefined,
    };
    replacements.set(outputKey, receiverId);
  }

  for (const binding of bindings) {
    const receiverId = replacements.get(`${binding.nodeId}:${binding.port || "value"}`);
    if (receiverId) binding.nodeId = receiverId;
  }
  return { root, blueprint };
}

export default prepareWindowValueGraph;
// DEV-TOOLS:END
