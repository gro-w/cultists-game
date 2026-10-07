import { getActivityNodeDefinition } from "./ActivityNodeRegistry.js";
import { createCl2CodeGenerator } from "./Cl2CodeGenerator.js";

const DEFAULT_MAX_STEPS = 1000;

function jsLiteral(value) {
  return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function countNewlines(value) {
  let count = 0;
  for (let index = value.indexOf("\n"); index !== -1; index = value.indexOf("\n", index + 1)) count += 1;
  return count;
}

function collectWaitDependencies(blueprint) {
  const dependenciesByNode = {};
  for (const [waitNodeId, waitNode] of Object.entries(blueprint.nodes)) {
    if (waitNode?.type !== "blockUntil") continue;
    const dependencies = { wildcard: false, variableKeys: new Set(), publicVariableIds: new Set(), gameClock: false };
    const visitedNodes = new Set();
    const visit = (value) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      if (Object.prototype.hasOwnProperty.call(value, "variable")) {
        dependencies.variableKeys.add(value.variable);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(value, "nodeId")) {
        const dependencyNode = blueprint.nodes[value.nodeId];
        if (!dependencyNode) {
          dependencies.wildcard = true;
          return;
        }
        if (visitedNodes.has(dependencyNode.id)) return;
        visitedNodes.add(dependencyNode.id);
        const inputs = dependencyNode.inputs || {};
        if (dependencyNode.type === "publicVariableCondition" || dependencyNode.type === "getPublicVariable") {
          const idInput = inputs.id;
          if (Number.isInteger(idInput) && idInput >= 0) dependencies.publicVariableIds.add(idInput);
          else dependencies.wildcard = true;
          if (dependencyNode.type === "publicVariableCondition") dependencies.gameClock = true;
        } else if (dependencyNode.type === "getVariable") {
          if (Object.prototype.hasOwnProperty.call(inputs, "key") && (typeof inputs.key !== "object" || inputs.key === null)) {
            dependencies.variableKeys.add(inputs.key);
          } else dependencies.wildcard = true;
        } else if (dependencyNode.type === "getGameTime") {
          dependencies.gameClock = true;
          dependencies.variableKeys.add("__gameTime");
        } else if (dependencyNode.type === "getActivityInstanceCount" || dependencyNode.type === "getScheduleInstanceCount") {
          const inputName = dependencyNode.type === "getActivityInstanceCount" ? "activityId" : "scheduleId";
          const countId = inputs[inputName];
          if (typeof countId === "string" || typeof countId === "number") {
            const prefix = dependencyNode.type === "getActivityInstanceCount" ? "__activityCount:" : "__scheduleCount:";
            dependencies.variableKeys.add(`${prefix}${countId}`);
          } else dependencies.wildcard = true;
        } else if (!["valueReceiver", "arithmetic", "conditionalValue", "getProperty", "getParameter"].includes(dependencyNode.type)) {
          // Unknown, gateway-backed, local, or custom values may change through
          // runtime events that cannot be safely narrowed at compile time.
          dependencies.wildcard = true;
        }
        Object.values(inputs).forEach(visit);
        return;
      }
      Object.values(value).forEach(visit);
    };

    if (Object.prototype.hasOwnProperty.call(waitNode.inputs || {}, "condition")) {
      visit(waitNode.inputs.condition);
    } else {
      const key = waitNode.inputs?.key;
      if (key !== undefined && (typeof key !== "object" || key === null)) dependencies.variableKeys.add(key);
      else visit(key);
      visit(waitNode.inputs?.equals);
    }
    dependenciesByNode[waitNodeId] = Object.freeze({
      wildcard: dependencies.wildcard,
      variableKeys: Object.freeze([...dependencies.variableKeys]),
      publicVariableIds: Object.freeze([...dependencies.publicVariableIds]),
      gameClock: dependencies.gameClock,
    });
  }
  return Object.freeze(dependenciesByNode);
}

function compileInternal(blueprint, { maxSteps, macroStack = new Set(), macroParameters = null }) {
  if (!blueprint || !blueprint.nodes || typeof blueprint.nodes !== "object") {
    throw new TypeError("Cannot compile CL2 Activity without a node map");
  }

  const flowNodeIds = Object.keys(blueprint.nodes).filter((nodeId) => {
    const node = blueprint.nodes[nodeId];
    const definition = getActivityNodeDefinition(node?.type);
    return Boolean(definition?.flowInputs?.length || definition?.flowOutputs?.length);
  });
  if (!flowNodeIds.length || !flowNodeIds.includes(blueprint.startNodeId)) {
    throw new Error("Cannot compile CL2 Activity without a flow start node");
  }

  const nodeIndexById = new Map(flowNodeIds.map((nodeId, index) => [nodeId, index]));
  const macroIndexByNodeId = new Map();
  const macroDefinitionsByNodeId = new Map();
  const macroExecutors = [];
  const macroIndicesByType = new Map();

  for (const nodeId of flowNodeIds) {
    const node = blueprint.nodes[nodeId];
    const definition = getActivityNodeDefinition(node.type);
    if (!definition?.custom || !definition.blueprint) continue;
    if (macroStack.has(node.type)) throw new Error(`Recursive custom blueprint macro: ${node.type}`);
    let macroIndex = macroIndicesByType.get(node.type);
    if (macroIndex === undefined) {
      const nestedStack = new Set(macroStack);
      nestedStack.add(node.type);
      const nested = compileInternal(definition.blueprint, {
        maxSteps,
        macroStack: nestedStack,
        macroParameters: (definition.valueInputs || []).map((parameter) => parameter.name),
      });
      macroIndex = macroExecutors.length;
      macroExecutors.push(nested);
      macroIndicesByType.set(node.type, macroIndex);
    }
    macroIndexByNodeId.set(nodeId, macroIndex);
    macroDefinitionsByNodeId.set(nodeId, definition);
  }

  const optimizationCounts = { constantFolds: 0, constantBranches: 0 };
  const codegen = createCl2CodeGenerator({
    blueprint,
    nodeIndexById,
    macroIndexByNodeId,
    macroDefinitionsByNodeId,
    optimizationCounts,
    valueParameterExpressions: macroParameters
      ? new Map(macroParameters.map((name) => [name, null]))
      : null,
  });
  const caseLines = flowNodeIds.map((nodeId, index) => {
    const node = blueprint.nodes[nodeId];
    const skipTargetId = node.next?.flowOut?.nodeId ?? null;
    const skipTargetIndex = skipTargetId == null ? -1 : nodeIndexById.get(skipTargetId);
    if (skipTargetId != null && skipTargetIndex === undefined) throw new Error(`Node ${nodeId} flows to unknown node: ${skipTargetId}`);
    const operation = codegen.emitFlowOperation(node);
    return `case ${index}: {\n      const node = executionNodes[${jsLiteral(nodeId)}];\n      const gate = hooks.enterNode(${jsLiteral(nodeId)}, ${jsLiteral(node.type)}, isResumeEntry, skipBreakpointNodeId);\n      if (gate === 2) return { status: "stopped", nodeId: ${jsLiteral(nodeId)}, steps };\n      if (gate === 1) { pc = ${skipTargetIndex}; isResumeEntry = false; continue; }\n      ${operation}\n    }`;
  });
  const sourcePrefix = `return function runCompiledActivity(startNodeId, hooks, macroParams = {}, skipBreakpointNodeId = null, nodeOverrides = null) {
  const executionNodes = nodeOverrides || nodes;
  const variableStore = hooks.variableStore;
  const instance = hooks.instance;
  const timeGateway = hooks.timeGateway;
  const windowGateway = hooks.windowGateway;
  const activityGateway = hooks.activityGateway;
  const eventGateway = hooks.eventGateway;
  const dbGateway = hooks.dbGateway;
  const pvGateway = hooks.pvGateway;
  const runtimeGateway = hooks.runtimeGateway;
  const eventStateGateway = hooks.eventStateGateway;
  const onboardingGateway = hooks.onboardingGateway;
  const apiGateway = hooks.apiGateway;
  const executionState = hooks.executionState || (hooks.executionState = { lastDialogueDisplayTo: null });
  let pc = startNodeId == null ? -1 : nodeIndex.get(startNodeId);
  if (pc === undefined) throw new Error("Unknown flow node: " + startNodeId);
  let steps = 0;
  let isResumeEntry = true;
  while (pc >= 0 && steps++ < maxSteps) {
    switch (pc) {
      `;
  const caseSeparator = "\n      ";
  const sourceSuffix = `
      default: throw new Error("Unknown flow node index: " + pc);
    }
  }
  return { status: pc >= 0 ? "limit" : "completed", nodeId: pc >= 0 ? nodeIds[pc] : null, steps };
};`;
  const source = sourcePrefix + caseLines.join(caseSeparator) + sourceSuffix;
  const sourceLines = new Map();
  let sourceLine = countNewlines(sourcePrefix) + 1;
  flowNodeIds.forEach((nodeId, index) => {
    sourceLines.set(nodeId, sourceLine);
    sourceLine += countNewlines(caseLines[index]);
    if (index < caseLines.length - 1) sourceLine += countNewlines(caseSeparator);
  });

  let run;
  try {
    run = new Function("nodes", "blueprint", "maxSteps", "nodeIds", "nodeIndex", "macroExecutors", source)(
      blueprint.nodes,
      blueprint,
      maxSteps,
      flowNodeIds,
      nodeIndexById,
      macroExecutors,
    );
  } catch (cause) {
    throw new Error("CL2 JavaScript compilation is blocked by the host environment", { cause });
  }
  const sourceMap = Object.fromEntries(flowNodeIds.map((nodeId, index) => {
    const node = blueprint.nodes[nodeId];
    return [nodeId, {
      nodeId,
      type: node.type,
      sourceLine: sourceLines.get(nodeId),
      inputPorts: Object.keys(node.inputs || {}),
      flowTargets: Object.fromEntries(Object.entries(node.next || {}).map(([port, target]) => [port, target?.nodeId || null])),
    }];
  }));
  const debugInfo = Object.freeze({
    nodeIds: Object.freeze([...flowNodeIds]),
    sourceMap: Object.freeze(sourceMap),
    source,
    optimizations: Object.freeze({ ...optimizationCounts }),
  });
  const waitDependencies = collectWaitDependencies(blueprint);
  return Object.freeze({
    mode: "javascript",
    blueprint,
    flowNodeIds: Object.freeze(flowNodeIds),
    source,
    debugInfo,
    waitDependencies,
    run,
  });
}

/**
 * Compile the validated CL2 blueprint into node-specialized JavaScript.
 * Flow targets, node operations, and pure value expressions are emitted from
 * the graph at compile time; runtime dispatch never calls an executeNode
 * interpreter or resolves a node type dynamically.
 */
export function compileCl2Activity(blueprint, { maxSteps = DEFAULT_MAX_STEPS } = {}) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError("CL2 compiler maxSteps must be a positive integer");
  }
  return compileInternal(blueprint, { maxSteps });
}

export default compileCl2Activity;
