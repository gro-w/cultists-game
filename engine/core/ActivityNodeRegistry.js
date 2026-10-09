import { t } from "./i18n/index.js";
/**
 * ActivityNodeRegistry - the generic, domain-agnostic Blueprint node types
 * available in ng/ Phase 2. Per the plan's risk mitigation (§15 风险 F),
 * this registry must never grow "item"/"medical"/"dialogue"-specific node
 * types; those arrive later as data-driven Activity *content*, not new
 * node types baked into the engine.
 */
const FLOW = "flow";
const VALUE = "value";

// Content/developer-defined macro nodes live beside, but never replace, the
// engine registry. Their definitions are registered after the engine boots so
// the Activity editor and validator can use the same port contract.
const customDefinitions = new Map();

const flowIn = (name = "flowIn") => ({ name, kind: FLOW });
const flowOut = (name = "flowOut", optional = false) => ({ name, kind: FLOW, optional });
const valueIn = (name, type = "any") => ({ name, kind: VALUE, type });
const valueOut = (name = "value", type = "any") => ({ name, kind: VALUE, type });

const definitions = {
  flowStart: { label: t("legacy.693c26d62889"), flowOutputs: [flowOut()] },
  activityEnd: { label: t("legacy.ed342f86a3bc"), flowInputs: [flowIn()] },
  macroReturn: {
    label: t("legacy.b4a854b31384"),
    flowInputs: [flowIn()],
    flowOutputs: [],
    valueInputs: [valueIn("port", "string")],
  },
  setVariable: {
    label: t("legacy.6e5239637e0c"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("key", "string"), valueIn("value"), valueIn("delta", "number")],
  },
  setGlobal: {
    label: t("legacy.6e5239637e0e"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("variableId", "number"), valueIn("value"), valueIn("delta", "number")],
  },
  appendToArrayVariable: {
    label: t("legacy.043ad239c775"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("key", "string"), valueIn("value")],
  },
  setLocalVariable: {
    label: t("legacy.ce29aad2927d"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("key", "string"), valueIn("value"), valueIn("delta", "number")],
  },
  getLocalVariable: {
    label: t("legacy.eebde94655b3"),
    valueInputs: [valueIn("key", "string")],
    valueOutputs: [valueOut("value")],
  },
  branch: {
    label: t("legacy.315a7ec1a389"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut("true"), flowOut("false")],
    valueInputs: [valueIn("condition", "bool")],
  },
  blockUntil: {
    label: t("legacy.48c0c0187e50"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("key", "string"), valueIn("equals"), valueIn("condition", "bool")],
  },

  // Generic window-kernel action (not domain logic - windows/WindowManager
  // are core engine concepts per plan §4/§7). Lets a blueprint (e.g. a
  // desktop icon's) open a window definition by id and then keep going,
  // e.g. into a consumeTime node - see plan §7.4's "下班" example flow.
  openWindow: {
    label: t("legacy.51886c677f15"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("windowId", "string"), valueIn("skip", "bool")],
  },
  closeWindow: {
    label: t("legacy.51daeffe4774"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("windowId", "string")],
  },
  addWindowComponent: {
    label: t("legacy.11c5c12f4e3e"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut("onCreate", true), flowOut("onClick", true), flowOut("onChange", true), flowOut("onFocus", true), flowOut("onBlur", true), flowOut("onDestroy", true)],
    valueInputs: [valueIn("windowId", "string"), valueIn("parentId", "string"), valueIn("componentId", "string"), valueIn("componentType", "string"), valueIn("publicVariableId", "number"), valueIn("resultVariable", "string"), valueIn("maxCount", "number"), valueIn("x", "number"), valueIn("y", "number"), valueIn("width", "number"), valueIn("height", "number"), valueIn("text", "string"), valueIn("enabled", "bool"), valueIn("properties")],
  },
  removeWindowComponent: {
    label: t("legacy.c2b00e60ff9e"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("windowId", "string"), valueIn("componentId", "string")],
  },
  getWindowLayout: {
    label: t("legacy.c6861e5817a0"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("windowId", "string"), valueIn("resultVariable", "string")],
  },
  // Generic Activity-queue action (plan §8.3 "desktop.run-activity"):
  // enqueues and runs another Activity definition on a given queue, without
  // the caller needing to know anything about that Activity's own flow.
  runActivity: {
    label: t("legacy.0f72ed20b9d6"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("activityId", "string"), valueIn("queueId", "string"), valueIn("parameters", "array")],
  },
  // Generic event-bus action (plan §8.3 "desktop.emit-event"): lets a
  // blueprint announce a domain-agnostic event other systems can subscribe
  // to, without baking any specific event name into the engine.
  emitEvent: {
    label: t("legacy.bb6bcbd35472"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("eventName", "string"), valueIn("payload")],
  },
  // Generic content-package API boundary. The engine knows only that a
  // blueprint may call a registered API; API IDs and domain meaning belong
  // to the content package.
  callApi: {
    label: t("legacy.d9959e1d286e"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("apiId", "string"), valueIn("payload"), valueIn("resultVariable", "string")],
  },
  playBgm: {
    label: t("node.playBgm"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("bgmId", "string")],
  },
  stopBgm: {
    label: t("node.stopBgm"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
  },
  setBgmVolume: {
    label: t("node.setBgmVolume"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("volume", "number")],
  },
  pushBgmLayer: {
    label: t("node.pushBgmLayer"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("action", "string"), valueIn("bgmId", "string")],
  },
  restoreBgmLayer: {
    label: t("node.restoreBgmLayer"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
  },
  virtualFileSystem: {
    label: t("node.virtualFileSystem"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("operation", "string"), valueIn("arguments", "array"), valueIn("path", "string"), valueIn("source", "string"), valueIn("destination", "string"), valueIn("content", "string"), valueIn("cwd", "string"), valueIn("terminalInstanceId", "string")],
  },
  terminalOutput: {
    label: t("node.terminalOutput"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("terminalInstanceId", "string"), valueIn("text")],
  },
  // Generic database CRUD actions (plan §9.3). Every result is written into
  // `variableStore` under the node's own `resultVariable` input - the same
  // "write into a well-known variable, then read it with getVariable/
  // {variable}" convention already used for widget event values - rather
  // than inventing a second value-output wiring path for side-effecting
  // flow nodes.
  // createRecord follows the generic database action definitions below.
  createRecord: {
    label: t("legacy.01d7074e8aaa"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("data"), valueIn("resultVariable", "string")],
  },
  getRecord: {
    label: t("legacy.9937f7ef9f5a"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("key"), valueIn("resultVariable", "string")],
  },
  updateRecord: {
    label: t("legacy.04a590354c37"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("key"), valueIn("patch"), valueIn("resultVariable", "string")],
  },
  deleteRecord: {
    label: t("legacy.8f22c9908ed4"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("key"), valueIn("resultVariable", "string")],
  },
  findRecords: {
    label: t("legacy.8d11a338921f"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("query"), valueIn("resultVariable", "string")],
  },
  countRecords: {
    label: t("legacy.83be2b31f1e8"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("query"), valueIn("resultVariable", "string")],
  },
  // Pure value nodes: no flow ports at all. They are never flow-stepped by
  // the ActivityRunner; instead they are evaluated on demand whenever
  // another node's value input is wired to one of their value outputs
  // (plan §6.2 value-port wiring). Kept intentionally domain-agnostic
  // (arithmetic + generic variable read) per §15 风险 F.
  arithmetic: {
    label: t("legacy.ec7885eb376d"),
    valueInputs: [valueIn("operator", "string"), valueIn("left"), valueIn("right")],
    valueOutputs: [valueOut("value")],
  },
  valueReceiver: {
    label: t("node.valueReceiver"),
    valueInputs: [valueIn("value")],
  },
  // Ternary value selection (no domain meaning, same "engine stays generic"
  // spirit as `arithmetic`/`branch`): picks `whenTrue`/`whenFalse` based on
  // `condition`, letting a value-graph express e.g. "pick the
  // alphabetically-first of two chosen keyword ids" with only comparison +
  // this node, no dedicated sort/min node.
  conditionalValue: {
    label: t("legacy.923a2dfed0b9"),
    valueInputs: [valueIn("condition", "bool"), valueIn("whenTrue"), valueIn("whenFalse")],
    valueOutputs: [valueOut("value")],
  },
  getVariable: {
    label: t("legacy.f8e5337b5ffe"),
    valueInputs: [valueIn("key", "string")],
    valueOutputs: [valueOut("value")],
  },
  getGlobal: {
    label: t("legacy.f8e5337b5ffe"),
    valueInputs: [valueIn("variableId", "number")],
    valueOutputs: [valueOut("value")],
  },
  // Reads one field off an object value (e.g. a `getRecord`/`findRecords`
  // result stored in variableStore) - the generic counterpart to
  // `getVariable` for structured values, so a widget property can display
  // e.g. a selected patient's `name` without a domain-specific node.
  getProperty: {
    label: t("legacy.8e985c2ca438"),
    valueInputs: [valueIn("value"), valueIn("key", "string")],
    valueOutputs: [valueOut("value")],
  },
  getStructureDefinition: {
    label: t("legacy.9644e3813f1b"),
    valueInputs: [valueIn("structureId", "string")],
    valueOutputs: [valueOut("value", "object")],
  },
  getDatabaseDefinition: {
    label: t("legacy.93d335882077"),
    valueInputs: [valueIn("databaseId", "string")],
    valueOutputs: [valueOut("value", "object")],
  },
  // Pure database read for widget/value bindings. Unlike findRecords (a flow
  // action), this node can feed a list/table property directly.
  findRecordsValue: {
    label: t("legacy.ec6b58250498"),
    valueInputs: [valueIn("databaseId", "string"), valueIn("query")],
    valueOutputs: [valueOut("value", "array")],
  },
  getRecordValue: {
    label: t("legacy.64fd2cb41a6b"),
    valueInputs: [valueIn("databaseId", "string"), valueIn("key")],
    valueOutputs: [valueOut("value", "object")],
  },
  // Generic runtime collection gateway. Domain systems register collections
  // by stable id; the engine does not know achievement/HIS semantics.
  getRuntimeCollection: {
    label: t("legacy.ea05ffcf2cf1"),
    valueInputs: [valueIn("collectionId", "string")],
    valueOutputs: [valueOut("value", "array")],
  },
  getRuntimeRecord: {
    label: t("legacy.5d19d125c946"),
    valueInputs: [valueIn("collectionId", "string"), valueIn("recordId")],
    valueOutputs: [valueOut("value", "object")],
  },
  // Generic join used to combine canonical records with runtime state by id.
  mergeRecords: {
    label: t("legacy.7fd924483907"),
    valueInputs: [valueIn("left", "array"), valueIn("right", "array"), valueIn("keyField", "string")],
    valueOutputs: [valueOut("value", "array")],
  },
  // Appends one item to the end of an array value (treating a missing/
  // non-array input as empty) - the generic counterpart to `arithmetic`
  // for building up a list purely from value-node wiring, e.g. a "add to
  // prescription"/"pick a keyword" button appending to a variableStore
  // array one click at a time with no domain-specific node type.
  arrayAppend: {
    label: t("legacy.4090ada38c26"),
    valueInputs: [valueIn("array"), valueIn("item")],
    valueOutputs: [valueOut("value")],
  },
  // Public-variable nodes (plan §10). These operate on the typed,
  // ID-addressed PublicVariableManager (0..65535, bool/smallInteger/
  // integer/real/string/object) through `pvGateway`, distinct from the
  // generic per-run `variableStore` string-keyed nodes above.
  getPublicVariable: {
    label: t("legacy.232052be43ac"),
    valueInputs: [valueIn("id", "number")],
    valueOutputs: [valueOut("value")],
  },
  getLanguage: {
    label: t("legacy.a2940bd2808e"),
    valueOutputs: [valueOut("value", "string")],
  },
  setLanguage: {
    label: t("legacy.125477fbbed8"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("language", "string")],
  },
  publicVariableCondition: {
    label: t("legacy.f8faae90af41"),
    valueInputs: [valueIn("id", "number"), valueIn("op", "string"), valueIn("value")],
    valueOutputs: [valueOut("value", "bool")],
  },
  applyPublicVariableEffect: {
    label: t("legacy.908400ca4f67"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("id", "number"), valueIn("value"), valueIn("delta", "number"), valueIn("toggle", "bool"), valueIn("setObjectRef")],
  },
  // Generic narrative-display primitive (Phase 8 legacy content migration):
  // announces a line of text through `eventGateway` (same mechanism as
  // `emitEvent` — no "his-app"/"social-app" enum baked in, `displayTo` is an
  // opaque routing string a window/widget subscribes to) and, only when a
  // `continueKey` is wired, blocks exactly like `blockUntil` until that
  // variable becomes truthy (a widget's onClick blueprint sets it), then
  // resets the key and continues. Omitting `continueKey` auto-advances
  // immediately, for non-interactive/automated narration.
  text: {
    label: t("legacy.f3d19e228143"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("speaker", "string"), valueIn("text", "string"), valueIn("displayTo", "string"), valueIn("keywordIds"), valueIn("continueKey", "string")],
  },
  // Generic labeled N-way branch primitive: announces `options` through
  // `eventGateway` for a window/widget to render as buttons, then blocks
  // until `selectionKey` (set by a button's onClick blueprint to the chosen
  // option's index) is a valid integer in [0, optionCount), consumes it
  // (resets to null so a later revisit — e.g. a loop back onto this node —
  // waits for a fresh selection), and branches on the matching `optionN`
  // flow output. `optionN` ports are declared up to a fixed cap (6, well
  // above the legacy corpus's observed max of 3) since Blueprint node types
  // are statically registered; ActivityValidator only requires the first
  // `optionCount` of them to be wired (plan §15 风险 F: still domain-agnostic
  // — nothing here references dialogue/item/medical content).
  choice: {
    label: t("legacy.499802de56f4"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut("option0"), flowOut("option1"), flowOut("option2"), flowOut("option3"), flowOut("option4"), flowOut("option5")],
    valueInputs: [valueIn("options"), valueIn("optionCount", "number"), valueIn("selectionKey", "string"), valueIn("displayTo", "string")],
  },
  // Pure value nodes with no flow ports at all (legacy `prerequisite`/
  // `activityExpiry`, ported 1:1): never flow-stepped by the runner, never
  // wired to another node's value input either — future Activity-selection
  // logic (deciding which entries are offered/still valid) finds the one
  // `prerequisite`/`activityExpiry` node in a definition's blueprint (by
  // type, exactly like the legacy engine's `matchesPrerequisites`/expiry
  // check) and reads its `condition`/`expires`/`expiresAt` inputs directly
  // via the same generic `resolveInput` helper flow nodes already use.
  prerequisite: {
    label: t("legacy.cf1747c9f0ed"),
    valueInputs: [valueIn("condition", "bool")],
  },
  activityExpiry: {
    label: t("legacy.a1fe6159c2f5"),
    valueInputs: [valueIn("expires", "bool"), valueIn("expiresAt", "number")],
  },
  getGameTime: {
    label: t("legacy.812ea53a8728"),
    valueOutputs: [valueOut("value", "number")],
  },
  getParameter: {
    label: t("node.getParameter"),
    valueInputs: [valueIn("id", "number")],
    valueOutputs: [valueOut("value")],
  },
  getActivityInstanceCount: {
    label: t("legacy.137795627288"),
    valueInputs: [valueIn("activityId", "string")],
    valueOutputs: [valueOut("value", "number")],
  },
  getQueueEntryCount: {
    label: t("legacy.765eac64581e"),
    valueInputs: [valueIn("queueId", "string")],
    valueOutputs: [valueOut("value", "number")],
  },
  insertActivity: {
    label: t("legacy.611b518dad60"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("activityId", "string"), valueIn("queue", "string"), valueIn("addTime", "number"), valueIn("parameters", "array")],
  },
  consumeTime: {
    label: t("legacy.611b518dad60"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("minutes", "number")],
  },

  insertSchedule: {
    label: t("legacy.611b518dad60"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("scheduleId", "string"), valueIn("queue", "string"), valueIn("addTime", "number"), valueIn("respectPrerequisite", "bool"), valueIn("protectFromExpiry", "bool")],
  },
  getScheduleInstanceCount: {
    label: t("legacy.137795627288"),
    valueInputs: [valueIn("scheduleId", "string")],
    valueOutputs: [valueOut("value", "number")],
  },
  statOperation: {
    label: t("legacy.908400ca4f67"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("statId", "string"), valueIn("value"), valueIn("delta", "number")],
  },



  segmentBranch: {
    label: t("legacy.38864483be46"),
    flowInputs: [flowIn()],
    flowOutputs: ["default", ...Array.from({ length: 32 }, (_, index) => `segment${index}`)].map(flowOut),
    valueInputs: [valueIn("value", "number"), valueIn("branchCount", "number"), ...Array.from({ length: 33 }, (_, index) => valueIn(`boundary${index}`, "number"))],
  },

  markEventState: {
    label: t("legacy.7d3ff4ae2359"),
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("id", "string")],
  },
};

export const ACTIVITY_NODE_TYPES = Object.freeze(Object.keys(definitions));

export function listActivityNodeTypes() {
  return [...ACTIVITY_NODE_TYPES, ...customDefinitions.keys()];
}

export function registerCustomActivityNode(node) {
  if (!node?.id || !/^[a-zA-Z][\w:-]*$/.test(node.id)) throw new Error(t("error.e595d5709b6b"));
  if (definitions[node.id]) throw new Error(`Cannot replace engine blueprint node: ${node.id}`);
  if (!classifyActivityNodePorts(node)) throw new Error(`Custom blueprint node ${node.id} does not match one of the four node categories`);
  const definition = {
    label: node.label || node.id,
    flowInputs: Array.isArray(node.flowInputs) ? node.flowInputs : [],
    flowOutputs: Array.isArray(node.flowOutputs) ? node.flowOutputs : [],
    valueInputs: Array.isArray(node.valueInputs) ? node.valueInputs : [],
    valueOutputs: Array.isArray(node.valueOutputs) ? node.valueOutputs : [],
    custom: true,
    blueprint: node.blueprint || null,
  };
  customDefinitions.set(node.id, definition);
  return definition;
}

export function classifyActivityNodePorts(nodeOrType) {
  const definition = typeof nodeOrType === "string" ? getActivityNodeDefinition(nodeOrType) : nodeOrType;
  if (!definition) return null;
  const hasFlowInput = Boolean(definition.flowInputs?.length);
  const hasFlowOutput = Boolean(definition.flowOutputs?.length);
  const hasValueInput = Boolean(definition.valueInputs?.length);
  const hasValueOutput = Boolean(definition.valueOutputs?.length);
  if (hasFlowInput && hasValueOutput) return null;
  if (hasFlowInput) return "flow";
  if (hasValueOutput) return "value";
  if (hasFlowOutput && hasValueInput) return null;
  if (hasFlowOutput) return "flowStart";
  if (hasValueInput) return "valueReceiver";
  return null;
}

export function unregisterCustomActivityNode(id) {
  return customDefinitions.delete(id);
}

export function updateCustomActivityNode(node) {
  if (!node?.id || !customDefinitions.has(node.id)) {
    throw new Error(`Cannot update unregistered custom blueprint node: ${node?.id || ""}`);
  }
  if (!classifyActivityNodePorts(node)) {
    throw new Error(`Custom blueprint node ${node.id} does not match one of the four node categories`);
  }
  const current = customDefinitions.get(node.id);
  const updated = {
    ...current,
    label: node.label || node.id,
    flowInputs: Array.isArray(node.flowInputs) ? node.flowInputs : current.flowInputs,
    flowOutputs: Array.isArray(node.flowOutputs) ? node.flowOutputs : current.flowOutputs,
    valueInputs: Array.isArray(node.valueInputs) ? node.valueInputs : current.valueInputs,
    valueOutputs: Array.isArray(node.valueOutputs) ? node.valueOutputs : current.valueOutputs,
    custom: true,
    blueprint: node.blueprint || null,
  };
  customDefinitions.set(node.id, updated);
  return updated;
}

export function listCustomActivityNodes() {
  return [...customDefinitions.entries()].map(([id, definition]) => ({ id, ...definition }));
}

export function isEngineActivityNode(type) {
  return Object.prototype.hasOwnProperty.call(definitions, type);
}

export function getActivityNodeDefinition(type) {
  return definitions[type] || customDefinitions.get(type) || null;
}

export function isFlowNode(type) {
  const def = getActivityNodeDefinition(type);
  return Boolean(def && (def.flowInputs?.length || def.flowOutputs?.length));
}

/** Find a flow port descriptor (direction "input"|"output") by name, or null. Used by the Activity editor + validator so port lookup logic lives in one place. */
export function findFlowPort(type, direction, name) {
  const def = getActivityNodeDefinition(type);
  const list = direction === "input" ? def?.flowInputs : def?.flowOutputs;
  return (list || []).find((port) => port.name === name) || null;
}

/** Find a value port descriptor (direction "input"|"output") by name, or null. */
export function findValuePort(type, direction, name) {
  const def = getActivityNodeDefinition(type);
  const list = direction === "input" ? def?.valueInputs : def?.valueOutputs;
  return (list || []).find((port) => port.name === name) || null;
}

/**
 * Find any port (flow or value, direction "input"|"output") by name. This is
 * the one lookup the editor + validator should use when a connection could
 * legally be either kind, since a plain findFlowPort() lookup would silently
 * report "no such port" for a value port with the same name.
 */
export function getActivityNodePort(type, direction, name) {
  return findFlowPort(type, direction, name) || findValuePort(type, direction, name);
}

/** All ports of a node in a given direction (flow first, then value), in stable declaration order. Used by the editor to lay out port rows. */
export function listActivityNodePorts(type, direction) {
  const def = getActivityNodeDefinition(type);
  if (!def) return [];
  return direction === "input" ? [...(def.flowInputs || []), ...(def.valueInputs || [])] : [...(def.flowOutputs || []), ...(def.valueOutputs || [])];
}

/**
 * Two ports are connectable only if their `kind` matches (flow-to-flow,
 * value-to-value) and, for value ports, their `type` matches unless either
 * side declares "any". Flow ports carry no `type`, so kind equality alone
 * is sufficient for them (§6.3 "端口类型兼容").
 */
export function arePortsCompatible(portA, portB) {
  if (!portA || !portB) return false;
  if (portA.kind !== portB.kind) return false;
  if (portA.kind === VALUE && portA.type !== "any" && portB.type !== "any" && portA.type !== portB.type) return false;
  return true;
}

export default definitions;
