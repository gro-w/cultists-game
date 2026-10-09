import { t } from "./i18n/index.js";
import { getActivityNodeDefinition, getActivityNodePort, arePortsCompatible } from "./ActivityNodeRegistry.js";

/**
 * ActivityValidator - Blueprint schema normalization and structural
 * validation for the generic Activity node set (plan §13 Phase 2, §6.3
 * editor save-time rules).
 *
 * Schema (plan item "蓝图是一个流程只记录下家的链表，数值是只记录上家的链表"):
 * there is no flat top-level `connections` array. Each node instead carries
 *   - `next[outputPortName] = { nodeId, port }` for its flow outputs - a
 *     flow output can only ever point at ONE downstream node/port, exactly
 *     like a singly-linked list's `next` pointer (a flow *input* can still
 *     be targeted by any number of upstream `next` entries, since nothing
 *     stops several nodes from linking to the same input).
 *   - `inputs[valuePortName] = { nodeId, port }` for a value input wired to
 *     an upstream value output - a value input can only ever have ONE
 *     upstream source, again exactly one link in a singly-linked list (a
 *     value *output* can still be read by any number of downstream inputs).
 * `inputs[name]` may otherwise hold a plain literal or the legacy
 * `{ variable: name }` global-variable-read shorthand.
 */
function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isWireRef(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "nodeId" in value);
}

export function normalizeBlueprint(raw) {
  const source = raw || {};
  const nodes = {};
  for (const [id, node] of Object.entries(source.nodes || {})) {
    nodes[id] = { ...clone(node), id: node?.id || id, inputs: { ...(node?.inputs || {}) }, next: { ...(node?.next || {}) } };
    if (node?.type === "choice" && Array.isArray(node.options)) {
      nodes[id].inputs.options = clone(node.options);
      nodes[id].inputs.optionCount = Number(node.inputs?.optionCount ?? node.inputs?.branchCount ?? node.options.length);
      nodes[id].inputs.selectionKey ||= `choice:${id}`;
      node.options.forEach((option, index) => {
        if (option?.next) nodes[id].next[`option${index}`] = { nodeId: option.next, port: "flowIn" };
      });
    }
  }
  // Back-compat: fold a legacy flat `connections` array (fromNodeId/
  // fromPort/toNodeId/toPort) into the next/inputs-only shape on load, so
  // any blueprint authored before this schema change still loads. Nothing
  // is ever written back out in the old shape.
  for (const connection of Array.isArray(source.connections) ? source.connections : []) {
    const fromNode = nodes[connection.fromNodeId];
    const toNode = nodes[connection.toNodeId];
    if (!fromNode || !toNode) continue;
    const sourcePort = getActivityNodePort(fromNode.type, "output", connection.fromPort);
    if (sourcePort?.kind === "flow") {
      fromNode.next[connection.fromPort] = { nodeId: connection.toNodeId, port: connection.toPort };
    } else {
      toNode.inputs[connection.toPort] = { nodeId: connection.fromNodeId, port: connection.fromPort };
    }
  }
  const startNodeId = source.startNodeId || Object.values(nodes).find((node) => node.type === "flowStart")?.id || null;
  return { nodes, startNodeId };
}

function flowPorts(direction, definition) {
  return (direction === "input" ? definition?.flowInputs : definition?.flowOutputs) || [];
}

export function validateBlueprint(raw) {
  const blueprint = normalizeBlueprint(raw);
  const errors = [];
  const entries = Object.entries(blueprint.nodes);

  const starts = entries.filter(([, node]) => node.type === "flowStart");
  if (starts.length !== 1) errors.push(`${t("legacy.7ee8757a4386")}${starts.length} ${t("legacy.f7b2a6ee68ec")}`);
  if (!blueprint.startNodeId || !blueprint.nodes[blueprint.startNodeId]) errors.push(t("legacy.1b75d4308c3d"));
  if (blueprint.startNodeId && blueprint.nodes[blueprint.startNodeId]?.type !== "flowStart") errors.push(t("legacy.30e2f42e49e5"));

  const ends = entries.filter(([, node]) => node.type === "activityEnd");
  if (!ends.length) errors.push(t("legacy.44fc63aa163b"));

  for (const [id, node] of entries) {
    if (node.id !== id) errors.push(`${t("legacy.19ff6f856978")}${id} ${t("legacy.0bbe6b12e4a0")}id ${node.id} ${t("legacy.ea88dc52f534")}`);
    const definition = getActivityNodeDefinition(node.type);
    if (!definition) { errors.push(`${t("legacy.fa002d2c545a")}${id} ${t("legacy.f1854a26d944")}${node.type}`); continue; }

    if (node.type !== "activityEnd") {
      // `choice` over-provisions a fixed static port list (option0..
      // option5); only the first `optionCount` of them are required to be
      // wired, the rest are simply unused ports, not validation errors.
      const optionCount = Number(node.inputs?.optionCount) || 0;
      const branchCount = node.type === "framework:randomBranch" ? Number(node.inputs?.n) || 0 : 0;
      const requiredCount = node.type === "choice" ? optionCount : branchCount;
      const outputPorts = requiredCount > 0
        ? flowPorts("output", definition).slice(0, requiredCount)
        : flowPorts("output", definition);
      for (const port of outputPorts) {
        const target = node.next?.[port.name];
        if (!port.optional && !target?.nodeId) { errors.push(`${t("legacy.fa002d2c545a")}${id} ${t("legacy.b48518042a33")}${port.name} ${t("legacy.f2f3e9803ccb")}`); continue; }
        if (!target?.nodeId) continue;
        const targetNode = blueprint.nodes[target.nodeId];
        const targetPort = targetNode ? getActivityNodePort(targetNode.type, "input", target.port) : null;
        if (!targetNode) errors.push(`${t("legacy.fa002d2c545a")}${id} ${t("legacy.b48518042a33")}${port.name} ${t("legacy.ae5abd4df760")}`);
        else if (!targetPort) errors.push(`${t("legacy.fa002d2c545a")}${id} ${t("legacy.b48518042a33")}${port.name} ${t("legacy.407fe78b2fc8")}`);
        else if (!arePortsCompatible(port, targetPort)) errors.push(`${t("legacy.fa002d2c545a")}${id} ${t("legacy.b48518042a33")}${port.name} ${t("legacy.612b75fb27de")}`);
      }
    }

    for (const [inputName, rawInput] of Object.entries(node.inputs || {})) {
      if (!isWireRef(rawInput)) continue;
      const sourceNode = blueprint.nodes[rawInput.nodeId];
      const sourcePort = sourceNode ? getActivityNodePort(sourceNode.type, "output", rawInput.port) : null;
      const targetPort = getActivityNodePort(node.type, "input", inputName);
      if (!sourceNode || !sourcePort) { errors.push(`${t("legacy.fa002d2c545a")}${id} ${t("legacy.941ec8d30763")}${inputName} ${t("legacy.66ffdc123efa")}`); continue; }
      if (sourcePort.kind !== "value" || targetPort?.kind !== "value") { errors.push(`${t("legacy.fa002d2c545a")}${id} ${t("legacy.941ec8d30763")}${inputName} ${t("legacy.4940f4034d08")}`); continue; }
      if (!arePortsCompatible(sourcePort, targetPort)) errors.push(`${t("legacy.fa002d2c545a")}${id} ${t("legacy.941ec8d30763")}${inputName} ${t("legacy.612b75fb27de")}`);
    }
  }

  const reachable = new Set();
  const pending = blueprint.startNodeId ? [blueprint.startNodeId] : [];
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    // Only flow `next` links advance flow-reachability; a value-port wire
    // (e.g. an `arithmetic` node feeding a `branch`'s condition) never makes
    // the arithmetic node itself part of the flow graph. Nodes revisited via
    // a cycle (the loop replacement pattern) are simply skipped by the
    // `reachable.has(id)` guard above, so cycles terminate this walk fine.
    for (const target of Object.values(blueprint.nodes[id]?.next || {})) {
      if (target?.nodeId) pending.push(target.nodeId);
    }
  }
  entries.forEach(([id, node]) => {
    if (isReachabilityRequired(node.type) && !reachable.has(id)) errors.push(`${t("legacy.a82a4b19507e")}${id} ${t("legacy.283b7e424931")}`);
  });

  return { ok: errors.length === 0, errors, blueprint };
}

function isReachabilityRequired(type) {
  const definition = getActivityNodeDefinition(type);
  return Boolean(definition && (definition.flowInputs?.length || definition.flowOutputs?.length));
}

export default normalizeBlueprint;
