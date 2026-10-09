import { getActivityNodeDefinition } from "./ActivityNodeRegistry.js";

function json(value) { return JSON.stringify(value, null, 0); }
function isWire(value) { return value && typeof value === "object" && !Array.isArray(value) && value.nodeId; }
function positionSuffix(node) {
  const x = Number(node.x);
  const y = Number(node.y);
  if (!Number.isFinite(x) && !Number.isFinite(y)) return "";
  return ` /** @cl2.pos ${Number.isFinite(x) ? x : 0},${Number.isFinite(y) ? y : 0} */`;
}
function valueExpression(value, reusableIds) {
  if (isWire(value)) {
    const id = reusableIds.has(value.nodeId) ? value.nodeId : value.nodeId;
    return `${id}[]`;
  }
  if (value && typeof value === "object" && value.expression) return value.expression;
  return json(value);
}
function orderedInputs(node) {
  const ports = getActivityNodeDefinition(node.type)?.valueInputs || [];
  const names = ports.map((port) => port.name).filter((name) => Object.prototype.hasOwnProperty.call(node.inputs || {}, name));
  for (const name of Object.keys(node.inputs || {})) if (!names.includes(name)) names.push(name);
  return names.map((name) => node.inputs[name]);
}
function functionName(type) { return type === "activityEnd" ? "end" : type; }
function optionFor(type, port) {
  if (port === "flowOut" || port === "default") return "default";
  if (type === "branch" || type === "if") return port === "true" ? "option<1>" : "default";
  if (type === "framework:diceCheck") return { largeSuccess: "option<1>", success: "option<2>", failure: "option<3>", largeFailure: "default" }[port] || port;
  if (type === "check") return { largeSuccess: "option<1>", success: "option<2>", failure: "option<3>", largeFailure: "default" }[port] || port;
  if (type === "san" && /^segment\d+$/.test(port)) return `option<${Number(port.slice(7)) + 1}>`;
  if (type === "framework:randomBranch" && /^segment\d+$/.test(port)) return `option<${Number(port.slice(7)) + 1}>`;
  if (type === "choice" && /^option\d+$/.test(port)) return `option<${Number(port.slice(6)) + 1}>`;
  const match = String(port).match(/^flowOut(\d+)$/);
  return match ? `option<${Number(match[1]) + 1}>` : port.startsWith("option<") ? port : `option<${port}>`;
}

export function serializeCl2(graph, { activityId = null, includeHeader = true } = {}) {
  const nodes = graph?.nodes || {};
  const flowNodes = Object.values(nodes).filter((node) => {
    const definition = getActivityNodeDefinition(node.type);
    return Boolean(definition?.flowInputs?.length || definition?.flowOutputs?.length);
  });
  const valueNodes = Object.values(nodes).filter((node) => {
    const definition = getActivityNodeDefinition(node.type);
    return Boolean(definition?.valueOutputs?.length) && !definition?.flowInputs?.length && !definition?.flowOutputs?.length
      && node.cl2Class !== "valueReceiver";
  });
  const receiverNodes = Object.values(nodes).filter((node) => {
    const definition = getActivityNodeDefinition(node.type);
    const explicitReceiver = node.cl2Class === "valueReceiver";
    const implicitReceiver = Boolean(definition?.valueInputs?.length) && !definition?.valueOutputs?.length;
    return (explicitReceiver || implicitReceiver)
      && !definition?.flowInputs?.length && !definition?.flowOutputs?.length;
  });
  const reusableIds = new Set(valueNodes.map((node) => node.id));
  const lines = [];
  if (includeHeader) {
    lines.push(`/** CL2 activity${activityId ? ` ${activityId}` : ""} */`);
    lines.push("");
  }
  for (const node of valueNodes) {
    const args = orderedInputs(node).map((value) => valueExpression(value, reusableIds)).join(", ");
    lines.push(`reusablevalue ${node.id}: ${functionName(node.type)}[${args}];${positionSuffix(node)}`);
  }
  if (valueNodes.length) lines.push("");
  for (const node of receiverNodes) {
    const args = orderedInputs(node).map((value) => valueExpression(value, reusableIds)).join(", ");
    lines.push(`inputvalue ${node.id}: ${functionName(node.type)}[${args}];${positionSuffix(node)}`);
  }
  if (receiverNodes.length) lines.push("");
  const flowIds = flowNodes.map((node) => node.id);
  for (const node of flowNodes) {
    const args = orderedInputs(node).map((value) => valueExpression(value, reusableIds)).join(", ");
    let line = `${node.id}: ${functionName(node.type)}(${args})`;
    const edges = [];
    for (const [port, target] of Object.entries(node.next || {})) {
      if (!target?.nodeId) continue;
      const nextId = flowIds[flowIds.indexOf(node.id) + 1];
      if (target.implicit || (optionFor(node.type, port) === "default" && target.nodeId === nextId)) continue;
      edges.push(`    ${optionFor(node.type, port)} ${target.nodeId};`);
    }
    if (edges.length) line += ` {\n${edges.join("\n")}\n}`;
    line += ";";
    line += positionSuffix(node);
    lines.push(line, "");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export default serializeCl2;
