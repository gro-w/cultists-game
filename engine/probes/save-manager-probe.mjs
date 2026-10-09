import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "./register-framework-nodes.mjs";
import EventBus from "../core/EventBus.js";
import { GameClock } from "../core/GameClock.js";
import { VariableStore } from "../core/VariableStore.js";
import { PublicVariableManager } from "../core/PublicVariableManager.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { WindowManager } from "../core/WindowManager.js";
import { DesktopIconManager } from "../core/DesktopIconManager.js";
import { KeywordManager } from "../core/KeywordManager.js";
import { OnboardingManager } from "../core/OnboardingManager.js";
import { ACTIVITY_EVENTS } from "../core/ActivityEvents.js";
import { SaveManager } from "../core/SaveManager.js";
import { VirtualFileSystem } from "../core/VirtualFileSystem.js";

const filesystemDefaults = JSON.parse(await readFile(new URL("../../data/virtual-filesystem.json", import.meta.url), "utf8"));


// A branch/blockUntil Activity that consumes time once, then waits forever
// for an "approved" variable - used to exercise "等待中的 Activity...一致"
// (plan §13 Phase 7 acceptance).
const waitingDefinition = {
  id: "waiting",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      spendTime: { id: "spendTime", type: "framework:consumeTime", inputs: { minutes: 20 } },
      wait: { id: "wait", type: "blockUntil", inputs: { key: "approved", equals: true } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "spendTime", toPort: "flowIn" },
      { fromNodeId: "spendTime", fromPort: "flowOut", toNodeId: "wait", toPort: "flowIn" },
      { fromNodeId: "wait", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  },
};

const breakpointDefinition = {
  id: "breakpoint-save-restore",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      effect: { id: "effect", type: "setVariable", inputs: { key: "breakpoint.effect", value: 42 } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "effect", toPort: "flowIn" },
      { fromNodeId: "effect", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  },
};

function makeSession({ windowStateFilter = () => true } = {}) {
  const eventBus = new EventBus();
  const gameClock = new GameClock(eventBus);

  const variableStore = new VariableStore(eventBus);
  const publicVariableManager = new PublicVariableManager(null, eventBus);
  publicVariableManager.loadDefinitions([
    { id: 1, name: "playerSan", type: "integer", persistent: true, defaultValue: 100 },
  ]);
  const dataStructureManager = new DataStructureManager();
  dataStructureManager.register({ id: "note", fields: [{ id: "text", type: "string" }] });
  dataStructureManager.register({ id: "keyword", fields: [{ id: "id", type: "string" }, { id: "content", type: "string" }] });
  const dataStore = new DataStore(dataStructureManager);
  dataStore.registerDatabase({ databaseId: "notes", recordType: "note" });
  dataStore.registerDatabase({ databaseId: "keywords", recordType: "keyword" });
  dataStore.createRecord("keywords", { id: "fever", content: "发热" });
  const activityDefinitionStore = new ActivityDefinitionStore();
  activityDefinitionStore.register(waitingDefinition);
  activityDefinitionStore.register(breakpointDefinition);
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);
  const windowManager = new WindowManager(eventBus, { storage: { getItem: () => null, setItem: () => {} } });
  const desktopIconManager = new DesktopIconManager();
  const virtualFileSystem = new VirtualFileSystem(filesystemDefaults, eventBus);
  const keywordManager = new KeywordManager({ dataStore, eventBus });
  const onboardingManager = new OnboardingManager({ eventBus });

  function runActivity(activityId, queueId = "main", parameters = []) {
    const queue = activityQueueRegistry.get(queueId);
    const definition = activityDefinitionStore.get(activityId);
    if (!queue || !definition) return null;
    const instance = queue.append({ activityId, parameters });
    activityExecutionService.run({
      queue,
      definition,
      instance,
      variableStore,
      timeGateway: (minutes) => gameClock.advance(minutes),
      apiGateway: { call: (apiId, payload) => { if (apiId === "engine.consumeTime") return gameClock.advance(payload.minutes); throw new Error(`Unexpected API ${apiId}`); } },
      dbGateway: dataStore,
      pvGateway: publicVariableManager,
    });
    return instance;
  }

  function resumePendingActivities() {
    activityQueueRegistry.list().forEach((queue) => {
      const pausedInstances = queue.list({ status: "paused" });
      const candidates = pausedInstances.length ? pausedInstances : [queue.current()].filter(Boolean);
      candidates.forEach((instance) => {
        const definition = activityDefinitionStore.get(instance.activityId);
        if (!definition) return;
        activityExecutionService.run({
          queue,
          definition,
          instance,
          variableStore,
          timeGateway: (minutes) => gameClock.advance(minutes),
          apiGateway: { call: (apiId, payload) => { if (apiId === "engine.consumeTime") return gameClock.advance(payload.minutes); throw new Error(`Unexpected API ${apiId}`); } },
          dbGateway: dataStore,
          pvGateway: publicVariableManager,
        });
      });
    });
  }

  const saveManager = new SaveManager({
    gameClock,

    variableStore,
    publicVariableManager,
    dataStore,
    activityQueueRegistry,
    windowManager,
    virtualFileSystem,
    windowStateFilter,
    stateProviders: { keywords: keywordManager },
    saveableVariable: (key) => !["calendar:days", "achievements:items", "event:value", "query:records"].includes(key)
      && !String(key).startsWith("gameState:")
      && !String(key).startsWith("__"),
    onboardingManager,
    activityExecutionService,
    resumePendingActivities,
  });

  return {
    eventBus, gameClock, variableStore, publicVariableManager, dataStructureManager, dataStore,
    activityDefinitionStore, activityQueueRegistry, activityExecutionService, windowManager,
    desktopIconManager, virtualFileSystem, keywordManager, onboardingManager, saveManager, runActivity,
  };
}

// --- round trip: new/save/refresh/load state stays consistent ---------------
{
  const session = makeSession();
  session.gameClock.advance(90); // Day 1 01:30
  session.publicVariableManager.set(1, 42);
  session.variableStore.set("calendar:days", [{ id: 1, label: "第 1 天" }]);
  session.variableStore.set("achievements:items", [{ id: "study_first", name: "题之意志" }]);
  session.variableStore.set("query:records", [{ id: "patient-1", name: "游戏数据" }]);
  session.dataStore.createRecord("notes", { id: "n1", text: "hello" });
  session.windowManager.open({ id: "inventory", title: "Inventory", width: 300, height: 200 });
  session.virtualFileSystem.createFile("/home/desktop/save-probe.txt", "saved in the virtual disk");
  session.keywordManager.collect("fever", 1);
  session.onboardingManager.markMilestone("his_opened");
  const instance = session.runActivity("waiting", "main", ["saved-argument", 27]);

  // Waiting mid-flow before saving.
  assert.equal(session.activityQueueRegistry.get("main").get(instance.instanceId).status, "unresolved");
  assert.equal(session.activityQueueRegistry.get("main").get(instance.instanceId).waitingNodeId, "wait");

  const saved = session.saveManager.snapshot();
  assert.equal(saved.format, "cultists-ng-save");
  assert.equal(saved.version, 9);
  assert.equal(saved.createdAtGameTime, 110);
  assert.equal(Object.hasOwn(saved.state, "databases"), false, "game data must not be embedded in saves");
  assert.equal(Object.hasOwn(saved.state, "desktopIcons"), false, "desktop launchers live in the filesystem, not a parallel save payload");
  assert.equal(saved.state.virtualFileSystem.entries.find((entry) => entry.path === "/home/desktop/save-probe.txt").content, "saved in the virtual disk");
  assert.deepEqual(saved.state.queues.main[0].parameters, ["saved-argument", 27], "Activity arguments are included in the SaveManager snapshot");
  assert.equal(Object.hasOwn(saved.state.variables, "calendar:days"), false, "derived calendar UI data must not be saved");
  assert.equal(Object.hasOwn(saved.state.variables, "achievements:items"), false, "derived achievement UI data must not be saved");
  assert.equal(Object.hasOwn(saved.state.variables, "query:records"), false, "database result arrays must not be saved");

  // Fresh "reloaded" session, as if the page refreshed.
  const restoredSession = makeSession();
  let terminalCount = 0;
  restoredSession.eventBus.on(ACTIVITY_EVENTS.completed, () => { terminalCount += 1; });
  restoredSession.saveManager.restore(saved);

  assert.deepEqual(restoredSession.gameClock.snapshot(), { day: 1, minutes: 110 });
  assert.equal(restoredSession.publicVariableManager.get(1), 42);
  assert.equal(restoredSession.dataStore.getRecord("notes", "n1"), null, "runtime database records must not be restored from saves");
  const restoredWindow = restoredSession.windowManager.getByWindowId("inventory");
  assert.ok(restoredWindow, "window instance must survive restore");
  assert.equal(restoredWindow.width, 300);
  assert.equal(restoredSession.virtualFileSystem.readFile("/home/desktop/save-probe.txt"), "saved in the virtual disk");
  assert.ok(restoredSession.keywordManager.has("fever"), "collected keyword must survive restore");
  assert.equal(restoredSession.keywordManager.get("fever").collectedDay, 1);
  assert.ok(restoredSession.onboardingManager.hasMilestone("his_opened"), "onboarding milestone must survive restore");

  // The waiting Activity instance resumed automatically (single post-restore
  // scan) and is still correctly blocked - object identity/consistency
  // across restore (plan §13 Phase 7 acceptance).
  const restoredInstance = restoredSession.activityQueueRegistry.get("main").get(instance.instanceId);
  assert.deepEqual(restoredInstance.parameters, ["saved-argument", 27], "Activity arguments survive SaveManager restore");
  assert.equal(restoredInstance.status, "unresolved");
  assert.equal(restoredInstance.waitingNodeId, "wait");
  assert.equal(terminalCount, 0);

  // Satisfying the wait condition now resumes to completion exactly once.
  restoredSession.variableStore.set("approved", true);
  assert.equal(restoredSession.activityQueueRegistry.get("main").get(instance.instanceId).status, "resolved");
  assert.equal(terminalCount, 1);
}

// --- breakpoint progress survives the actual SaveManager restore path ------
{
  const developerSession = makeSession();
  developerSession.virtualFileSystem.allowCoreOnlyEntries = true;
  developerSession.virtualFileSystem.injectCoreEntries([
    { path: "/home/desktop/开发人员模式", type: "file", content: "dev-mode-launcher" },
  ]);
  developerSession.windowManager.open({ id: "dev-mode-launcher", title: "Developer mode" });
  developerSession.windowManager.open({ id: "inventory", title: "Inventory" });
  const save = developerSession.saveManager.snapshot();
  assert.ok(save.state.windows.some((window) => window.windowId === "dev-mode-launcher"), "developer-mode session retains its core-owned windows");

  const regularSession = makeSession({ windowStateFilter: (window) => !window.windowId.startsWith("dev-") });
  regularSession.saveManager.restore(save);
  assert.equal(regularSession.virtualFileSystem.exists("/home/desktop/开发人员模式"), false);
  assert.equal(regularSession.windowManager.getByWindowId("dev-mode-launcher"), null, "ordinary restores filter developer-only windows");
  assert.ok(regularSession.windowManager.getByWindowId("inventory"), "ordinary windows still restore");
  assert.ok(regularSession.saveManager.snapshot().state.windows.every((window) => !window.windowId.startsWith("dev-")), "ordinary saves omit developer-only windows");

  const reloadedDeveloperSession = makeSession();
  reloadedDeveloperSession.virtualFileSystem.allowCoreOnlyEntries = true;
  reloadedDeveloperSession.virtualFileSystem.injectCoreEntries([
    { path: "/home/desktop/开发人员模式", type: "file", content: "dev-mode-launcher" },
  ]);
  reloadedDeveloperSession.saveManager.restore(save);
  assert.equal(reloadedDeveloperSession.virtualFileSystem.readFile("/home/desktop/开发人员模式"), "dev-mode-launcher");
  assert.ok(reloadedDeveloperSession.windowManager.getByWindowId("dev-mode-launcher"), "developer restores retain core-owned windows");
}

// --- breakpoint progress survives the actual SaveManager restore path ------
{
  const session = makeSession();
  const queue = session.activityQueueRegistry.get("main");
  const definition = session.activityDefinitionStore.get("breakpoint-save-restore");
  const instance = queue.append({ activityId: definition.id });
  assert.equal(session.activityExecutionService.update(queue, instance.instanceId, { breakpointNodeIds: ["effect"] }), true);
  session.activityExecutionService.run({
    queue,
    definition,
    instance,
    variableStore: session.variableStore,
    timeGateway: (minutes) => session.gameClock.advance(minutes),
  });
  assert.equal(instance.status, "paused");
  assert.equal(instance.currentNodeId, "effect");
  assert.equal(session.variableStore.get("breakpoint.effect"), undefined);
  const queuedInstance = queue.append({ activityId: definition.id });
  const saved = session.saveManager.snapshot();

  const restored = makeSession();
  restored.saveManager.restore(saved);
  const restoredQueue = restored.activityQueueRegistry.get("main");
  const restoredInstance = restoredQueue.get(instance.instanceId);
  assert.deepEqual(restoredInstance.breakpointNodeIds, ["effect"]);
  assert.equal(restoredInstance.pausedAtBreakpointId, "effect");
  assert.equal(restoredInstance.currentNodeId, "effect");
  assert.deepEqual(restoredInstance.executionTrace, instance.executionTrace);
  assert.ok(restored.activityExecutionService.get(instance.instanceId), "restore must reattach paused runners");
  assert.equal(restored.activityExecutionService.get(queuedInstance.instanceId), null, "a paused queue head must keep later entries from starting");
  assert.equal(restoredQueue.get(queuedInstance.instanceId).status, "unresolved");
  assert.equal(restored.variableStore.get("breakpoint.effect"), undefined);
  assert.equal(restored.activityExecutionService.update(restoredQueue, instance.instanceId, { status: "unresolved" }), true);
  assert.equal(restored.variableStore.get("breakpoint.effect"), 42);
  assert.equal(restoredInstance.status, "resolved");
  assert.equal(restoredInstance.executionTrace.filter((step) => step.nodeId === "effect" && step.status === "executed").length, 1);
}

// --- a corrupt/invalid save must not overwrite current valid state ----------
{
  const session = makeSession();
  session.gameClock.advance(60);
  session.publicVariableManager.set(1, 7);
  const before = session.saveManager.snapshot();

  assert.throws(() => session.saveManager.restore(null), /valid object/);
  assert.throws(() => session.saveManager.restore({ format: "something-else" }), /Unknown save format/);
  assert.throws(() => session.saveManager.restore({ format: "cultists-ng-save", version: 999 }), /Unsupported save version/);
  assert.throws(() => session.saveManager.restore({ format: "cultists-ng-save", version: 8 }), /Unsupported save version/);
  assert.throws(() => session.saveManager.restore({ format: "cultists-ng-save", version: 3 }), /Unsupported save version/);

  // A structurally-valid-looking envelope with an internally-inconsistent
  // window snapshot (duplicate instanceId) must roll back cleanly.
  const bad = session.saveManager.snapshot();
  bad.state.windows = [
    { instanceId: "dup", windowId: "a" },
    { instanceId: "dup", windowId: "b" },
  ];
  assert.throws(() => session.saveManager.restore(bad), /duplicate/i);

  // None of the failed restores mutated the live session's state.
  assert.deepEqual(session.gameClock.snapshot(), { day: 1, minutes: 60 });
  assert.equal(session.publicVariableManager.get(1), 7);
  assert.deepEqual(session.saveManager.snapshot().state.windows, before.state.windows);
}

// --- re-entrant restore is rejected instead of racing ------------------------
{
  const session = makeSession();
  const saved = session.saveManager.snapshot();
  session.saveManager._restoring = true;
  assert.throws(() => session.saveManager.restore(saved), /already in progress/);
  session.saveManager._restoring = false;
}

console.log("save-manager-probe: all scenarios passed");
