import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const dataRoot = path.join(root, "data");
const exampleRoot = path.join(root, "engine", "example.data");
const { parseCl2 } = await import(pathToFileURL(path.join(root, "engine", "core", "Cl2Parser.js")));
const { getActivityNodeDefinition, listCustomActivityNodes } = await import(pathToFileURL(path.join(root, "engine", "core", "ActivityNodeRegistry.js")));
await import(pathToFileURL(path.join(root, "engine", "probes", "register-framework-nodes.mjs")));
const registeredCustomNodeDefinitions = listCustomActivityNodes().map(({ id, flowInputs, flowOutputs, valueInputs, valueOutputs }) => ({ id, flowInputs, flowOutputs, valueInputs, valueOutputs }));
const activityManifest = JSON.parse(fs.readFileSync(path.join(dataRoot, "activity-manifest.json"), "utf8"));
const resultTypes = new Set(["callApi", "findRecords", "getRecord", "createRecord", "getWindowLayout", "addWindowComponent"]);
const freeVariableTypes = new Set(["setVariable", "getVariable", "appendToArrayVariable"]);
const sources = [];
const nativeVariableRefs = [];
const embeddedGraphVariableNodes = [];
const statChangeEntries = [];
const exampleGraphNodes = [];

for (const activity of activityManifest.activityIds || []) {
  const filePath = path.join(dataRoot, "activities", activity.file);
  sources.push({ kind: "activity", id: activity.id, path: path.relative(root, filePath).replaceAll("\\", "/"), text: fs.readFileSync(filePath, "utf8") });
}

function collectEmbeddedSources(value, file, jsonPath = "$", inheritedBlueprintKind = null) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectEmbeddedSources(child, file, `${jsonPath}[${index}]`, inheritedBlueprintKind));
    return;
  }
  if (!value || typeof value !== "object") return;
  let childBlueprintKind = inheritedBlueprintKind;
  if (file === "data/blueprint-nodes.framework.json") {
    if (Array.isArray(value.flowOutputs) && value.flowOutputs.length > 0) childBlueprintKind = "customFlow";
    else if (Array.isArray(value.valueOutputs) && value.valueOutputs.length > 0) childBlueprintKind = "customValue";
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "cl2" && typeof child === "string") {
      const kind = file.startsWith("engine/example.data/") ? "exampleEmbedded" : file.startsWith("data/windows/") ? "window" : "canonicalEmbedded";
      const blueprintKind = file.startsWith("data/databases/") && jsonPath.includes(".activities.") ? "activity" : childBlueprintKind;
      sources.push({ kind, blueprintKind, id: `${file}:${jsonPath}.${key}`, path: file, text: child });
    }
    collectEmbeddedSources(child, file, `${jsonPath}.${key}`, key === "blueprint" ? childBlueprintKind : inheritedBlueprintKind);
  }
}

function listFiles(dir, predicate) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(filePath, predicate);
    return entry.isFile() && predicate(entry.name) ? [filePath] : [];
  });
}

for (const dataDirectory of [dataRoot, exampleRoot]) {
  for (const filePath of listFiles(dataDirectory, (name) => name.endsWith(".json"))) {
    const relative = path.relative(root, filePath).replaceAll("\\", "/");
    if (relative.startsWith("data/activities/")) continue; // The manifest's CL2 files are canonical Activity sources.
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    function scanJson(value, jsonPath = "$", recordId = null) {
      if (Array.isArray(value)) {
        value.forEach((child, index) => scanJson(child, `${jsonPath}[${index}]`, recordId));
        return;
      }
      if (!value || typeof value !== "object") return;
      const currentRecordId = value.id ?? recordId;
      if (value.statChanges && typeof value.statChanges === "object" && !Array.isArray(value.statChanges)) {
        for (const [statId, statValue] of Object.entries(value.statChanges)) {
          statChangeEntries.push({
            source: relative,
            jsonPath: `${jsonPath}.statChanges.${statId}`,
            recordId: currentRecordId,
            statId,
            value: statValue,
          });
        }
      }
      if (Object.keys(value).length === 1 && typeof value.variable === "string") {
        nativeVariableRefs.push({ source: relative, sourceKind: relative.startsWith("engine/example.data/") ? "exampleJson" : "canonicalJson", jsonPath, key: value.variable });
      }
      if (relative.startsWith("data/windows/")
        && jsonPath.includes(".valueGraph.nodes.")
        && typeof value.id === "string"
        && freeVariableTypes.has(value.type)
        && value.inputs && typeof value.inputs === "object") {
        embeddedGraphVariableNodes.push({
          source: relative,
          sourceKind: "windowValueGraph",
          jsonPath,
          nodeId: value.id,
          type: value.type,
          key: value.inputs.key,
          inputs: value.inputs,
        });
      }
      if (relative.startsWith("engine/example.data/") && typeof value.id === "string" && typeof value.type === "string" && value.inputs && typeof value.inputs === "object") {
        exampleGraphNodes.push({ source: relative, jsonPath, nodeId: value.id, type: value.type, inputs: value.inputs });
      }
      for (const [key, child] of Object.entries(value)) scanJson(child, `${jsonPath}.${key}`, currentRecordId);
    }
    scanJson(document);
    collectEmbeddedSources(document, relative);
  }
  for (const filePath of listFiles(dataDirectory, (name) => name.endsWith(".CL2.txt"))) {
    const relative = path.relative(root, filePath).replaceAll("\\", "/");
    const isExample = relative.startsWith("engine/example.data/");
    if (!isExample) continue; // Production Activity sources were already selected from their manifest above.
    sources.push({ kind: isExample ? "exampleActivity" : "activity", id: relative, path: relative, text: fs.readFileSync(filePath, "utf8") });
  }
}

function collectProbeReferenceLines(directory) {
  const terms = ["setVariable", "getVariable", "appendToArrayVariable", "setGlobal", "applyPublicVariableEffect", "getGlobal", "getPublicVariable", "publicVariableCondition", "setLocalVariable", "getLocalVariable", "resultVariable", "continueKey", "selectionKey", "emitEvent", "eventGateway", "engine.emit", "engine.getVariable", "engine.setVariable"];
  const pattern = new RegExp(terms.map((term) => term.replaceAll(".", "\\.")).join("|"), "g");
  const rows = [];
  for (const filePath of listFiles(directory, (name) => name.endsWith(".mjs"))) {
    const source = path.relative(root, filePath).replaceAll("\\", "/");
    if (source === "probes/blueprint-callsite-audit.mjs") continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const matches = [...line.matchAll(pattern)].map((match) => match[0]);
      if (matches.length) rows.push({ source, line: index + 1, terms: [...new Set(matches)] });
      pattern.lastIndex = 0;
    });
  }
  return rows;
}

const probeRoots = [path.join(root, "probes"), path.join(root, "engine", "probes")].filter((directory) => fs.existsSync(directory));
const probeReferenceLines = probeRoots.flatMap(collectProbeReferenceLines);
const runtimeVariableCalls = [];
const runtimeCallPattern = /(?:this\.)?variableStore(?:\?\.|\.)(getLocal|setLocal|deltaLocal|get|set|delta|appendToArray)\s*\(\s*([^,)]*)/g;
for (const filePath of listFiles(path.join(root, "engine", "core"), (name) => name.endsWith(".js"))) {
  const relative = path.relative(root, filePath).replaceAll("\\", "/");
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    runtimeCallPattern.lastIndex = 0;
    for (const match of line.matchAll(runtimeCallPattern)) {
      const firstArgument = match[2].trim();
      const quoted = firstArgument.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/);
      runtimeVariableCalls.push({
        source: relative,
        line: index + 1,
        method: match[1],
        firstArgument,
        accessKind: quoted ? "literal-key" : "dynamic-or-expression",
      });
    }
  });
}
const engineApiSurface = fs.readFileSync(path.join(root, "engine", "core", "engine-api.js"), "utf8")
  .split(/\r?\n/)
  .flatMap((line, index) => [...line.matchAll(/\["(engine\.(?:getVariable|setVariable|emit))"/g)].map((match) => ({ source: "engine/core/engine-api.js", line: index + 1, apiId: match[1] })));

const nodeCounts = new Map();
const freeVariableNodes = [];
const statOperationNodes = [];
const typedPortCollisionCandidates = [];
const variableRefs = [];
const continueKeys = [];
const selectionKeys = [];
const resultCandidates = [];
const emitEvents = [];
const diagnostics = [];

function collectVariableRefs(value, source, sourceKind, nodeId, inputPath = "inputs") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectVariableRefs(child, source, sourceKind, nodeId, `${inputPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Object.keys(value).length === 1 && typeof value.variable === "string") {
    variableRefs.push({ source, sourceKind, nodeId, inputPath, key: value.variable });
  }
  for (const [key, child] of Object.entries(value)) collectVariableRefs(child, source, sourceKind, nodeId, `${inputPath}.${key}`);
}

function expressionType(value, nodes) {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (value?.nodeId) {
    const producer = nodes[value.nodeId];
    const outputs = getActivityNodeDefinition(producer?.type)?.valueOutputs || [];
    return outputs.find((port) => port.name === (value.port || "value"))?.type || "any";
  }
  return "any";
}

function extractRawCall(text, nodeId, type) {
  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(`(^|[;\\n])(?:\\s|/\\*[\\s\\S]*?\\*/)*${escapeRegExp(nodeId)}\\s*:\\s*${escapeRegExp(type)}\\s*\\(`, "m");
  const match = declaration.exec(text);
  if (!match) return null;
  const exactHeader = new RegExp(`${escapeRegExp(nodeId)}\\s*:\\s*${escapeRegExp(type)}\\s*\\($`, "m").exec(match[0]);
  if (!exactHeader) return null;
  const start = match.index + exactHeader.index;
  const openParen = match.index + match[0].length - 1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openParen; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1).trim();
    }
  }
  return null;
}

function legacyCorroborationFor(source, nodeId) {
  if (source.kind !== "activity") return null;
  const legacyPath = path.join(dataRoot, "activities", `${source.id}.json`);
  if (!fs.existsSync(legacyPath)) return null;
  const document = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  const node = document.blueprint?.nodes?.[nodeId];
  if (!node) return null;
  return {
    source: path.relative(root, legacyPath).replaceAll("\\", "/"),
    type: node.type || null,
    inputs: node.inputs || {},
  };
}

let parsedCount = 0;
let graphCount = 0;
for (const source of sources) {
  const parsed = parseCl2(source.text, { sourcePath: source.id, validate: false, blueprintKind: source.blueprintKind || null });
  if (parsed.ok) parsedCount += 1;
  else diagnostics.push({ source: source.id, diagnostics: parsed.diagnostics || [] });
  if (!parsed.graph) continue;
  graphCount += 1;
  for (const node of Object.values(parsed.graph?.nodes || {})) {
    nodeCounts.set(node.type, (nodeCounts.get(node.type) || 0) + 1);
    const inputs = node.inputs || {};
    collectVariableRefs(inputs, source.id, source.kind, node.id);
    const nodeDefinition = getActivityNodeDefinition(node.type);
    const inputPorts = nodeDefinition?.valueInputs || [];
    for (let index = 0; index < inputPorts.length; index += 1) {
      const port = inputPorts[index];
      if (port.type !== "any" || !Object.hasOwn(inputs, port.name)) continue;
      const actualType = expressionType(inputs[port.name], parsed.graph.nodes || {});
      const laterTypedPorts = inputPorts.slice(index + 1)
        .filter((candidate) => candidate.type !== "any" && candidate.type === actualType);
      if (laterTypedPorts.length === 0) continue;
      typedPortCollisionCandidates.push({
        source: source.id,
        sourceKind: source.kind,
        nodeId: node.id,
        type: node.type,
        customDefinition: nodeDefinition.custom === true,
        anyPort: port.name,
        actualType,
        laterTypedPorts: laterTypedPorts.map(({ name, type }) => ({ name, type, currentlyPresent: Object.hasOwn(inputs, name) })),
        inputs,
        rawCall: extractRawCall(source.text, node.id, node.type),
        legacyCorroboration: legacyCorroborationFor(source, node.id),
      });
    }
    if (freeVariableTypes.has(node.type)) freeVariableNodes.push({ source: source.id, sourceKind: source.kind, nodeId: node.id, type: node.type, key: inputs.key, inputs });
    if (node.type === "statOperation") statOperationNodes.push({ source: source.id, sourceKind: source.kind, nodeId: node.id, inputs, rawCall: extractRawCall(source.text, node.id, node.type) });
    if (node.type === "text" && inputs.continueKey != null) continueKeys.push({ source: source.id, sourceKind: source.kind, nodeId: node.id, key: inputs.continueKey });
    if (node.type === "choice" && inputs.selectionKey != null) selectionKeys.push({ source: source.id, sourceKind: source.kind, nodeId: node.id, key: inputs.selectionKey });
    if (resultTypes.has(node.type)) {
      const targets = Object.fromEntries(["resultVariable", "resultScope", "resultId"].filter((key) => inputs[key] != null).map((key) => [key, inputs[key]]));
      resultCandidates.push({
        source: source.id,
        sourceKind: source.kind,
        nodeId: node.id,
        type: node.type,
        targets,
        hasTarget: Object.keys(targets).length > 0,
        rawCall: extractRawCall(source.text, node.id, node.type),
        legacyCorroboration: legacyCorroborationFor(source, node.id),
      });
    }
    if (node.type === "emitEvent") emitEvents.push({ source: source.id, sourceKind: source.kind, nodeId: node.id, eventName: inputs.eventName });
  }
}

const gameManifest = JSON.parse(fs.readFileSync(path.join(dataRoot, "game-manifest.json"), "utf8"));
const eventRoutes = (gameManifest.eventRoutes || []).map((route, index) => ({
  index,
  event: route.event,
  condition: route.condition || null,
  actionTypes: (route.actions || []).map((action) => action.type),
  actions: route.actions || [],
}));
const routeActivityDispatches = eventRoutes
  .filter((route) => route.actions?.some((action) => action.type === "activity.dispatch") || route.activityId != null)
  .map((route) => ({ index: route.index, event: route.event, activityId: route.activityId ?? null, queueId: route.queueId ?? null }));
const routeEventEmitActions = eventRoutes.flatMap((route) => route.actions
  .filter((action) => action.type === "event.emit")
  .map((action) => ({ index: route.index, event: route.event, emittedEvent: action.event })));
const routeVariableRefs = [];
function collectRouteVariableRefs(value, routeIndex, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectRouteVariableRefs(child, routeIndex, [...pathParts, index]));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Object.keys(value).length === 1 && typeof value.variable === "string") {
    routeVariableRefs.push({ routeIndex, path: pathParts.join("."), key: value.variable });
  }
  for (const [key, child] of Object.entries(value)) collectRouteVariableRefs(child, routeIndex, [...pathParts, key]);
}
eventRoutes.forEach((route) => collectRouteVariableRefs(route.actions, route.index, ["actions"]));
const actionCounts = eventRoutes.flatMap((route) => route.actionTypes).reduce((counts, type) => {
  counts[type] = (counts[type] || 0) + 1;
  return counts;
}, {});
const productionEmitEvents = emitEvents.filter((row) => !row.sourceKind.startsWith("example"));
const exampleEmitEvents = emitEvents.filter((row) => row.sourceKind.startsWith("example"));
const productionVariableRefs = variableRefs.filter((row) => !row.sourceKind.startsWith("example"));
const exampleVariableRefs = variableRefs.filter((row) => row.sourceKind.startsWith("example"));
const productionResultCandidates = resultCandidates.filter((row) => !row.sourceKind.startsWith("example"));
const exampleResultCandidates = resultCandidates.filter((row) => row.sourceKind.startsWith("example"));
for (const row of resultCandidates) {
  const candidateKey = typeof row.targets.resultVariable === "string"
    ? row.targets.resultVariable
    : typeof row.targets.resultScope === "string" && !["local", "public"].includes(row.targets.resultScope)
      ? row.targets.resultScope
      : null;
  row.targetReaders = candidateKey == null ? null : {
    cl2FreeVariableNodes: freeVariableNodes.filter((reader) => reader.key === candidateKey),
    embeddedGraphVariableNodes: embeddedGraphVariableNodes.filter((reader) => reader.key === candidateKey),
    valueReferences: variableRefs.filter((reader) => reader.key === candidateKey),
    canonicalJsonRefs: nativeVariableRefs.filter((reader) => reader.key === candidateKey),
    routeVariableRefs: routeVariableRefs.filter((reader) => reader.key === candidateKey),
  };
}
const emittedNames = new Set(productionEmitEvents.map((row) => row.eventName).filter((name) => typeof name === "string"));
const exampleEmittedNames = new Set(exampleEmitEvents.map((row) => row.eventName).filter((name) => typeof name === "string"));
const routedNames = new Set(eventRoutes.map((route) => route.event).filter((name) => typeof name === "string"));
const exampleGraphVariableNodes = exampleGraphNodes
  .filter((node) => freeVariableTypes.has(node.type))
  .map((node) => ({
    ...node,
    sourceKind: "exampleGraph",
    key: node.inputs.key,
  }));
const exampleNodeCounts = exampleGraphNodes.reduce((counts, node) => {
  counts[node.type] = (counts[node.type] || 0) + 1;
  return counts;
}, {});
const freeVariableGroups = new Map();
const sourceKindsById = new Map(sources.map(({ id, kind }) => [id, kind]));
for (const row of freeVariableNodes) {
  if (typeof row.key !== "string") continue;
  const group = freeVariableGroups.get(row.key) || { nodeCounts: {}, sources: new Set(), sourceKinds: new Set() };
  group.nodeCounts[row.type] = (group.nodeCounts[row.type] || 0) + 1;
  group.sources.add(row.source);
  if (sourceKindsById.has(row.source)) group.sourceKinds.add(sourceKindsById.get(row.source));
  freeVariableGroups.set(row.key, group);
}
const freeVariableKeySummary = [...freeVariableGroups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, group]) => ({
  key,
  nodeCounts: group.nodeCounts,
  sources: [...group.sources].sort(),
  sourceKinds: [...group.sourceKinds].sort(),
}));
const freeVariableSourceKindCounts = freeVariableKeySummary.reduce((counts, row) => {
  const kindKey = row.sourceKinds.join("+") || "unknown";
  counts[kindKey] = (counts[kindKey] || 0) + 1;
  return counts;
}, {});
const sourcePathById = new Map(sources.map(({ id, path: sourcePath }) => [id, sourcePath]));
const variableSourceGroups = new Map();
function addVariableSource(key, source, usage) {
  if (typeof key !== "string") return;
  const sourcePath = sourcePathById.get(source) || source;
  const group = variableSourceGroups.get(key) || { sourcePaths: new Set(), usages: new Set() };
  group.sourcePaths.add(sourcePath);
  group.usages.add(usage);
  variableSourceGroups.set(key, group);
}
for (const row of freeVariableNodes) addVariableSource(row.key, row.source, `free-node:${row.type}`);
for (const row of embeddedGraphVariableNodes) addVariableSource(row.key, row.source, `valuegraph-node:${row.type}`);
for (const row of exampleGraphVariableNodes) addVariableSource(row.key, row.source, `example-graph-node:${row.type}`);
for (const row of variableRefs) addVariableSource(row.key, row.source, `value-ref:${row.sourceKind}`);
for (const row of nativeVariableRefs) addVariableSource(row.key, row.source, "canonical-json-ref");
for (const row of routeVariableRefs) addVariableSource(row.key, "data/game-manifest.json", `route-read:${row.routeIndex}`);
for (const row of runtimeVariableCalls) {
  if (row.accessKind !== "literal-key") continue;
  let key = row.firstArgument.slice(1, -1);
  if (row.firstArgument.startsWith('"')) {
    try { key = JSON.parse(row.firstArgument); } catch { /* Keep the source literal for audit visibility. */ }
  }
  addVariableSource(key, row.source, `runtime:${row.method}`);
}
for (const route of eventRoutes) {
  for (const action of route.actions) {
    if (action.type === "variable.set") addVariableSource(action.key, "data/game-manifest.json", `route-write:${route.index}`);
  }
}
const crossSourceVariableSummary = [...variableSourceGroups.entries()]
  .filter(([, group]) => group.sourcePaths.size > 1)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, group]) => ({ key, sourcePaths: [...group.sourcePaths].sort(), usages: [...group.usages].sort() }));
const eventTopics = [...new Set([...productionEmitEvents, ...exampleEmitEvents].map((row) => row.eventName).filter((name) => typeof name === "string").concat([...routedNames]))].sort();
const eventTopicSummary = eventTopics.map((topic) => {
  const productionRows = productionEmitEvents.filter((row) => row.eventName === topic);
  const exampleRows = exampleEmitEvents.filter((row) => row.eventName === topic);
  const routes = eventRoutes.filter((route) => route.event === topic);
  return {
    topic,
    productionEmitCount: productionRows.length,
    productionSources: [...new Set(productionRows.map((row) => row.source))].sort(),
    exampleEmitCount: exampleRows.length,
    routeIndexes: routes.map((route) => route.index),
    actionTypes: [...new Set(routes.flatMap((route) => route.actionTypes))],
  };
});
const inventory = {
  schemaVersion: 1,
  scope: "manifest-listed production Activity CL2, embedded production window/database/custom-node CL2, engine-example Activity/window CL2, production window valueGraph variable nodes, engine example graph JSON, non-Activity canonical JSON variable references, game-manifest event routes, and lexical legacy references in probe sources",
  sourceCount: sources.length,
  parsedCount,
  graphCount,
  failedCount: diagnostics.length,
  sourceFiles: sources.map(({ kind, id, path: sourcePath }) => ({ kind, id, path: sourcePath })),
  registeredCustomNodeDefinitions,
  nodeCounts: Object.fromEntries([...nodeCounts].sort()),
  freeVariableNodes,
  embeddedGraphVariableNodes,
  exampleGraphVariableNodes,
  statOperationNodes,
  statChangeEntries,
  typedPortCollisionCandidates,
  freeVariableKeySummary,
  crossSourceVariableSummary,
  continueKeys,
  selectionKeys,
  variableRefs,
  productionVariableRefs: productionVariableRefs.length,
  exampleVariableRefs: exampleVariableRefs.length,
  nativeVariableRefs,
  resultCandidates,
  productionResultCandidates: productionResultCandidates.length,
  exampleResultCandidates: exampleResultCandidates.length,
  emitEvents,
  productionEmitEvents: productionEmitEvents.length,
  exampleEmitEvents: exampleEmitEvents.length,
  eventRoutes,
  routeActivityDispatches,
  routeEventEmitActions,
  routeVariableRefs,
  eventTopicSummary,
  actionCounts,
  exampleGraphNodes,
  exampleNodeCounts,
  probeReferenceLines,
  runtimeVariableCalls,
  engineApiSurface,
  emittedWithoutRoute: [...emittedNames].filter((name) => !routedNames.has(name)).sort(),
  exampleEmittedWithoutRoute: [...exampleEmittedNames].filter((name) => !routedNames.has(name)).sort(),
  routeWithoutBlueprintEmitter: [...routedNames].filter((name) => !emittedNames.has(name)).sort(),
  diagnostics,
};

const summary = {
  sourceCount: inventory.sourceCount,
  parsedCount,
  graphCount,
  failedCount: diagnostics.length,
  freeVariableNodes: freeVariableNodes.length,
  embeddedGraphVariableNodes: embeddedGraphVariableNodes.length,
  exampleGraphVariableNodes: exampleGraphVariableNodes.length,
  statOperationCalls: statOperationNodes.length,
  statChangeEntries: statChangeEntries.length,
  typedPortCollisionCandidates: typedPortCollisionCandidates.length,
  registeredCustomNodeDefinitions: registeredCustomNodeDefinitions.length,
  customTypedPortCollisionCandidates: typedPortCollisionCandidates.filter((row) => row.customDefinition).length,
  freeVariableUniqueKeys: freeVariableKeySummary.length,
  freeVariableSourceKindCounts,
  crossSourceVariableKeys: crossSourceVariableSummary.length,
  freeVariableMissingKeyCalls: freeVariableNodes.length - freeVariableNodes.filter((row) => typeof row.key === "string").length,
  continueKeyCalls: continueKeys.length,
  selectionKeyCalls: selectionKeys.length,
  cl2VariableRefs: variableRefs.length,
  productionCl2VariableRefs: productionVariableRefs.length,
  exampleCl2VariableRefs: exampleVariableRefs.length,
  nativeVariableRefs: nativeVariableRefs.length,
  resultCandidates: resultCandidates.length,
  productionResultCandidates: productionResultCandidates.length,
  exampleResultCandidates: exampleResultCandidates.length,
  resultTargets: resultCandidates.filter((row) => row.hasTarget).length,
  emitEvents: emitEvents.length,
  productionEmitEvents: productionEmitEvents.length,
  exampleEmitEvents: exampleEmitEvents.length,
  eventRoutes: eventRoutes.length,
  routesWithActivityDispatch: routeActivityDispatches.length,
  routeEventEmitActions: routeEventEmitActions.length,
  routeVariableRefs: routeVariableRefs.length,
  eventTopics: eventTopicSummary.length,
  routeActions: Object.values(actionCounts).reduce((sum, count) => sum + count, 0),
  exampleGraphNodes: exampleGraphNodes.length,
  probeReferenceLines: probeReferenceLines.length,
  runtimeVariableCalls: runtimeVariableCalls.length,
  engineApiSurface,
  actionCounts,
  emittedWithoutRoute: inventory.emittedWithoutRoute,
  routeWithoutBlueprintEmitter: inventory.routeWithoutBlueprintEmitter,
};

const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  summary.outputPath = path.relative(root, outputPath).replaceAll("\\", "/");
}
console.log(JSON.stringify(summary, null, 2));
if (diagnostics.length > 0 && !process.argv.includes("--allow-diagnostics")) process.exitCode = 1;
