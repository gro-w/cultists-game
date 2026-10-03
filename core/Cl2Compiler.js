import { getActivityNodeDefinition } from "./ActivityNodeRegistry.js";

const DEFAULT_MAX_STEPS = 1000;

/**
 * Compile a validated Activity flow graph into a JavaScript dispatcher.
 * Only node IDs—encoded as JavaScript string literals—are generated from the
 * blueprint. CL2 values and authored text remain data consumed by the runtime.
 */
export function compileCl2Activity(blueprint, { maxSteps = DEFAULT_MAX_STEPS } = {}) {
  if (!blueprint || !blueprint.nodes || typeof blueprint.nodes !== "object") {
    throw new TypeError("Cannot compile CL2 Activity without a node map");
  }
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError("CL2 compiler maxSteps must be a positive integer");
  }

  const flowNodeIds = Object.keys(blueprint.nodes).filter((nodeId) => {
    const node = blueprint.nodes[nodeId];
    const definition = getActivityNodeDefinition(node?.type);
    return Boolean(definition?.flowInputs?.length || definition?.flowOutputs?.length);
  });
  if (!flowNodeIds.length || !flowNodeIds.includes(blueprint.startNodeId)) {
    throw new Error("Cannot compile CL2 Activity without a flow start node");
  }

  const caseLines = flowNodeIds.map((nodeId) =>
    `case ${JSON.stringify(nodeId)}: result = hooks.executeNode(${JSON.stringify(nodeId)}, nodes[${JSON.stringify(nodeId)}], isResumeEntry); break;`,
  );
  const cases = caseLines.join("\n");
  const source = `
    return function runCompiledActivity(startNodeId, hooks) {
      let current = startNodeId;
      let steps = 0;
      let isResumeEntry = true;
      while (current && steps++ < maxSteps) {
        let result;
        switch (current) {
          ${cases}
          default: throw new Error("Unknown flow node: " + current);
        }
        if (result && result.skip) {
          current = result.next == null ? null : result.next;
          isResumeEntry = false;
          continue;
        }
        if (result && result.wait) {
          hooks.onWait(current, nodes[current]);
          return { status: "waiting", nodeId: current, steps };
        }
        if (result && result.stop) return { status: "stopped", nodeId: current, steps };
        const next = result && result.next != null ? result.next : null;
        hooks.afterStep(current, nodes[current], next);
        current = next;
        isResumeEntry = false;
      }
      return { status: current ? "limit" : "completed", nodeId: current, steps };
    };
  `;

  // The generated source contains no executable CL2 expressions: node IDs are
  // safely quoted constants, and all effects stay behind the runner gateway.
  let run;
  try {
    run = new Function("nodes", "maxSteps", source)(blueprint.nodes, maxSteps);
  } catch (cause) {
    throw new Error("CL2 JavaScript compilation is blocked by the host environment", { cause });
  }
  const sourceMap = Object.fromEntries(flowNodeIds.map((nodeId, index) => {
    const sourceOffset = source.indexOf(caseLines[index]);
    const sourceLine = source.slice(0, sourceOffset).split("\n").length;
    const node = blueprint.nodes[nodeId];
    return [nodeId, {
      nodeId,
      type: node.type,
      sourceLine,
      inputPorts: Object.keys(node.inputs || {}),
      flowTargets: Object.fromEntries(Object.entries(node.next || {}).map(([port, target]) => [port, target?.nodeId || null])),
    }];
  }));
  const debugInfo = Object.freeze({
    nodeIds: Object.freeze([...flowNodeIds]),
    sourceMap: Object.freeze(sourceMap),
    source,
  });
  return Object.freeze({
    mode: "javascript",
    blueprint,
    flowNodeIds: Object.freeze(flowNodeIds),
    source,
    debugInfo,
    run,
  });
}

export default compileCl2Activity;
