import assert from "node:assert/strict";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { ActivityQueue } from "../core/ActivityQueue.js";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { getActivityNodeDefinition } from "../core/ActivityNodeRegistry.js";
import { AppProgramRegistry } from "../core/AppProgramRegistry.js";
import { AppProgramManagerView } from "../dev/AppProgramManagerView.js";
import { evaluateValueOutput } from "../core/ActivityRunner.js";

const eventBus = new EventBus();
const appRegistry = new AppProgramRegistry({ version: 1, defaultProgramIcon: "⚙️", programs: [
  { id: "document-task", title: "Document task", icon: "📝", kind: "activity", target: "read-args", parameters: ["document.txt", 41] },
  { id: "document-window", title: "Document editor", icon: "📝", kind: "window", target: "document", parameters: ["default.txt"] },
] });
assert.deepEqual(appRegistry.get("document-task").parameters, ["document.txt", 41], "Activity app definitions keep their argument arrays");
assert.deepEqual(appRegistry.getActivityParameters("document-task"), ["document.txt", 41]);
assert.deepEqual(appRegistry.getActivityParameters("document-task", ["from-shell"]), ["document.txt", 41, "from-shell"]);
assert.deepEqual(appRegistry.getActivityParameters("missing"), [], "window/missing apps do not yield Activity arguments");
assert.deepEqual(appRegistry.getWindowParameters("document-window"), ["default.txt"], "window apps use configured arguments when no invocation arguments are supplied");
assert.deepEqual(appRegistry.getWindowParameters("document-window", ["opened.txt"]), ["opened.txt"], "invocation arguments override window defaults");
assert.equal(AppProgramRegistry.validateDocument({ version: 1, defaultProgramIcon: "⚙️", programs: [
  { id: "window-with-arguments", title: "Document", icon: "📝", kind: "window", target: "document", parameters: ["ignored"] },
] }), true, "window app definitions may carry launch arguments");
class MockElement {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.handlers = new Map(); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  setAttribute() {}
  fire(type) { this.handlers.get(type)?.(); }
}
const originalDocument = globalThis.document;
globalThis.document = { createElement: (tagName) => new MockElement(tagName) };
try {
  const manager = new AppProgramManagerView({
    appRegistry,
    dataLoader: {},
    windowDefinitionStore: { get: (id) => ["terminal", "document"].includes(id) ? { id } : null },
    activityDefinitionStore: { get: (id) => id === "read-args" ? { id } : null },
  });
  const descendants = (element) => [element, ...element.children.flatMap(descendants)];
  const parameterEditors = descendants(manager.el).filter((element) => element.tagName === "textarea");
  const parameterEditor = parameterEditors[1];
  const windowParameterEditor = parameterEditors.at(-1);
  assert.equal(parameterEditors.length, 3, "the default app and both registered apps expose launch argument arrays");
  parameterEditor.value = "not-json";
  parameterEditor.fire("input");
  assert.throws(() => manager.validate(), /启动参数必须是有效的 JSON 数组/);
  parameterEditor.value = '["edited.txt", 7]';
  parameterEditor.fire("input");
  assert.equal(manager.validate(), true, "valid Activity argument arrays pass editor validation");
  windowParameterEditor.value = '["opened.txt"]';
  windowParameterEditor.fire("input");
  assert.equal(manager.validate(), true, "valid window launch arguments pass editor validation");
  const serialized = JSON.parse(manager.serialized());
  assert.deepEqual(serialized.programs[0].parameters, ["edited.txt", 7]);
  assert.deepEqual(serialized.programs[1].parameters, ["opened.txt"]);
  assert.equal(serialized.defaultProgram.target, "terminal", "the fallback app is an editable canonical launch definition");
  appRegistry.replaceDocument(serialized);
  assert.deepEqual(appRegistry.getActivityParameters("document-task"), ["edited.txt", 7], "edited arguments become the app launch defaults");
  assert.deepEqual(appRegistry.getWindowParameters("document-window"), ["opened.txt"], "edited window arguments persist");
} finally { globalThis.document = originalDocument; }
const variables = new VariableStore(eventBus);
const definitions = new ActivityDefinitionStore();
const execution = new ActivityExecutionService(eventBus, { activityDefinitionStore: definitions });
const queue = new ActivityQueue("main");
const child = {
  id: "read-args",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      argument: { id: "argument", type: "getParameter", inputs: { id: 0 } },
      secondArgument: { id: "secondArgument", type: "getParameter", inputs: { id: 1 } },
      missingArgument: { id: "missingArgument", type: "getParameter", inputs: { id: 9 } },
      saveArgument: { id: "saveArgument", type: "setVariable", inputs: { key: "argument:first" } },
      saveSecond: { id: "saveSecond", type: "setVariable", inputs: { key: "argument:second" } },
      saveMissing: { id: "saveMissing", type: "setVariable", inputs: { key: "argument:missing" } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "saveArgument", toPort: "flowIn" },
      { fromNodeId: "argument", fromPort: "value", toNodeId: "saveArgument", toPort: "value" },
      { fromNodeId: "saveArgument", fromPort: "flowOut", toNodeId: "saveSecond", toPort: "flowIn" },
      { fromNodeId: "secondArgument", fromPort: "value", toNodeId: "saveSecond", toPort: "value" },
      { fromNodeId: "saveSecond", fromPort: "flowOut", toNodeId: "saveMissing", toPort: "flowIn" },
      { fromNodeId: "missingArgument", fromPort: "value", toNodeId: "saveMissing", toPort: "value" },
      { fromNodeId: "saveMissing", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  },
};

definitions.register(child);
assert.deepEqual(getActivityNodeDefinition("getParameter").valueInputs.map(({ name }) => name), ["id"]);
assert.deepEqual(getActivityNodeDefinition("getParameter").valueOutputs.map(({ name }) => name), ["value"]);

const received = queue.append({ activityId: child.id, currentNodeId: "start", parameters: ["document.txt", 41] });
const snapshot = queue.snapshot();
const restoredQueue = new ActivityQueue("main");
restoredQueue.restore(snapshot);
const restoredInstance = restoredQueue.current();
assert.deepEqual(restoredInstance.parameters, ["document.txt", 41]);
assert.notEqual(restoredInstance.parameters, received.parameters, "restored arguments are instance-owned clones");
execution.run({ queue: restoredQueue, definition: definitions.get(child.id), instance: restoredInstance, variableStore: variables });
assert.equal(variables.get("argument:first"), "document.txt", "getParameter(id=0) reads the first argument");
assert.equal(variables.get("argument:second"), 41, "getParameter(id=1) reads the second argument");
assert.equal(variables.get("argument:missing"), undefined, "out-of-range parameter indexes produce undefined");
assert.equal(evaluateValueOutput(child.blueprint, "secondArgument", "value", variables, new Set(), null, null, null, restoredInstance), 41, "the generic evaluator also uses the current Activity instance");

function parentDefinition(type, parameters) {
  const queueNode = type === "insertActivity" ? "queue" : "queueId";
  return {
    id: `parent-${type}`,
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        create: { id: "create", type, inputs: { activityId: child.id, [queueNode]: "main", parameters } },
        end: { id: "end", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "create", toPort: "flowIn" },
        { fromNodeId: "create", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
      ],
    },
  };
}

for (const [type, args] of [["runActivity", ["from-run-node", 2]], ["insertActivity", ["from-insert-node", 3]]]) {
  const parent = definitions.register(parentDefinition(type, args));
  const parentInstance = queue.append({ activityId: parent.id, currentNodeId: "start" });
  let forwarded;
  execution.run({ queue, definition: parent, instance: parentInstance, variableStore: variables, activityGateway: (...callArgs) => { forwarded = callArgs; } });
  assert.equal(forwarded[0], child.id);
  assert.deepEqual(forwarded[5], args, `${type} forwards its parameters array`);
}

const legacyQueue = new ActivityQueue("legacy");
legacyQueue.restore([{ instanceId: "old:1", activityId: "old", queueId: "legacy", status: "unresolved" }]);
assert.deepEqual(legacyQueue.current().parameters, [], "old saved instances restore with an empty parameter list");

console.log("activity-parameters-probe: instance snapshots, getParameter, and runActivity/insertActivity argument forwarding passed");
