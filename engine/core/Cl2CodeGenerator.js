import { getActivityNodeDefinition } from "./ActivityNodeRegistry.js";

const UNKNOWN = Symbol("unknown compile-time value");
const DIVISION_BY_ZERO_ERROR = "error.50a314209c54";

function literal(value) {
  if (value === undefined) return "void 0";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    if (Object.is(value, -0)) return "-0";
  }
  const json = JSON.stringify(value);
  if (json === undefined) return "void 0";
  const safeJson = json.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  if (value && typeof value === "object") {
    const encoded = JSON.stringify(json).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return `JSON.parse(${encoded})`;
  }
  return safeJson;
}

function constant(code, value) {
  return { code, constant: true, value };
}

function dynamic(code) {
  return { code, constant: false, value: UNKNOWN };
}

function cloneConstant(value) {
  if (Array.isArray(value)) return value.map(cloneConstant);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneConstant(child)]));
  return value;
}

function foldArithmetic(operator, left, right) {
  switch (operator) {
    case "+": return Number(left) + Number(right);
    case "-": return Number(left) - Number(right);
    case "*": return Number(left) * Number(right);
    case "/": return Number(right) === 0 ? UNKNOWN : Number(left) / Number(right);
    case "%": return Number(right) === 0 ? UNKNOWN : Number(left) % Number(right);
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
    case "concat": return String(left) + String(right);
    default: return UNKNOWN;
  }
}

function inlineArithmetic(operator, leftCode, rightCode) {
  if (["+", "-", "*", ">", ">=", "<", "<=", "=", "eq", "concat"].includes(operator)) {
    if (operator === "concat") return `(String(${leftCode}) + String(${rightCode}))`;
    const jsOperator = operator === "=" || operator === "eq" ? "===" : operator;
    const numeric = ["+", "-", "*"].includes(operator);
    return `(${numeric ? `Number(${leftCode}) ${jsOperator} Number(${rightCode})` : `${leftCode} ${jsOperator} ${rightCode}`})`;
  }

  // Preserve the old evaluator's eager left/right evaluation even for unary,
  // boolean, random, and division operators.
  const body = (() => {
    switch (operator) {
      case "/": return `if (Number(b) === 0) throw new Error(hooks.errorMessage(${literal(DIVISION_BY_ZERO_ERROR)})); return Number(a) / Number(b);`;
      case "%": return `if (Number(b) === 0) throw new Error(hooks.errorMessage(${literal(DIVISION_BY_ZERO_ERROR)})); return Number(a) % Number(b);`;
      case "and": return "return Boolean(a) && Boolean(b);";
      case "or": return "return Boolean(a) || Boolean(b);";
      case "xor": return "return Boolean(a) !== Boolean(b);";
      case "not": return "return !Boolean(a);";
      case "floor": return "return Math.floor(Number(a));";
      case "random": return "return Math.random();";
      default: return null;
    }
  })();
  return body
    ? `(() => { const a = (${leftCode}); const b = (${rightCode}); ${body} })()`
    : dynamicArithmetic(literal(operator), leftCode, rightCode);
}

function dynamicArithmetic(operatorCode, leftCode, rightCode) {
  return `(() => { const operator = (${operatorCode}); const a = (${leftCode}); const b = (${rightCode}); switch (operator) { case "+": return Number(a) + Number(b); case "-": return Number(a) - Number(b); case "*": return Number(a) * Number(b); case "/": if (Number(b) === 0) throw new Error(hooks.errorMessage(${literal(DIVISION_BY_ZERO_ERROR)})); return Number(a) / Number(b); case "%": if (Number(b) === 0) throw new Error(hooks.errorMessage(${literal(DIVISION_BY_ZERO_ERROR)})); return Number(a) % Number(b); case "and": return Boolean(a) && Boolean(b); case "or": return Boolean(a) || Boolean(b); case "xor": return Boolean(a) !== Boolean(b); case ">": return a > b; case ">=": return a >= b; case "<": return a < b; case "<=": return a <= b; case "=": case "eq": return a === b; case "not": return !Boolean(a); case "floor": return Math.floor(Number(a)); case "random": return Math.random(); case "concat": return String(a) + String(b); default: throw new Error("Unknown arithmetic operator: " + operator); } })()`;
}

export function createCl2CodeGenerator({
  blueprint,
  nodeIndexById,
  macroIndexByNodeId = new Map(),
  macroDefinitionsByNodeId = new Map(),
  optimizationCounts = { constantFolds: 0, constantBranches: 0 },
  valueParameterExpressions = null,
} = {}) {
  function emitRaw(value, stack = new Set(), macroParams = valueParameterExpressions) {
    if (Array.isArray(value)) {
      const entries = value.map((item) => emitRaw(item, stack, macroParams));
      if (entries.every((entry) => entry.constant)) return constant(literal(entries.map((entry) => entry.value)), entries.map((entry) => cloneConstant(entry.value)));
      return dynamic(`[${entries.map((entry) => entry.code).join(", ")}]`);
    }
    if (!value || typeof value !== "object") return constant(literal(value), value);

    if ("nodeId" in value) return emitValueOutput(value.nodeId, value.port || "value", stack, macroParams);
    if ("variable" in value) return dynamic(`variableStore.get(${literal(value.variable)})`);
    if (Object.keys(value).length === 1 && typeof value.parameter === "string" && macroParams) {
      const parameter = macroParams.get(value.parameter);
      if (parameter) return parameter;
      return dynamic(`macroParams[${literal(value.parameter)}]`);
    }

    const entries = Object.entries(value).map(([key, child]) => [key, emitRaw(child, stack, macroParams)]);
    if (entries.every(([, entry]) => entry.constant)) {
      const result = Object.fromEntries(entries.map(([key, entry]) => [key, cloneConstant(entry.value)]));
      return constant(literal(result), result);
    }
    // Computed keys keep "__proto__" as ordinary data rather than changing
    // the generated object's prototype.
    return dynamic(`({${entries.map(([key, entry]) => `[${literal(key)}]: (${entry.code})`).join(", ")}})`);
  }

  function emitInput(node, name, fallback, stack = new Set(), macroParams = valueParameterExpressions) {
    const raw = node.inputs?.[name];
    if (raw === undefined) return constant(literal(fallback), fallback);
    return emitRaw(raw, stack, macroParams);
  }

  function emitValueOutput(nodeId, portName = "value", stack = new Set(), macroParams = valueParameterExpressions) {
    const key = `${nodeId}:${portName}`;
    if (stack.has(key)) throw new Error(`Circular value dependency at ${key}`);
    const node = blueprint.nodes[nodeId];
    if (!node) throw new Error(`Unknown value node: ${nodeId}`);
    const nextStack = new Set(stack);
    nextStack.add(key);
    const read = (name, fallback) => emitInput(node, name, fallback, nextStack, macroParams);
    const input = (name, fallback) => read(name, fallback).code;
    const requireGateway = (gatewayName, method, errorKey, expression) => dynamic(`(() => { if (!${gatewayName}?.${method}) throw new Error(hooks.errorMessage(${literal(errorKey)})); return ${expression}; })()`);

    switch (node.type) {
      case "valueReceiver":
        return read("value");
      case "arithmetic": {
        const operator = read("operator", "+");
        const left = read("left", 0);
        const right = read("right", 0);
        if (operator.constant && left.constant && right.constant) {
          const value = foldArithmetic(operator.value, left.value, right.value);
          if (value !== UNKNOWN) {
            optimizationCounts.constantFolds += 1;
            return constant(literal(value), value);
          }
        }
        if (operator.constant && typeof operator.value === "string") {
          return dynamic(inlineArithmetic(operator.value, left.code, right.code));
        }
        return dynamic(dynamicArithmetic(operator.code, left.code, right.code));
      }
      case "conditionalValue": {
        const condition = read("condition", false);
        if (condition.constant) {
          optimizationCounts.constantFolds += 1;
          return read(condition.value ? "whenTrue" : "whenFalse");
        }
        return dynamic(`((${condition.code}) ? (${input("whenTrue")}) : (${input("whenFalse")}))`);
      }
      case "getVariable":
        return dynamic(`variableStore.get(${input("key")})`);
      case "getLocalVariable":
        return dynamic(`variableStore.get("__local:" + String(${input("key")}))`);
      case "getGlobal":
        return requireGateway("pvGateway", "get", "error.df5e69e177f6", `pvGateway.get(${input("variableId")})`);
      case "getProperty":
        return dynamic(`(() => { const target = (${input("value")}); if (target == null) return undefined; const key = (${input("key")}); return target[key]; })()`);
      case "getStructureDefinition":
        return requireGateway("dbGateway", "getStructureDefinition", "error.ed9feb0cd2b5", `dbGateway.getStructureDefinition(${input("structureId")})`);
      case "getDatabaseDefinition":
        return requireGateway("dbGateway", "getDatabaseDefinition", "error.e67bc821c260", `dbGateway.getDatabaseDefinition(${input("databaseId")})`);
      case "findRecordsValue":
        return requireGateway("dbGateway", "findRecords", "error.fa59af2e3c80", `dbGateway.findRecords(${input("databaseId")}, ${input("query", {})})`);
      case "getRecordValue":
        return requireGateway("dbGateway", "getRecord", "error.535cdca40f3a", `dbGateway.getRecord(${input("databaseId")}, ${input("key")})`);
      case "getRuntimeCollection":
        return requireGateway("runtimeGateway", "getCollection", "error.81a602d97338", `(runtimeGateway.getCollection(${input("collectionId")}) || [])`);
      case "getRuntimeRecord":
        return requireGateway("runtimeGateway", "getRecord", "error.ad111936dc7e", `runtimeGateway.getRecord(${input("collectionId")}, ${input("recordId")})`);
      case "mergeRecords":
        return dynamic(`(() => { const keyField = (${input("keyField", "id")}); const right = (${input("right", [])}); const rightByKey = new Map((Array.isArray(right) ? right : []).map((record) => [record?.[keyField], record])); const left = (${input("left", [])}); return (Array.isArray(left) ? left : []).map((record) => ({ ...record, ...(rightByKey.get(record?.[keyField]) || {}) })); })()`);
      case "arrayAppend":
        return dynamic(`(() => { const array = (${input("array")}); const item = (${input("item")}); return [...(Array.isArray(array) ? array : []), item]; })()`);
      case "getGameTime":
        return dynamic(`(variableStore.get("__gameTime") ?? 0)`);
      case "getParameter":
        return dynamic(`(() => { const index = Number(${input("id")}); return Number.isInteger(index) && index >= 0 ? instance.parameters?.[index] : undefined; })()`);
      case "getActivityInstanceCount":
        return dynamic(`(variableStore.get("__activityCount:" + String(${input("activityId")})) ?? 0)`);
      case "getScheduleInstanceCount":
        return dynamic(`(variableStore.get("__scheduleCount:" + String(${input("scheduleId")})) ?? 0)`);
      case "getQueueEntryCount":
        return requireGateway("runtimeGateway", "listEntries", "error.a54f6a6d6d07", `runtimeGateway.listEntries(${input("queueId")}, { status: "unresolved" }).length`);
      case "addWindowComponent":
        return dynamic(`(variableStore.get(${literal(`__nodeResult:${node.id}:componentId`)}) ?? null)`);
      case "getPublicVariable":
        return requireGateway("pvGateway", "get", "error.df5e69e177f6", `pvGateway.get(${input("id")})`);
      case "getLanguage":
        return requireGateway("runtimeGateway", "getLanguage", "error.a8ffd3686ba6", "runtimeGateway.getLanguage()");
      case "publicVariableCondition":
        return requireGateway("pvGateway", "evaluateCondition", "error.3a14abbd1474", `pvGateway.evaluateCondition({ id: ${input("id")}, op: ${input("op", "eq")}, value: ${input("value")} })`);
      default: {
        const definition = getActivityNodeDefinition(node.type);
        const output = definition?.custom ? (definition.valueOutputs || []).find((item) => item.name === portName) : null;
        if (!definition?.custom || !definition.blueprint || !output?.source) {
          throw new Error(`Node ${node.type} does not produce a value output`);
        }
        const nestedParams = new Map((definition.valueInputs || []).map((item) => [item.name, read(item.name, undefined)]));
        return createCl2CodeGenerator({
          blueprint: definition.blueprint,
          nodeIndexById,
          macroIndexByNodeId,
          macroDefinitionsByNodeId,
          optimizationCounts,
          valueParameterExpressions: nestedParams,
        }).emitValueOutput(output.source.nodeId, output.source.port || "value", new Set(), nestedParams);
      }
    }
  }

  function inputCode(node, name, fallback) {
    return emitInput(node, name, fallback).code;
  }

  function nextInfo(node, port = "flowOut") {
    const targetId = node.next?.[port]?.nodeId ?? null;
    if (targetId == null) return { id: null, index: -1 };
    const index = nodeIndexById.get(targetId);
    if (index === undefined) throw new Error(`Node ${node.id} flows to unknown node: ${targetId}`);
    return { id: targetId, index };
  }

  function transition(node, target) {
    return `hooks.afterStep(${literal(node.id)}, ${literal(target.id)}); pc = ${target.index}; isResumeEntry = false; continue;`;
  }

  function dynamicTransition(node, mapping, valueExpression) {
    const cases = mapping.map(({ port, target }) => `case ${literal(port)}: nextPc = ${target.index}; nextNodeId = ${literal(target.id)}; break;`).join("\n");
    return `let nextPc = -1; let nextNodeId = null; switch (${valueExpression}) { ${cases} } hooks.afterStep(${literal(node.id)}, nextNodeId); pc = nextPc; isResumeEntry = false; continue;`;
  }

  function emitFlowOperation(node) {
    const flowOut = nextInfo(node);
    const go = transition(node, flowOut);
    const rawInputHas = (name) => Object.prototype.hasOwnProperty.call(node.inputs || {}, name);

    switch (node.type) {
      case "flowStart":
        return go;
      case "activityEnd":
        return `hooks.finish("completed"); return { status: "stopped", nodeId: ${literal(node.id)}, steps };`;
      case "macroReturn":
        return `instance.returnPort = String(${inputCode(node, "port", "flowOut")}); hooks.finish("returned"); return { status: "stopped", nodeId: ${literal(node.id)}, steps };`;
      case "setVariable": {
        const key = inputCode(node, "key");
        return rawInputHas("delta")
          ? `const key = (${key}); variableStore.delta(key, (${inputCode(node, "delta", 0)})); ${go}`
          : `const key = (${key}); variableStore.set(key, (${inputCode(node, "value")})); ${go}`;
      }
      case "setGlobal": {
        const id = inputCode(node, "variableId");
        const action = rawInputHas("delta")
          ? `pvGateway.increment(id, (${inputCode(node, "delta", 0)}));`
          : `pvGateway.set(id, (${inputCode(node, "value")}));`;
        return `if (!pvGateway) throw new Error("Node setGlobal requires a pvGateway"); const id = (${id}); ${action} ${go}`;
      }
      case "appendToArrayVariable":
        return `const key = (${inputCode(node, "key")}); const current = variableStore.get(key); const values = Array.isArray(current) ? [...current] : []; values.push(${inputCode(node, "value")}); variableStore.set(key, values); ${go}`;
      case "setLocalVariable": {
        const key = inputCode(node, "key");
        const action = rawInputHas("delta")
          ? `variableStore.delta(scopedKey, (${inputCode(node, "delta", 0)}));`
          : `variableStore.set(scopedKey, (${inputCode(node, "value")}));`;
        return `const scopedKey = "__local:" + String(${key}); ${action} ${go}`;
      }
      case "setLanguage":
        return `if (!runtimeGateway?.setLanguage) throw new Error(hooks.errorMessage("error.70e51cb62f01")); runtimeGateway.setLanguage(${inputCode(node, "language", "")}); ${go}`;
      case "branch": {
        const condition = emitInput(node, "condition", false);
        const trueTarget = nextInfo(node, "true");
        const falseTarget = nextInfo(node, "false");
        if (condition.constant) {
          optimizationCounts.constantBranches += 1;
          return transition(node, condition.value ? trueTarget : falseTarget);
        }
        return `const condition = Boolean(${condition.code}); if (condition) { ${transition(node, trueTarget)} } else { ${transition(node, falseTarget)} }`;
      }
      case "blockUntil": {
        const condition = rawInputHas("condition")
          ? `Boolean(${inputCode(node, "condition", false)})`
          : `(variableStore.get(${inputCode(node, "key")}) === (${inputCode(node, "equals", true)}))`;
        return `if (${condition}) { ${go} } hooks.onWait(${literal(node.id)}); return { status: "waiting", nodeId: ${literal(node.id)}, steps };`;
      }
      case "openWindow":
        return `const skip = Boolean(${inputCode(node, "skip", false)}); const windowId = (${inputCode(node, "windowId")}); if (!skip) windowGateway(windowId, instance, node); ${go}`;
      case "closeWindow":
        return `windowGateway(${inputCode(node, "windowId")}, instance, node); ${go}`;
      case "addWindowComponent": {
        const rawProperties = node.inputs?.properties;
        const safeInlineObject = rawProperties && typeof rawProperties === "object" && !Array.isArray(rawProperties)
          && !Object.prototype.hasOwnProperty.call(rawProperties, "nodeId")
          && !Object.prototype.hasOwnProperty.call(rawProperties, "variable");
        const propertiesExpression = safeInlineObject
          ? `structuredClone(${literal(rawProperties)})`
          : inputCode(node, "properties", {});
        const eventCode = ["onCreate", "onClick", "onChange", "onFocus", "onBlur", "onDestroy"].map((eventName) => {
          const targetId = node.next?.[eventName]?.nodeId;
          if (targetId) return `events[${literal(eventName)}] = { ...blueprint, startNodeId: ${literal(targetId)} };`;
          return `if (node.events?.[${literal(eventName)}]) events[${literal(eventName)}] = node.events[${literal(eventName)}];`;
        }).join(" ");
        const generatedProperties = ["x", "y", "width", "height", "text", "enabled"].map((name) => `const property_${name} = (${inputCode(node, name)});`).join(" ");
        const assignProperties = ["x", "y", "width", "height", "text", "enabled"].map((name) => `if (property_${name} !== undefined) properties[${literal(name)}] = property_${name};`).join(" ");
        const onCreate = nextInfo(node, "onCreate");
        const defaultNext = onCreate.id ? onCreate : flowOut;
        return `if (!apiGateway?.call) throw new Error(hooks.errorMessage("error.cbac236a53f6")); const publicVariableId = (${inputCode(node, "publicVariableId", null)}); const componentProperties = (${propertiesExpression}); const windowId = (${inputCode(node, "windowId", null)}); const parentId = (${inputCode(node, "parentId", "root")}); const componentId = (${inputCode(node, "componentId", null)}); const componentType = (${inputCode(node, "componentType", "container")}); const maxCount = (${inputCode(node, "maxCount", null)}); ${generatedProperties} const properties = { ...componentProperties }; ${assignProperties} const events = {}; ${eventCode} const result = apiGateway.call("window.addComponent", { windowId, parentId, componentId, componentType, publicVariableId, maxCount, properties, events }); if (result?.componentId && publicVariableId != null && pvGateway) pvGateway.set(publicVariableId, result.componentId); variableStore.set(${literal(`__nodeResult:${node.id}:componentId`)}, result?.componentId ?? null); const resultVariable = (${inputCode(node, "resultVariable", null)}); if (resultVariable) variableStore.set(resultVariable, result?.componentId ?? null); ${transition(node, defaultNext)}`;
      }
      case "removeWindowComponent":
        return `if (!apiGateway?.call) throw new Error(hooks.errorMessage("error.feb2a3be2247")); apiGateway.call("window.removeComponent", { windowId: (${inputCode(node, "windowId", null)}), componentId: (${inputCode(node, "componentId", null)}) }); ${go}`;
      case "getWindowLayout":
        return `if (!apiGateway?.call) throw new Error(hooks.errorMessage("error.a6702f0f6b54")); const result = apiGateway.call("window.getLayout", { windowId: (${inputCode(node, "windowId", null)}) }); const resultVariable = (${inputCode(node, "resultVariable", null)}); if (resultVariable) variableStore.set(resultVariable, result); ${go}`;
      case "runActivity":
      case "insertActivity": {
        const queueCode = node.inputs?.queue === undefined
          ? inputCode(node, "queueId", "main")
          : inputCode(node, "queue", "main");
        return `activityGateway((${inputCode(node, "activityId")}), (${queueCode}), instance, node, (${inputCode(node, "payload", null)}), (${inputCode(node, "parameters", [])})); ${go}`;
      }
      case "consumeTime":
        return `timeGateway(Number(${inputCode(node, "minutes", 0)}) || 0); ${go}`;
      case "insertSchedule":
        return `eventGateway("schedule:insert", { scheduleId: (${inputCode(node, "scheduleId", "")}), queueId: (${inputCode(node, "queue", "main")}), addTime: (${inputCode(node, "addTime", 0)}) }, instance, node); ${go}`;
      case "segmentBranch": {
        const countExpr = inputCode(node, "branchCount", 1);
        const valueExpr = inputCode(node, "value", 0);
        let branches = "";
        for (let index = 0; index < 32; index += 1) {
          const target = nextInfo(node, `segment${index}`);
          branches += `case ${index}: nextPc = ${target.index}; nextNodeId = ${literal(target.id)}; break;`;
        }
        const fallback = nextInfo(node, "default");
        return `const value = Number(${valueExpr}); const count = Math.max(1, Math.min(32, Math.floor(Number(${countExpr})))); const boundaries = Array.from({ length: count + 1 }, (_, index) => Number(${Array.from({ length: 33 }, (_, index) => `index === ${index} ? (${inputCode(node, `boundary${index}`, 0)}) : 0`).join(" : ")})); let index = -1; for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex += 1) { if (value <= boundaries[boundaryIndex] && value > boundaries[boundaryIndex + 1]) { index = boundaryIndex; break; } } let nextPc = ${fallback.index}; let nextNodeId = ${literal(fallback.id)}; switch (index) { ${branches} } hooks.afterStep(${literal(node.id)}, nextNodeId); pc = nextPc; isResumeEntry = false; continue;`;
      }
      case "emitEvent":
        return `eventGateway((${inputCode(node, "eventName")}), (${inputCode(node, "payload")}), instance, node); ${go}`;
      case "virtualFileSystem": {
        const operation = inputCode(node, "operation");
        const payload = `{
          operation: (${operation}),
          arguments: (${inputCode(node, "arguments", [])}),
          path: (${inputCode(node, "path", null)}),
          source: (${inputCode(node, "source", null)}),
          destination: (${inputCode(node, "destination", null)}),
          content: (${inputCode(node, "content", "")}),
          cwd: (${inputCode(node, "cwd", "/home/desktop")}),
          terminalInstanceId: (${inputCode(node, "terminalInstanceId", null)}),
        }`;
        return `if (!apiGateway?.call) throw new Error("Node virtualFileSystem requires an apiGateway"); apiGateway.call("vfs.execute", ${payload}, instance, node); ${go}`;
      }
      case "terminalOutput":
        return `if (!apiGateway?.call) throw new Error("Node terminalOutput requires an apiGateway"); apiGateway.call("terminal.write", { instanceId: (${inputCode(node, "terminalInstanceId", null)}), text: (${inputCode(node, "text", "")}) }, instance, node); ${go}`;
      case "callApi":
        return `if (!apiGateway?.call) throw new Error(hooks.errorMessage("error.a389d5090bf1")); const apiId = (${inputCode(node, "apiId")}); const payload = (${inputCode(node, "payload", null)}); const result = apiGateway.call(apiId, payload, instance, node); const resultVariable = (${inputCode(node, "resultVariable")}); if (resultVariable) variableStore.set(resultVariable, result); ${go}`;
      case "playBgm":
        return `if (!apiGateway?.call) throw new Error("Node playBgm requires an apiGateway"); apiGateway.call("audio.playLoop", { trackId: (${inputCode(node, "bgmId", null)}) }); ${go}`;
      case "stopBgm":
        return `if (!apiGateway?.call) throw new Error("Node stopBgm requires an apiGateway"); apiGateway.call("audio.stop"); ${go}`;
      case "setBgmVolume":
        return `if (!apiGateway?.call) throw new Error("Node setBgmVolume requires an apiGateway"); apiGateway.call("audio.volume", { volume: (${inputCode(node, "volume", 100)}) }); ${go}`;
      case "pushBgmLayer":
        return `if (!apiGateway?.call) throw new Error("Node pushBgmLayer requires an apiGateway"); apiGateway.call("audio.layer", { action: (${inputCode(node, "action", "play")}), trackId: (${inputCode(node, "bgmId", null)}) }); ${go}`;
      case "restoreBgmLayer":
        return `if (!apiGateway?.call) throw new Error("Node restoreBgmLayer requires an apiGateway"); apiGateway.call("audio.layer", { action: "restore" }); ${go}`;
      case "createRecord":
      case "getRecord":
      case "updateRecord":
      case "deleteRecord":
      case "findRecords":
      case "countRecords": {
        let resultExpression;
        if (node.type === "createRecord") resultExpression = `dbGateway.createRecord(databaseId, (${inputCode(node, "data")}))`;
        else if (node.type === "getRecord") resultExpression = `dbGateway.getRecord(databaseId, (${inputCode(node, "key")}))`;
        else if (node.type === "updateRecord") resultExpression = `dbGateway.updateRecord(databaseId, (${inputCode(node, "key")}), (${inputCode(node, "patch")}))`;
        else if (node.type === "deleteRecord") resultExpression = `dbGateway.deleteRecord(databaseId, (${inputCode(node, "key")}))`;
        else if (node.type === "findRecords") resultExpression = `dbGateway.findRecords(databaseId, (${inputCode(node, "query", {})}))`;
        else resultExpression = `dbGateway.countRecords(databaseId, (${inputCode(node, "query", {})}))`;
        return `if (!dbGateway) throw new Error("Node ${node.type} requires a dbGateway"); const databaseId = (${inputCode(node, "databaseId")}); const resultVariable = (${inputCode(node, "resultVariable")}); const result = ${resultExpression}; if (resultVariable) variableStore.set(resultVariable, result); ${go}`;
      }
      case "applyPublicVariableEffect": {
        const id = inputCode(node, "id");
        let effect;
        if (rawInputHas("delta")) effect = `pvGateway.increment(id, (${inputCode(node, "delta", 0)}));`;
        else if (rawInputHas("toggle")) effect = "pvGateway.toggle(id);";
        else if (rawInputHas("setObjectRef")) effect = `pvGateway.setObjectRef(id, (${inputCode(node, "setObjectRef", null)}));`;
        else effect = `const value = (${inputCode(node, "value")}); if (typeof value === "number" && value < 0) pvGateway.increment(id, value); else pvGateway.set(id, value);`;
        return `if (!pvGateway) throw new Error("Node applyPublicVariableEffect requires a pvGateway"); const id = (${id}); ${effect} ${go}`;
      }
      case "markEventState":
        return `if (!eventStateGateway && !onboardingGateway) throw new Error("Node markEventState requires an eventStateGateway"); (eventStateGateway || onboardingGateway).mark(${inputCode(node, "id")}); ${go}`;
      case "text": {
        const target = nextInfo(node);
        const continueKeyCode = `((authoredContinueKey) || (displayTo === "dorm-bottom" ? ${literal(`dlg:${node.id}:continue`)} : null))`;
        return `const displayTo = (${inputCode(node, "displayTo", "default")}); const authoredContinueKey = (${inputCode(node, "continueKey")}); const continueKey = ${continueKeyCode}; if (continueKey && variableStore.get(continueKey)) { variableStore.set(continueKey, null); ${transition(node, target)} } const payload = { instanceId: instance.instanceId, speaker: (${inputCode(node, "speaker", "")}), text: (${inputCode(node, "text", "")}), displayTo, keywordIds: (${inputCode(node, "keywordIds", [])}), continueKey: continueKey || null }; executionState.lastDialogueDisplayTo = payload.displayTo || executionState.lastDialogueDisplayTo; instance.transcript = Array.isArray(instance.transcript) ? instance.transcript : []; instance.transcript.push({ type: "text", ...payload, continueKey: null }); if (hooks.debugLog) hooks.debugLog("text", ${literal(node.id)}, payload); eventGateway("display:text", payload, instance, node); if (continueKey && !variableStore.get(continueKey)) { hooks.onWait(${literal(node.id)}); return { status: "waiting", nodeId: ${literal(node.id)}, steps }; } if (continueKey) variableStore.set(continueKey, null); ${transition(node, target)}`;
      }
      case "choice": {
        const ports = Array.from({ length: 6 }, (_, index) => ({ port: `option${index}`, target: nextInfo(node, `option${index}`) }));
        const mapCode = ports.map(({ port, target }) => `case ${literal(port)}: nextPc = ${target.index}; nextNodeId = ${literal(target.id)}; break;`).join(" ");
        const displayToCode = node.inputs?.displayTo === undefined
          ? "(executionState.lastDialogueDisplayTo || \"default\")"
          : inputCode(node, "displayTo", "default");
        return `const selectionKey = (${inputCode(node, "selectionKey")}); const optionCount = Number(${inputCode(node, "optionCount", 0)}) || 0; const payload = { instanceId: instance.instanceId, options: (${inputCode(node, "options", [])}), selectionKey, displayTo: (${displayToCode}) }; const selected = selectionKey ? variableStore.get(selectionKey) : undefined; if (selected !== undefined && selected !== null) { const index = Number(selected); if (!Number.isInteger(index) || index < 0 || index >= optionCount) throw new Error(${literal(`Node ${node.id} received an out-of-range choice selection: `)} + selected); if (selectionKey) variableStore.set(selectionKey, null); let nextPc = -1; let nextNodeId = null; switch ("option" + index) { ${mapCode} } hooks.afterStep(${literal(node.id)}, nextNodeId); pc = nextPc; isResumeEntry = false; continue; } executionState.lastDialogueDisplayTo = payload.displayTo || executionState.lastDialogueDisplayTo; instance.transcript = Array.isArray(instance.transcript) ? instance.transcript : []; instance.transcript.push({ type: "choice", ...payload }); if (hooks.debugLog) hooks.debugLog("choice", ${literal(node.id)}, payload); eventGateway("display:choice", payload, instance, node); hooks.onWait(${literal(node.id)}); return { status: "waiting", nodeId: ${literal(node.id)}, steps };`;
      }
      default: {
        const macroIndex = macroIndexByNodeId.get(node.id);
        const macroDefinition = macroDefinitionsByNodeId.get(node.id);
        if (macroIndex !== undefined && macroDefinition) {
          const parameters = (macroDefinition.valueInputs || []).map((parameter) => `${literal(parameter.name)}: (${inputCode(node, parameter.name)})`).join(", ");
          const outputPorts = (macroDefinition.flowOutputs || []).map((output) => ({ port: output.name, target: nextInfo(node, output.name) }));
          const branches = outputPorts.map(({ port, target }) => `if (macroPort === ${literal(port)} && ${target.index} >= 0) { nextPc = ${target.index}; nextNodeId = ${literal(target.id)}; }`).join(" else ");
          const fallback = nextInfo(node);
          return `const macroResult = hooks.runMacro(macroExecutors[${macroIndex}], ${literal(node.id)}, node, { ${parameters} }); const macroPort = macroResult.returnPort; let nextPc = ${fallback.index}; let nextNodeId = ${literal(fallback.id)}; ${outputPorts.length ? `if (false) {} else ${branches}` : ""} hooks.afterStep(${literal(node.id)}, nextNodeId); pc = nextPc; isResumeEntry = false; continue;`;
        }
        return `throw new Error(${literal(`Unhandled node type: ${node.type}`)});`;
      }
    }
  }

  return { emitInput, emitRaw, emitValueOutput, emitFlowOperation };
}
