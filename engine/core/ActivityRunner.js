import { t } from "./i18n/index.js";
import { compileCl2Activity } from "./Cl2Compiler.js";
/**
 * ActivityRunner - manages lifecycle and host gateways for the compiler-
 * generated JavaScript executor of one Activity instance's CL2 Blueprint.
 * Node operations and pure value expressions are emitted by Cl2Compiler.
 *
 * There is no dedicated "loop" node type: a loop is just an ordinary flow
 * cycle - one of a `branch` node's outputs is wired back to a node earlier
 * in the same flow, and the branch's own condition (backed by a variable a
 * loop-body `setVariable` updates each pass) is what eventually breaks the
 * cycle. `MAX_STEPS` below is the only safety net against a cycle that
 * never breaks.
 *
 * Resume semantics: one-shot side-effecting nodes (`setVariable`,
 * `consumeTime`, `openWindow`) are tracked in `instance.executedNodeIds` and skipped if
 * revisited after a save/restore mid-flow, exactly like the equivalent
 * "already executed" guard in the legacy engine's ActivityRunner. Decision
 * nodes (`branch`, `blockUntil`) always re-evaluate so they pick up
 * variable changes correctly on resume.
 */
import { getActivityNodeDefinition } from "./ActivityNodeRegistry.js";

const ONE_SHOT_NODE_TYPES = new Set([
  "setVariable", "setGlobal", "setLocalVariable", "consumeTime", "insertSchedule", "openWindow", "closeWindow", "runActivity", "insertActivity", "emitEvent", "addWindowComponent", "removeWindowComponent", "getWindowLayout",
  "setLanguage", "createRecord", "updateRecord", "deleteRecord", "applyPublicVariableEffect", "markEventState", "playBgm", "stopBgm", "setBgmVolume", "pushBgmLayer", "restoreBgmLayer",
]);
const MAX_STEPS = 1000;

/**
 * Evaluate a pure value node for non-Activity consumers such as availability
 * checks. Activity execution compiles value graphs into JavaScript expressions
 * and does not call this recursive resolver.
 */
export function evaluateValueOutput(blueprint, nodeId, portName, variableStore, stack, pvGateway = null, dbGateway = null, runtimeGateway = null, instance = null) {
  const key = `${nodeId}:${portName}`;
  if (stack.has(key)) throw new Error(`Circular value dependency at ${key}`);
  const node = blueprint.nodes[nodeId];
  if (!node) throw new Error(`Unknown value node: ${nodeId}`);
  stack.add(key);
  const read = (name, fallback) => resolveInput(blueprint, node, name, variableStore, fallback, stack, pvGateway, dbGateway, runtimeGateway, instance);
  let result;
  switch (node.type) {
    case "valueReceiver":
      result = read("value");
      break;
    case "arithmetic":
      result = applyArithmetic(read("operator", "+"), read("left", 0), read("right", 0));
      break;
    case "conditionalValue":
      result = read("condition", false) ? read("whenTrue") : read("whenFalse");
      break;
    case "getVariable":
      result = variableStore.get(read("key"));
      break;
    case "getLocalVariable":
      result = variableStore.get(`__local:${read("key")}`);
      break;
    case "getProperty": {
      const target = read("value");
      result = target == null ? undefined : target[read("key")];
      break;
    }
    case "getStructureDefinition":
      if (!dbGateway?.getStructureDefinition) throw new Error(t("error.ed9feb0cd2b5"));
      result = dbGateway.getStructureDefinition(read("structureId"));
      break;
    case "getDatabaseDefinition":
      if (!dbGateway?.getDatabaseDefinition) throw new Error(t("error.e67bc821c260"));
      result = dbGateway.getDatabaseDefinition(read("databaseId"));
      break;
    case "findRecordsValue": {
      if (!dbGateway) throw new Error(t("error.fa59af2e3c80"));
      result = dbGateway.findRecords(read("databaseId"), read("query", {}));
      break;
    }
    case "getRecordValue": {
      if (!dbGateway?.getRecord) throw new Error(t("error.535cdca40f3a"));
      result = dbGateway.getRecord(read("databaseId"), read("key"));
      break;
    }
    case "getRuntimeCollection": {
      if (!runtimeGateway?.getCollection) throw new Error(t("error.81a602d97338"));
      result = runtimeGateway.getCollection(read("collectionId")) || [];
      break;
    }
    case "getRuntimeRecord": {
      if (!runtimeGateway?.getRecord) throw new Error(t("error.ad111936dc7e"));
      result = runtimeGateway.getRecord(read("collectionId"), read("recordId"));
      break;
    }
    case "mergeRecords": {
      const keyField = read("keyField", "id");
      const right = read("right", []);
      const rightByKey = new Map((Array.isArray(right) ? right : []).map((record) => [record?.[keyField], record]));
      const left = read("left", []);
      result = (Array.isArray(left) ? left : []).map((record) => ({ ...record, ...(rightByKey.get(record?.[keyField]) || {}) }));
      break;
    }
    case "arrayAppend": {
      const array = read("array");
      result = [...(Array.isArray(array) ? array : []), read("item")];
      break;
    }
    case "getParameter":
      { const index = Number(read("id")); result = Number.isInteger(index) && index >= 0 ? instance?.parameters?.[index] : undefined; }
      break;
    case "getGameTime":
      result = variableStore.get("__gameTime") ?? 0;
      break;
    case "getActivityInstanceCount":
      result = variableStore.get(`__activityCount:${read("activityId")}`) ?? 0;
      break;
    case "getScheduleInstanceCount":
      result = variableStore.get(`__scheduleCount:${read("scheduleId")}`) ?? 0;
      break;
    case "getQueueEntryCount":
      if (!runtimeGateway?.listEntries) throw new Error(t("error.a54f6a6d6d07"));
      result = runtimeGateway.listEntries(read("queueId"), { status: "unresolved" }).length;
      break;
    case "addWindowComponent":
      result = variableStore.get(`__nodeResult:${node.id}:componentId`) ?? null;
      break;
    case "getPublicVariable": {
      if (!pvGateway) throw new Error(t("error.df5e69e177f6"));
      result = pvGateway.get(read("id"));
      break;
    }
    case "getLanguage":
      if (!runtimeGateway?.getLanguage) throw new Error(t("error.a8ffd3686ba6"));
      result = runtimeGateway.getLanguage();
      break;
    case "publicVariableCondition": {
      if (!pvGateway) throw new Error(t("error.3a14abbd1474"));
      result = pvGateway.evaluateCondition({ id: read("id"), op: read("op", "eq"), value: read("value") });
      break;
    }
    default: {
      const customDefinition = getActivityNodeDefinition(node.type);
      const output = customDefinition?.custom
        ? (customDefinition.valueOutputs || []).find((port) => port.name === portName)
        : null;
      if (!customDefinition?.custom || !customDefinition.blueprint || !output?.source) {
        throw new Error(`Node ${node.type} does not produce a value output`);
      }
      const replaceParameters = (value) => {
        if (Array.isArray(value)) return value.map(replaceParameters);
        if (!value || typeof value !== "object") return value;
        if (Object.keys(value).length === 1 && typeof value.parameter === "string") {
          return resolveInput(blueprint, node, value.parameter, variableStore, undefined, stack, pvGateway, dbGateway, runtimeGateway, instance);
        }
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceParameters(child)]));
      };
      const nestedBlueprint = structuredClone(customDefinition.blueprint);
      for (const nestedNode of Object.values(nestedBlueprint.nodes || {})) {
        nestedNode.inputs = replaceParameters(nestedNode.inputs || {});
      }
      result = evaluateValueOutput(
        nestedBlueprint,
        output.source.nodeId,
        output.source.port || "value",
        variableStore,
        stack,
        pvGateway,
        dbGateway,
        runtimeGateway,
        instance,
      );
      break;
    }
  }
  stack.delete(key);
  return result;
}

function applyArithmetic(operator, left, right) {
  switch (operator) {
    case "+": return Number(left) + Number(right);
    case "-": return Number(left) - Number(right);
    case "*": return Number(left) * Number(right);
    case "/": if (Number(right) === 0) throw new Error(t("error.50a314209c54")); return Number(left) / Number(right);
    case "%": if (Number(right) === 0) throw new Error(t("error.50a314209c54")); return Number(left) % Number(right);
    case "and": return Boolean(left) && Boolean(right);
    case "or": return Boolean(left) || Boolean(right);
    case "xor": return Boolean(left) !== Boolean(right);
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
    case "=":
    case "eq": return left === right;
    case "not": return !Boolean(left);
    case "floor": return Math.floor(Number(left));
    // Generic entropy source: composed with value and flow operators,
    // this remains a host primitive rather than a domain-specific node.
    case "random": return Math.random();
    // Generic string concatenation (as opposed to "+"'s numeric coercion) -
    // e.g. building a display label or a lookup key from two variable-
    // sourced strings.
    case "concat": return String(left) + String(right);
    default: throw new Error(`Unknown arithmetic operator: ${operator}`);
  }
}

/**
 * Recursively resolves wire-refs (`{nodeId,port}`/`{variable}`) nested
 * anywhere inside a composite literal - e.g. `createRecord`'s `data` input
 * is itself a plain object whose *fields* are individually wired to value
 * nodes (a selected patient's id, a computed correctness bool, ...), not
 * the whole `data` input as one wire-ref. Without this, only a top-level
 * wire-ref would ever resolve and nested ones would pass through as inert
 * `{nodeId:...}` literals. Plain scalars/arrays/objects with no wire-refs
 * anywhere inside are returned unchanged (safe superset of the old
 * top-level-only behavior).
 */
function resolveDeep(blueprint, value, variableStore, stack, pvGateway, dbGateway, runtimeGateway, instance) {
  if (Array.isArray(value)) return value.map((item) => resolveDeep(blueprint, item, variableStore, stack, pvGateway, dbGateway, runtimeGateway, instance));
  if (value && typeof value === "object") {
    if ("nodeId" in value) return evaluateValueOutput(blueprint, value.nodeId, value.port || "value", variableStore, stack, pvGateway, dbGateway, runtimeGateway, instance);
    if ("variable" in value) return variableStore.get(value.variable);
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = resolveDeep(blueprint, child, variableStore, stack, pvGateway, dbGateway, runtimeGateway, instance);
    return out;
  }
  return value;
}

/**
 * Resolve one node's value input: a wired connection from another node's
 * value output takes precedence (evaluated lazily, following the node's
 * `inputs[name] = { nodeId, port }` upstream link - "数值只记录上家的链
 * 表"), then the legacy `{variable: name}` literal shorthand, then a plain
 * literal, then `fallback` - recursing into composite object/array
 * literals so any wire-refs nested inside them (e.g. `createRecord`'s
 * `data` fields) resolve too.
 */
export function resolveInput(blueprint, node, name, variableStore, fallback, stack = new Set(), pvGateway = null, dbGateway = null, runtimeGateway = null, instance = null) {
  const raw = node.inputs ? node.inputs[name] : undefined;
  if (raw === undefined) return fallback;
  return resolveDeep(blueprint, raw, variableStore, stack, pvGateway, dbGateway, runtimeGateway, instance);
}

export function createActivityRunner({
  definition,
  instance,
  variableStore,
  eventBus,
  timeGateway = () => {},
  windowGateway = () => {},
  activityGateway = () => {},
  eventGateway = () => {},
  dbGateway = null,
  pvGateway = null,
  runtimeGateway = null,
  eventStateGateway = null,
  onboardingGateway = eventStateGateway,
  apiGateway = null,
  onCheckpoint = () => {},
  onComplete = () => {},
} = {}) {
  const blueprint = definition.blueprint;
  /* DEV-TOOLS:START */
  const performanceSamples = globalThis.__cultistsPerformanceSamples;
  const compileStartedAt = Array.isArray(performanceSamples) ? globalThis.performance.now() : null;
  /* DEV-TOOLS:END */
  const compiledActivity = definition.compiled?.mode === "javascript" && definition.compiled.blueprint === blueprint
    ? definition.compiled
    : compileCl2Activity(blueprint, { maxSteps: MAX_STEPS });
  /* DEV-TOOLS:START */
  if (Array.isArray(performanceSamples) && Number.isFinite(compileStartedAt)) {
    performanceSamples.push({
      name: "activity-jit-compile",
      activityId: definition.id,
      durationMs: globalThis.performance.now() - compileStartedAt,
      flowNodeCount: compiledActivity.flowNodeIds.length,
      reusedCompilation: definition.compiled?.mode === "javascript" && definition.compiled.blueprint === blueprint,
    });
  }
  const nodeStartedAtById = Array.isArray(performanceSamples) ? new Map() : null;
  /* DEV-TOOLS:END */
  let cancelled = false;
  let paused = instance.status === "paused";
  let waitUnsubscribe = null;
  let waitGeneration = 0;
  let lastDialogueDisplayTo = null;
  const executionState = { lastDialogueDisplayTo: null };
  instance.executedNodeIds = Array.isArray(instance.executedNodeIds) ? instance.executedNodeIds : [];
  const executedNodeIdSet = new Set(instance.executedNodeIds);
  instance.executionTrace = Array.isArray(instance.executionTrace) ? instance.executionTrace : [];
  instance.executionStep = Math.max(
    Number.isInteger(instance.executionStep) && instance.executionStep >= 0 ? instance.executionStep : 0,
    instance.executionTrace.length,
  );
  instance.breakpointNodeIds = Array.isArray(instance.breakpointNodeIds)
    ? [...new Set(instance.breakpointNodeIds.map(String))].filter((nodeId) => compiledActivity.flowNodeIds.includes(nodeId))
    : [];
  let breakpointNodeIdSet = new Set(instance.breakpointNodeIds);
  instance.pausedAtBreakpointId = typeof instance.pausedAtBreakpointId === "string" ? instance.pausedAtBreakpointId : null;
  let lastTraceEntry = instance.executionTrace.at(-1) || null;
  const globalVariableStore = variableStore;
  const declaredLocals = blueprint.localVariables && typeof blueprint.localVariables === "object" ? blueprint.localVariables : {};
  if (!instance.localVariables || Object.keys(instance.localVariables).length === 0) {
    instance.localVariables = structuredClone(Object.fromEntries(Object.entries(declaredLocals).map(([key, value]) => [key, value?.defaultValue ?? value])));
  }
  const localValues = new Map(Object.entries(instance.localVariables || {}));
  variableStore = {
    get: (key) => String(key).startsWith("__local:") ? localValues.get(String(key).slice(8)) : globalVariableStore.get(key),
    set: (key, value) => {
      if (String(key).startsWith("__local:")) {
        localValues.set(String(key).slice(8), value);
        instance.localVariables = Object.fromEntries(localValues);
      } else globalVariableStore.set(key, value);
    },
    delta: (key, amount) => {
      const current = Number(variableStore.get(key)) || 0;
      variableStore.set(key, current + (Number(amount) || 0));
    },
  };

  function markExecuted(node) {
    if (executedNodeIdSet.has(node.id)) return;
    executedNodeIdSet.add(node.id);
    instance.executedNodeIds.push(node.id);
  }

  function recordExecutionStep(nodeId, status) {
    instance.executionStep += 1;
    const step = { step: instance.executionStep, nodeId, status };
    instance.executionTrace.push(step);
    lastTraceEntry = step;
    return step;
  }

  function finish(reason) {
    if (instance.status === "resolved") return;
    instance.status = "resolved";
    instance.resolutionReason = reason;
    instance.waitingNodeId = null;
    if (lastTraceEntry && ["running", "waiting", "breakpoint"].includes(lastTraceEntry.status)) lastTraceEntry.status = reason;
    instance.pausedAtBreakpointId = null;
    if (instance.currentStep) instance.currentStep = { ...instance.currentStep, status: reason };
    if (executionState.lastDialogueDisplayTo) {
      eventGateway("display:complete", {
        instanceId: instance.instanceId,
        displayTo: executionState.lastDialogueDisplayTo,
        reason,
      }, instance);
    }
    onCheckpoint(instance);
    onComplete(instance, reason);
  }

  function subscribeWait(node) {
    if (waitUnsubscribe) return;
    const generation = ++waitGeneration;
    const dependencies = compiledActivity.waitDependencies?.[node.id] || { wildcard: true };
    const wakeEvents = [];
    if (dependencies.wildcard || dependencies.variableKeys?.length || dependencies.publicVariableIds?.length) {
      wakeEvents.push("variable:changed");
    }
    if (dependencies.wildcard || dependencies.gameClock || dependencies.publicVariableIds?.length) {
      wakeEvents.push("gameClock:changed");
    }
    const unsubscribers = wakeEvents.map((eventName) => {
      const wakeHandler = () => {
        if (generation !== waitGeneration || cancelled || paused || instance.status === "resolved") return;
        const unsubscribe = waitUnsubscribe;
        if (!unsubscribe) return;
        waitUnsubscribe = null;
        waitGeneration += 1;
        unsubscribe();
        run(node.id);
      };
      const onEvent = eventName === "variable:changed"
        ? (change) => dependencies.wildcard
          || dependencies.variableKeys?.includes(change?.key)
          || dependencies.publicVariableIds?.includes(Number(change?.id))
          || (change && typeof change === "object" && Object.keys(change).some((key) => dependencies.publicVariableIds?.includes(Number(key))))
        : () => true;
      const filteredWakeHandler = (payload) => {
        if (!onEvent(payload)) return;
        wakeHandler();
      };
      /* DEV-TOOLS:START */
      filteredWakeHandler.__cultistsPerformanceLabel = `wait:${definition.id}:${node.id}`;
      /* DEV-TOOLS:END */
      return eventBus.on(eventName, filteredWakeHandler);
    });
    waitUnsubscribe = () => {
      if (waitGeneration === generation) waitGeneration += 1;
      unsubscribers.forEach((fn) => fn());
    };
  }

  function enterNode(current, nodeType, isResumeEntry, skipBreakpointNodeId) {
    const node = blueprint.nodes[current];
    if (!node) throw new Error(`Unknown flow node: ${current}`);
    instance.currentNodeId = current;
    if (breakpointNodeIdSet.has(current) && !(isResumeEntry && current === skipBreakpointNodeId)) {
      const step = recordExecutionStep(current, "breakpoint");
      paused = true;
      instance.status = "paused";
      instance.pausedAtBreakpointId = current;
      instance.currentStep = { nodeId: current, type: nodeType, status: "breakpoint", step: step.step };
      onCheckpoint(instance);
      return 2;
    }
    // Only the resumed entry node is eligible for the save/restore skip.
    if (isResumeEntry && ONE_SHOT_NODE_TYPES.has(nodeType) && executedNodeIdSet.has(current)) {
      const step = recordExecutionStep(current, "skipped");
      instance.currentStep = { nodeId: current, type: nodeType, status: "skipped", step: step.step };
      return 1;
    }
    const step = recordExecutionStep(current, "running");
    instance.currentStep = { nodeId: current, type: nodeType, status: "running", step: step.step };
    /* DEV-TOOLS:START */
    if (nodeStartedAtById) nodeStartedAtById.set(current, globalThis.performance.now());
    /* DEV-TOOLS:END */
    return 0;
  }

  function replaceMacroParameters(value, parameters) {
    if (Array.isArray(value)) return value.map((item) => replaceMacroParameters(item, parameters));
    if (!value || typeof value !== "object") return value;
    if (Object.keys(value).length === 1 && typeof value.parameter === "string") {
      return structuredClone(parameters[value.parameter]);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceMacroParameters(child, parameters)]));
  }

  function runMacro(compiledMacro, nodeId, macroNode, parameters) {
    if (!compiledMacro?.blueprint) throw new Error(`Unhandled custom blueprint node: ${macroNode.type}`);
    const macroBlueprint = compiledMacro.blueprint;
    const nodeOverrides = structuredClone(macroBlueprint.nodes);
    for (const node of Object.values(nodeOverrides)) node.inputs = replaceMacroParameters(node.inputs || {}, parameters);
    const childInstance = {
      instanceId: `${instance.instanceId}:custom:${nodeId}`,
      status: "pending",
      currentNodeId: macroBlueprint.startNodeId,
      executedNodeIds: [],
      waitingNodeId: null,
    };
    const childRunner = createActivityRunner({
      definition: { id: macroNode.type, blueprint: macroBlueprint, compiled: compiledMacro },
      instance: childInstance,
      variableStore,
      eventBus,
      timeGateway,
      windowGateway,
      activityGateway,
      eventGateway,
      dbGateway,
      pvGateway,
      runtimeGateway,
      eventStateGateway,
      apiGateway,
      onCheckpoint: () => {},
      onComplete: () => {},
    });
    childRunner.start(parameters, nodeOverrides);
    if (childInstance.status !== "resolved") {
      throw new Error(`Custom blueprint node ${macroNode.type} entered a waiting state; reusable nodes must complete synchronously`);
    }
    return { returnPort: childInstance.returnPort };
  }

  function run(nodeId, skipBreakpointNodeId = null, macroParams = {}, nodeOverrides = null) {
    if (cancelled || paused || instance.status === "resolved") return;
    /* DEV-TOOLS:START */
    const flowStartedAt = Array.isArray(performanceSamples) ? globalThis.performance.now() : null;
    /* DEV-TOOLS:END */
    const result = compiledActivity.run(nodeId, {
      enterNode,
      onWait(current) {
        const node = blueprint.nodes[current];
        if (lastTraceEntry?.nodeId === current) lastTraceEntry.status = "waiting";
        instance.waitingNodeId = node.id;
        instance.currentStep = { nodeId: node.id, type: node.type, status: "waiting", step: lastTraceEntry?.step };
        subscribeWait(node);
        onCheckpoint(instance);
      },
      afterStep(current, next) {
        const node = blueprint.nodes[current];
        /* DEV-TOOLS:START */
        const nodeStartedAt = nodeStartedAtById?.get(current);
        const checkpointStartedAt = Array.isArray(performanceSamples) ? globalThis.performance.now() : null;
        /* DEV-TOOLS:END */
        markExecuted(node);
        if (lastTraceEntry?.nodeId === current) lastTraceEntry.status = "executed";
        instance.waitingNodeId = null;
        instance.currentNodeId = next;
        instance.currentStep = next
          ? { nodeId: next, type: blueprint.nodes[next]?.type || null, status: "pending", step: instance.executionStep + 1 }
          : null;
        onCheckpoint(instance, { notify: false });
        /* DEV-TOOLS:START */
        if (Array.isArray(performanceSamples) && Number.isFinite(nodeStartedAt) && Number.isFinite(checkpointStartedAt)) {
          const finishedAt = globalThis.performance.now();
          performanceSamples.push({
            name: "activity-node",
            activityId: definition.id,
            nodeId: current,
            nodeType: node.type,
            durationMs: finishedAt - nodeStartedAt,
            checkpointMs: finishedAt - checkpointStartedAt,
          });
          nodeStartedAtById.delete(current);
        }
        /* DEV-TOOLS:END */
      },
      finish,
      runMacro,
      applyArithmetic,
      errorMessage: t,
      debugLog(kind, nodeId, payload) {
        /* DEV-TOOLS:START */
        console.log(`[NG dialogue] ActivityRunner ${kind} node`, { activityId: definition.id, nodeId, payload });
        /* DEV-TOOLS:END */
      },
      instance,
      variableStore,
      timeGateway,
      windowGateway,
      activityGateway,
      eventGateway,
      dbGateway,
      pvGateway,
      runtimeGateway,
      eventStateGateway,
      onboardingGateway,
      apiGateway,
      executionState,
    }, macroParams, skipBreakpointNodeId, nodeOverrides);
    /* DEV-TOOLS:START */
    if (Array.isArray(performanceSamples) && Number.isFinite(flowStartedAt)) {
      performanceSamples.push({
        name: "activity-generated-run",
        activityId: definition.id,
        durationMs: globalThis.performance.now() - flowStartedAt,
        steps: result.steps,
        status: result.status,
      });
    }
    /* DEV-TOOLS:END */
    if (result.status === "limit") throw new Error(t("error.eba2b6ab7973"));
    if (result.status === "completed") finish("completed");
  }

  function start(macroParams = {}, nodeOverrides = null) {
    run(instance.currentNodeId || blueprint.startNodeId, null, macroParams, nodeOverrides);
  }

  function pause() {
    if (instance.status === "resolved") return false;
    paused = true;
    instance.status = "paused";
    if (instance.currentStep) instance.currentStep = { ...instance.currentStep, status: "paused" };
    onCheckpoint(instance);
    return true;
  }

  function resume() {
    if (!paused) return false;
    const breakpointNodeId = instance.pausedAtBreakpointId;
    instance.pausedAtBreakpointId = null;
    paused = false;
    instance.status = "unresolved";
    onCheckpoint(instance);
    run(instance.currentNodeId, breakpointNodeId);
    return true;
  }

  function cancel() {
    if (cancelled || instance.status === "resolved") return false;
    cancelled = true;
    if (waitUnsubscribe) {
      const unsubscribe = waitUnsubscribe;
      waitUnsubscribe = null;
      unsubscribe();
    }
    finish("cancelled");
    return true;
  }

  function setLocalVariable(key, value) {
    const normalized = String(key);
    localValues.set(normalized, structuredClone(value));
    instance.localVariables = Object.fromEntries(localValues);
    onCheckpoint(instance);
    return true;
  }

  function setCurrentNode(nodeId) {
    if (instance.status === "resolved") return false;
    if (!compiledActivity.flowNodeIds.includes(nodeId)) return false;
    if (waitUnsubscribe) {
      const unsubscribe = waitUnsubscribe;
      waitUnsubscribe = null;
      unsubscribe();
    }
    paused = true;
    instance.status = "paused";
    if (["waiting", "breakpoint"].includes(lastTraceEntry?.status)) lastTraceEntry.status = "debug-seek";
    instance.waitingNodeId = null;
    instance.pausedAtBreakpointId = null;
    instance.currentNodeId = nodeId;
    instance.currentStep = { nodeId, type: blueprint.nodes[nodeId].type, status: "pending" };
    onCheckpoint(instance);
    return true;
  }

  function setStatus(status) {
    if (!["unresolved", "paused", "failed", "resolved"].includes(status)) return false;
    if (status === "paused") { paused = true; instance.status = "paused"; }
    else if (status === "unresolved" && paused) return resume();
    else if (status === "unresolved") { paused = false; instance.status = "unresolved"; }
    else instance.status = status;
    onCheckpoint(instance);
    return true;
  }

  function setBreakpoints(nodeIds) {
    if (!Array.isArray(nodeIds)) return false;
    const normalized = [...new Set(nodeIds.map(String))];
    if (normalized.some((nodeId) => !compiledActivity.flowNodeIds.includes(nodeId))) return false;
    instance.breakpointNodeIds = normalized;
    breakpointNodeIdSet = new Set(normalized);
    onCheckpoint(instance);
    return true;
  }

  function getDebugState() {
    return {
      activityId: definition.id || null,
      instanceId: instance.instanceId,
      status: instance.status,
      currentNodeId: instance.currentNodeId || null,
      currentStep: instance.currentStep ? { ...instance.currentStep } : null,
      waitingNodeId: instance.waitingNodeId || null,
      executedNodeIds: [...instance.executedNodeIds],
      executionStep: instance.executionStep,
      executionTrace: structuredClone(instance.executionTrace),
      breakpointNodeIds: [...instance.breakpointNodeIds],
      pausedAtBreakpointId: instance.pausedAtBreakpointId,
      localVariables: structuredClone(instance.localVariables || {}),
      compiled: compiledActivity.debugInfo,
    };
  }

  return { start, pause, resume, cancel, setLocalVariable, setCurrentNode, setStatus, setBreakpoints, getDebugState, instance };
}

export default createActivityRunner;
