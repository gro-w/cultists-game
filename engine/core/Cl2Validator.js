import { parseCl2 } from "./Cl2Parser.js";
import { getActivityNodeDefinition, getActivityNodePort, arePortsCompatible } from "./ActivityNodeRegistry.js";

export function classifyActivityNode(type) {
  const definition = getActivityNodeDefinition(type);
  if (!definition) return { kind: "invalid", code: "CL2_UNKNOWN_NODE" };
  const flowIn = Boolean(definition.flowInputs?.length);
  const flowOut = Boolean(definition.flowOutputs?.length);
  const valueIn = Boolean(definition.valueInputs?.length);
  const valueOut = Boolean(definition.valueOutputs?.length);
  if (flowIn && valueOut) return { kind: "invalid", code: "CL2_FLOW_VALUE_OUTPUT_CONFLICT" };
  if (flowIn) return { kind: "flow", flowIn, flowOut, valueIn, valueOut };
  if (valueOut) return { kind: "value", flowIn, flowOut, valueIn, valueOut };
  if (flowOut) return { kind: "start", flowIn, flowOut, valueIn, valueOut };
  if (valueIn) return { kind: "receiver", flowIn, flowOut, valueIn, valueOut };
  return { kind: "invalid", code: "CL2_EMPTY_PIN_SET" };
}

export function validateCl2(sourceOrGraph, options = {}) {
  const parsed = typeof sourceOrGraph === "string" ? parseCl2(sourceOrGraph, { ...options, validate: false }) : { graph: sourceOrGraph, diagnostics: [] };
  const diagnostics = [...(parsed.diagnostics || [])];
  const graph = parsed.graph;
  if (!graph) return { ok: false, graph: null, diagnostics };
  for (const node of Object.values(graph.nodes || {})) {
    const classification = classifyActivityNode(node.type);
    if (classification.kind === "invalid") diagnostics.push({ code: classification.code, message: `${node.id}: invalid CL2 node pin combination`, line: 0, column: 0 });
    const definition = getActivityNodeDefinition(node.type);
    for (const [port, target] of Object.entries(node.next || {})) {
      const source = getActivityNodePort(node.type, "output", port);
      const targetNode = graph.nodes[target?.nodeId];
      const targetPort = targetNode && getActivityNodePort(targetNode.type, "input", target.port);
      if (!source || !targetPort || !arePortsCompatible(source, targetPort)) diagnostics.push({ code: "CL2_FLOW_PORT", message: `${node.id}.${port}: incompatible flow target`, line: 0, column: 0 });
    }
    for (const [port, raw] of Object.entries(node.inputs || {})) {
      if (!raw?.nodeId) continue;
      const sourceNode = graph.nodes[raw.nodeId];
      const sourcePort = sourceNode && getActivityNodePort(sourceNode.type, "output", raw.port || "value");
      const targetPort = getActivityNodePort(node.type, "input", port);
      if (!sourcePort || sourcePort.kind !== "value" || !targetPort || !arePortsCompatible(sourcePort, targetPort)) diagnostics.push({ code: "CL2_VALUE_PORT", message: `${node.id}.${port}: incompatible value source`, line: 0, column: 0 });
    }
    if (!definition) diagnostics.push({ code: "CL2_UNKNOWN_NODE", message: `${node.id}: unknown node type ${node.type}`, line: 0, column: 0 });
  }
  return { ok: diagnostics.length === 0, graph, diagnostics, document: parsed.document };
}

export default validateCl2;
