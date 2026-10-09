/**
 * NG platform entry point.
 *
 * This module contains only the four NG capabilities: desktop/windows,
 * blueprint Activities, save/restore, and the development-mode hook. Game
 * semantics are data in data/ and are scheduled by the default Activity.
 */
import { eventBus } from "./EventBus.js";
import { DataLoader } from "./DataLoader.js";
import { WindowManager } from "./WindowManager.js";
import { WindowDefinitionStore } from "./WindowDefinitionStore.js";
import { DesktopShell } from "./desktopDesktopShell.js";
import { VariableStore } from "./VariableStore.js";
import { ActivityDefinitionStore } from "./ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "./ActivityQueueRegistry.js";
import { ActivityExecutionService } from "./ActivityExecutionService.js";
import { ActivityQueueConsumer } from "./ActivityQueueConsumer.js";
import { ACTIVITY_EVENTS } from "./ActivityEvents.js";
import { validateBlueprint } from "./ActivityValidator.js";
import { GameClock } from "./GameClock.js";
import { TimeService } from "./TimeService.js";
import { StateBoundaryService } from "./StateBoundaryService.js";
import { DesktopIconManager } from "./DesktopIconManager.js";
import { VirtualFileSystem } from "./VirtualFileSystem.js";
import { registerVirtualFileSystemCapabilities } from "./VirtualFileSystemCapabilities.js";
import { AppProgramRegistry } from "./AppProgramRegistry.js";
import { createVirtualFileWidgetFactories } from "./VirtualFileWidgets.js";
import { buildBuiltinIconBlueprint } from "./BuiltinIconBlueprints.js";
import { DataStructureManager } from "./DataStructureManager.js";
import { DataStore } from "./DataStore.js";
import { PublicVariableManager } from "./PublicVariableManager.js";
import { LocalVariableManager } from "./LocalVariableManager.js";
import { RuntimeRefResolver } from "./RuntimeRefResolver.js";
import { SaveManager } from "./SaveManager.js";
import { EventStateRegistry } from "./EventStateRegistry.js";
import { RuntimeCollectionRegistry } from "./RuntimeCollectionRegistry.js";
import { TextChoiceWidget } from "./TextChoiceWidget.js";
import { evaluateCondition } from "./ConditionEvaluator.js";
import { evaluateActivityAvailability } from "./ActivityAvailabilityEvaluator.js";
import { DisplayReceiverRegistry } from "./DisplayReceiverRegistry.js";
import { registerCustomActivityNode } from "./ActivityNodeRegistry.js";
import { createApiRegistry } from "./engine-api.js";
import { EventActivityRouter } from "./EventActivityRouter.js";
import { I18nManager } from "./i18n/I18nManager.js";
import { setActiveI18nManager } from "./i18n/index.js";
import { t } from "./i18n/index.js";
import { AudioPlaybackService } from "./AudioPlaybackService.js";
import { TutorialOverlay } from "./desktopTutorialOverlay.js";
import { setAssetRoot } from "./AssetPath.js";

export function isDevEntry(search = typeof location !== "undefined" ? location.search : "") {
  return search === "?dev";
}

export async function bootstrap(rootEl, { dataRoot } = {}) {
  if (typeof dataRoot !== "string" || !dataRoot) throw new Error("Engine bootstrap requires an explicit dataRoot");
  const location = dataRoot.endsWith("/") ? dataRoot : `${dataRoot}/`;
  const configuredDataRoot = new URL(location, globalThis.document?.baseURI || import.meta.url).href;
  const dataLoader = new DataLoader({ root: configuredDataRoot });
  const windowManager = new WindowManager(eventBus);
  const windowDefinitions = new WindowDefinitionStore(dataLoader);
  const config = await dataLoader.loadJSON("game-manifest.json");
  if (config.contentRoot) dataLoader.setRoot(new URL(config.contentRoot, configuredDataRoot).href);
  setAssetRoot(dataLoader.root);
  const frameworkManifest = await dataLoader.loadJSON(config.frameworkManifest, { optional: true }) || {};
  const mediaData = await dataLoader.loadJSON("media.json", { optional: true }) || {};
  const resources = {
    media: new Map((mediaData.cgEntries || []).map((entry) => [String(entry.id), entry])),
  };
  if (isDevEntry() && await dataLoader.detectDevServer()) {
    dataLoader.connectChangeEvents({ onChange: (payload) => eventBus.emit("data:changed", payload) });
  }
  const appDefinitions = await dataLoader.loadJSON(config.appDefinitions || "app-definitions.json");
  const appRegistry = new AppProgramRegistry(appDefinitions, eventBus);
  const filesystemDefaults = await dataLoader.loadJSON(config.virtualFileSystem || "virtual-filesystem.json");
  const customBlueprintNodes = await dataLoader.loadJSON(frameworkManifest.documents?.blueprintNodes || config.blueprintNodes, { optional: true }) || [];
  customBlueprintNodes.forEach((node) => registerCustomActivityNode(node));
  await windowDefinitions.loadManifest(config.windowManifest, "windows/");
  const initialState = config.initialState || {};
  const gameClock = new GameClock(eventBus, {
    day: initialState.day,
    minutes: initialState.clockMinutes ?? initialState.minutes ?? 480,
  });
  const timeService = new TimeService(gameClock, eventBus);
  const stateBoundary = new StateBoundaryService({
    gameClock,
    timeService,
    eventBus,
    initialState,
    rules: config.stateBoundary?.rules || {},
  });
  const variableStore = new VariableStore(eventBus);
  const audioPlayback = new AudioPlaybackService({ dataLoader, variableStore });
  await audioPlayback.mount("bgm.json");
  const i18n = new I18nManager({ eventBus, language: config.language || "zh-cn", supportedLanguages: config.supportedLanguages });
  setActiveI18nManager(i18n);
  const virtualFileSystem = new VirtualFileSystem(filesystemDefaults, eventBus);
  /* DEV-TOOLS:START */
  if (isDevEntry()) {
    if (appDefinitions.programs?.some((program) => program.id === "dev-mode-launcher")
      || filesystemDefaults.entries?.some((entry) => entry.metadata?.coreOnly === true
        || ["/opt/dev-mode-launcher", "/home/desktop/开发人员模式.lnk", "/home/desktop/开发人员模式"].includes(entry.path))) {
      throw new Error("Developer-mode program and filesystem entries must be injected by core, not declared in data");
    }
    virtualFileSystem.allowCoreOnlyEntries = true;
    appRegistry.registerCoreProgram({ id: "dev-mode-launcher", title: t("legacy.5e276d748766"), icon: "🛠️", kind: "window", target: "dev-mode-launcher" });
    virtualFileSystem.injectCoreEntries([
      { path: "/home/desktop/开发人员模式", type: "file", content: "dev-mode-launcher", metadata: { coreOnly: true, position: { x: 172, y: 8 } } },
    ]);
  }
  /* DEV-TOOLS:END */
  Object.entries(config.initialVariables || {}).forEach(([key, value]) => {
    variableStore.set(key, value);
  });
  const syncStateBoundaryVariables = ({ current } = {}) => {
    if (current && typeof current.location === "string") {
      variableStore.set("stateBoundary:location", current.location);
      variableStore.set("gameState:location", current.location);
    }
    if (current && Number.isFinite(Number(current.day))) variableStore.set("gameState:day", Number(current.day));
  };
  eventBus.on("stateBoundary:changed", syncStateBoundaryVariables);
  syncStateBoundaryVariables({ current: stateBoundary.snapshot() });
  const structures = new DataStructureManager();
  const dataStore = new DataStore(structures);
  const refResolver = new RuntimeRefResolver();
  const publicVariables = new PublicVariableManager(refResolver, eventBus);
  const localVariables = new LocalVariableManager(eventBus);
  variableStore.publicVariableGateway = publicVariables;
  const eventStateConfig = frameworkManifest.documents?.eventState || {};
  const eventState = new EventStateRegistry({ eventBus, events: eventStateConfig.events });
  if (eventStateConfig.data || config.onboarding) {
    const definitions = await dataLoader.loadJSON(eventStateConfig.data || config.onboarding, { optional: true });
    if (definitions) eventState.loadDefinitions(definitions);
  }
  eventState.bindTriggers(config.onboardingTriggers || frameworkManifest.documents?.eventState?.triggers || {});
  const tutorialOverlay = config.tutorialOverlay === true && typeof document !== "undefined"
    ? new TutorialOverlay({ eventBus, onboardingManager: eventState })
    : null;
  if (frameworkManifest.documents?.structures || config.structures) {
    const value = await dataLoader.loadJSON(frameworkManifest.documents?.structures || config.structures, { optional: true });
    if (value) structures.loadDefinitions(value);
  }
  if (frameworkManifest.documents?.databases || config.databases) {
    const value = await dataLoader.loadJSON(frameworkManifest.documents?.databases || config.databases, { optional: true });
    if (value) dataStore.loadDefinitions(value);
  }
  if (frameworkManifest.documents?.publicVariables || config.publicVariables) {
    const value = await dataLoader.loadJSON(frameworkManifest.documents?.publicVariables || config.publicVariables, { optional: true });
    if (value) publicVariables.loadDefinitions(value);
  }
  const localVariableDocument = frameworkManifest.documents?.localVariables || config.localVariables;
  if (localVariableDocument) {
    const value = await dataLoader.loadJSON(localVariableDocument, { optional: true });
    if (value) localVariables.loadDefinitions(value);
  }
  publicVariables.registerSyncSource("gameClock.totalMinutes", () => (gameClock.day - 1) * 1440 + gameClock.minutes);
  publicVariables.syncFromSources();
  eventBus.on("gameClock:changed", () => publicVariables.syncFromSources());
  const seedFiles = [
    ...(config.seedRecords ? (Array.isArray(config.seedRecords) ? config.seedRecords : [config.seedRecords]) : []),
    ...(config.deferredSeedRecords ? (Array.isArray(config.deferredSeedRecords) ? config.deferredSeedRecords : [config.deferredSeedRecords]) : []),
  ];
  for (const file of seedFiles) {
    const value = await dataLoader.loadJSON(file, { optional: true });
    if (value) dataStore.loadRecordSet(value);
  }
  for (const { databaseId } of dataStore.listDatabases()) {
    refResolver.register(`database:${databaseId}`, (key) => dataStore.getRecord(databaseId, key));
  }
  const queues = new ActivityQueueRegistry(eventBus);
  for (const definition of config.queues || []) {
    if (definition?.id) queues.register(definition.id, { nonBlocking: Boolean(definition.nonBlocking) });
  }
  const frameworkRuntimeDefinition = await dataLoader.loadJSON(frameworkManifest.documents?.runtimeCollections || config.frameworkCollections, { optional: true }) || {};
  const runtimeCollections = new RuntimeCollectionRegistry({
    dataStore,
    eventBus,
    variableStore,
    activityQueueRegistry: queues,
    publicVariableManager: publicVariables,
    publicStateVariableId: frameworkRuntimeDefinition.publicStateVariableId ?? null,
    gameClock,
  });
  runtimeCollections.loadDefinitions(frameworkRuntimeDefinition.collections || {});
  eventBus.on("activity:appended", () => eventBus.emit("runtime:collection-changed", { collectionId: "activity-queues" }));
  eventBus.on("activity:changed", () => eventBus.emit("runtime:collection-changed", { collectionId: "activity-queues" }));
  const runtimeGateway = {
    getCollection: (collectionId) => runtimeCollections.get(collectionId),
    getRecord: (collectionId, recordId) => runtimeCollections.getRecord(collectionId, recordId),
    setCollectionValue: (collectionId, recordId, value) => runtimeCollections.set(collectionId, recordId, value),
    mutateCollection: (collectionId, recordId, operation, value) => runtimeCollections.mutate(collectionId, recordId, operation, value),
    operateCollection: (collectionId, recordId, options) => runtimeCollections.operation(collectionId, recordId, options),
    incrementField: (collectionId, recordId, field, delta) => runtimeCollections.incrementField(collectionId, recordId, field, delta),
    appendCollectionValue: (collectionId, value) => runtimeCollections.appendCollectionValue(collectionId, value),
    listEntries: (queueId, filters) => queues.listEntries(queueId, filters),
    getLanguage: () => i18n.getLanguage(),
    setLanguage: (language) => i18n.setLanguage(language),
  };
  const content = {
    runtimeGateway,
    customWidgetFactories: { display: TextChoiceWidget, dialogue: TextChoiceWidget },
    stateProviders: {},
    runtimeStores: { runtimeCollections },
    saveableVariable: (key, value) => {
      const excluded = frameworkRuntimeDefinition.saveableVariableExclusions || [];
      const prefixes = frameworkRuntimeDefinition.saveableVariablePrefixes || [];
      return !excluded.includes(key) && !prefixes.some((prefix) => String(key).startsWith(prefix))
        && (value === null || ["boolean", "number", "string"].includes(typeof value));
    },
  };
  const iconManager = new DesktopIconManager([], { virtualFileSystem, appRegistry });

  const dialogueRegistry = new DisplayReceiverRegistry();
  content.installDisplayReceivers?.({ dialogueRegistry });
  const shell = new DesktopShell(windowManager, windowDefinitions, eventBus, rootEl, gameClock, variableStore, publicVariables, dataStore, runtimeGateway, dialogueRegistry, content.customWidgetFactories);
  Object.assign(content.customWidgetFactories, createVirtualFileWidgetFactories({
    virtualFileSystem,
    appRegistry,
    eventBus,
    windowManager,
    openWindow: (windowId, parameters = []) => shell.openWindow(windowId, parameters),
    openVirtualPath: (path, sourceInstanceId, parameters, options) => shell.openVirtualPath?.(path, sourceInstanceId, parameters, options),
  }));
  shell.virtualFileSystem = virtualFileSystem;
  runtimeGateway.dispatchDisplay = (target, payload) => {
    const isRoommateDialogue = target === "dorm-bottom";
    const resolvedTarget = isRoommateDialogue ? "ending-screen" : target;
    if (isRoommateDialogue) {
      const dialogueState = windowManager.getByWindowId("dialogue");
      if (dialogueState) windowManager.close(dialogueState.instanceId);
    }
    if (resolvedTarget === "ending-screen" && !windowManager.getByWindowId("ending-screen")) shell.openWindow("ending-screen");
    return dialogueRegistry.dispatch(resolvedTarget, {
      ...payload,
      displayTo: resolvedTarget,
      ...(isRoommateDialogue ? { sessionKind: "roommate" } : {}),
    });
  };
  // Paint icons before loading the Activity catalogue. The catalogue can be
  // large; taskbar and desktop must become visible as one initial surface.
  shell.mountIcons(iconManager);
  const activityDefinitions = new ActivityDefinitionStore(dataLoader);
  const manifest = await dataLoader.loadJSON(config.activityManifest, { optional: true }) || { activityIds: [] };
  const manifestEntries = new Map((manifest.activityIds || []).map((entry) => {
    const value = typeof entry === "string" ? { id: entry, file: `${entry}.json` } : entry;
    return [value.id, value];
  }));
  const ids = new Set();
  for (const listFile of config.activityLists || []) {
    const list = await dataLoader.loadJSON(`activity-lists/${listFile}`, { optional: true });
    for (const id of list?.activityIds || []) ids.add(id);
  }
  const defaultId = config.defaultActivity?.activityId || "default";
  ids.add(defaultId);
  const entries = [...ids].map((id) => manifestEntries.get(id)).filter(Boolean);
  if (entries.length) await activityDefinitions.loadManifest(entries, "activities/");

  let windowStateFilter = () => true;
  /* DEV-TOOLS:START */
  if (!isDevEntry()) windowStateFilter = (window) => !String(window?.windowId || "").startsWith("dev-");
  /* DEV-TOOLS:END */
  const saveManager = new SaveManager({
    gameClock, variableStore, publicVariableManager: publicVariables,
    activityQueueRegistry: queues, windowManager, virtualFileSystem,
    eventStateRegistry: eventState, stateProviders: { ...content.stateProviders, stateBoundary, i18n }, runtimeStores: content.runtimeStores,
    saveableVariable: content.saveableVariable,
    windowStateFilter,
    activityExecutionService: null, resumePendingActivities: () => {}, engineVersion: config.version,
  });
  const apiGateway = createApiRegistry({ eventBus, variableStore, publicVariableManager: publicVariables, activityQueueRegistry: queues, shell, timeService, dataStore, runtimeGateway, audioPlayback });
  registerVirtualFileSystemCapabilities({ apiGateway, eventBus, virtualFileSystem });

  apiGateway.register("engine.stateBoundary.toggle", () => stateBoundary.toggleDuty());
  apiGateway.register("engine.stateBoundary.sleep", () => stateBoundary.sleep());
  apiGateway.register("engine.stateBoundary.location", ({ location } = {}) => stateBoundary.requestLocation(location));
  const execution = new ActivityExecutionService(eventBus, { runtimeGateway, activityDefinitionStore: activityDefinitions });

  apiGateway.register("window.componentMutation", ({ componentId, action, max = 5 } = {}) => {
    const allowed = new Set(["add", "remove"]);
    if (!componentId || !allowed.has(action)) return { ok: false, reason: "invalid-component-mutation" };
    eventBus.emit("window:componentMutation", { componentId, action, max: Math.min(5, Math.max(1, Number(max) || 5)) });
    return { ok: true, componentId, action, max: Math.min(5, Math.max(1, Number(max) || 5)) };
  });
  apiGateway.register("window.addComponent", (payload = {}) => shell.addWindowComponent(payload));
  apiGateway.register("window.removeComponent", (payload = {}) => shell.removeWindowComponent(payload));
  apiGateway.register("window.getLayout", (payload = {}) => shell.getWindowLayout(payload));
  saveManager.activityExecutionService = execution;
  const consumer = new ActivityQueueConsumer({ queueRegistry: queues, activityDefinitionStore: activityDefinitions, activityExecutionService: execution, execute: (context) => executeActivity(context) });
  apiGateway.register("engine.queue.consume", ({ queueId = "main" }) => Boolean(consumer.consume(queueId)));
  apiGateway.register("engine.activity.pause", ({ instanceId }) => execution.pause(instanceId));
  apiGateway.register("engine.activity.resume", ({ instanceId }) => execution.resume(instanceId));
  apiGateway.register("engine.activity.replay", ({ queueId = "main", instanceId, displayTo = "dorm-bottom" } = {}) => {
    const instance = queues.getEntry(queueId, instanceId);
    if (!instance) return { ok: false, reason: "activity-instance-not-found" };
    const transcript = Array.isArray(instance.transcript) ? instance.transcript : [];
    runtimeGateway.dispatchDisplay(displayTo, { displayTo, instanceId, type: "reset" });
    const textEntries = transcript.filter((entry) => entry?.type === "text");
    textEntries.forEach((entry) => {
      const payload = { ...entry, displayTo, continueKey: null, instanceId: entry.instanceId || instanceId };
      runtimeGateway.dispatchDisplay(displayTo, { ...payload, type: "text" });
    });
    runtimeGateway.dispatchDisplay(displayTo, { displayTo, instanceId, type: "complete" });
    return { ok: true, instanceId, count: textEntries.length };
  });
  apiGateway.register("engine.activity.cancel", ({ instanceId }) => execution.cancel(instanceId));

  function enqueueActivity(activityId, queueId = "main", payload = null, parameters = []) {
    const queue = queues.get(queueId) || queues.register(queueId);
    const definition = activityDefinitions.get(activityId);
    if (!definition) return null;
    const instance = queue.append({ activityId, payload, parameters, currentNodeId: definition.blueprint?.startNodeId || null });
    eventBus.emit(ACTIVITY_EVENTS.appended, { queueId, instance: { ...instance } });
    return instance;
  }
  function runActivity(activityId, queueId = "main", { ignoreAvailability = false, parameters = [] } = {}) {
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] runActivity requested", { activityId, queueId, hasQueue: Boolean(queues.get(queueId)), hasDefinition: Boolean(activityDefinitions.get(activityId)) });
    /* DEV-TOOLS:END */
    const queue = queues.get(queueId);
    const definition = activityDefinitions.get(activityId);
    if (!queue || !definition) {
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] runActivity rejected", { activityId, queueId, hasQueue: Boolean(queue), hasDefinition: Boolean(definition) });
      /* DEV-TOOLS:END */
      return null;
    }
    const availability = ignoreAvailability ? { ok: true, forced: true } : evaluateActivityAvailability(definition, { gameClock, variableStore, publicVariableManager: publicVariables, pvGateway: publicVariables, activityQueueRegistry: queues, activityDefinitionStore: activityDefinitions, evaluateCondition });
    if (!availability.ok) {
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] runActivity unavailable", { activityId, queueId, availability });
      /* DEV-TOOLS:END */
      return null;
    }
    const instance = queue.append({ activityId, parameters });
    eventBus.emit(ACTIVITY_EVENTS.appended, { queueId, instance: { ...instance } });
    const runner = executeActivity({ queue, definition, instance });
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] runActivity started", { activityId, queueId, instanceId: instance.instanceId, runner: Boolean(runner) });
    /* DEV-TOOLS:END */
    return runner;
  }
  const eventRouter = new EventActivityRouter({
    eventBus,
    variableStore,
    runtimeGateway,
    displayRegistry: dialogueRegistry,
    stateBoundary,
    resources,
    runActivity,
    windowGateway: (windowId) => shell.openWindow(windowId),
    routes: config.eventRoutes || [],
  }).start();
  content.bindRuntime?.({ runActivity });
  function executeActivity({ queue, definition, instance }) {
    /* DEV-TOOLS:START */
    const executionStartedAt = Array.isArray(globalThis.__cultistsPerformanceSamples) ? globalThis.performance.now() : null;
    console.log("[NG dialogue] executeActivity", { activityId: definition?.id, queueId: queue?.queueId, instanceId: instance?.instanceId, currentNodeId: instance?.currentNodeId });
    /* DEV-TOOLS:END */
    const runner = execution.run({
      queue, definition, instance, variableStore,
      timeGateway: (minutes) => timeService.consume(minutes, { source: "activity" }),
      windowGateway: (id, instance, node) => {
        if (node?.type === "closeWindow") {
          const state = windowManager.getByWindowId(id);
          if (state) windowManager.close(state.instanceId);
          return state;
        }
        return shell.openWindow(id);
      },
      activityGateway: (id, target, source, node, payload, parameters) => node?.type === "insertActivity"
        ? enqueueActivity(id, target || "main", payload, parameters)
        : runActivity(id, target || "main", { parameters }),
        eventGateway: (name, payload) => {
        /* DEV-TOOLS:START */
        console.log("[NG dialogue] eventGateway", name, payload);
        /* DEV-TOOLS:END */
        if (name.startsWith("display:")) runtimeGateway.dispatchDisplay(payload?.displayTo, { ...payload, type: name.slice("display:".length) });
        eventBus.emit(name, payload);
      }, dbGateway: dataStore,
      pvGateway: publicVariables, eventStateGateway: eventState, apiGateway,
    });
    /* DEV-TOOLS:START */
    if (Number.isFinite(executionStartedAt) && Array.isArray(globalThis.__cultistsPerformanceSamples)) {
      globalThis.__cultistsPerformanceSamples.push({
        name: "activity-execution-start",
        activityId: definition?.id,
        queueId: queue?.queueId,
        durationMs: globalThis.performance.now() - executionStartedAt,
      });
    }
    /* DEV-TOOLS:END */
    return runner;
  }
  saveManager.resumePendingActivities = () => {
    for (const queue of queues.list()) {
      const pausedInstances = queue.list({ status: "paused" });
      for (const instance of pausedInstances) {
        const definition = activityDefinitions.get(instance.activityId);
        if (definition) executeActivity({ queue, definition, instance });
      }
      if (!pausedInstances.length && queue.current()) consumer.consume(queue.queueId);
    }
  };
  function runInlineBlueprint(queue, activityId, blueprint) {
    /* DEV-TOOLS:START */
    const validationStartedAt = Array.isArray(globalThis.__cultistsPerformanceSamples) ? globalThis.performance.now() : null;
    /* DEV-TOOLS:END */
    const validation = validateBlueprint(blueprint);
    /* DEV-TOOLS:START */
    if (Number.isFinite(validationStartedAt) && Array.isArray(globalThis.__cultistsPerformanceSamples)) {
      globalThis.__cultistsPerformanceSamples.push({
        name: "inline-blueprint-validation",
        activityId,
        durationMs: globalThis.performance.now() - validationStartedAt,
        nodeCount: Object.keys(blueprint.nodes || {}).length,
      });
    }
    /* DEV-TOOLS:END */
    if (!validation.ok) throw new Error(`Invalid blueprint ${activityId}: ${validation.errors.join("；")}`);
    const instance = queue.append({ activityId });
    eventBus.emit(ACTIVITY_EVENTS.appended, { queueId: queue.queueId, instance: { ...instance } });
    return executeActivity({ queue, definition: { id: activityId, blueprint: validation.blueprint }, instance });
  }
  content.registerApis?.(apiGateway, { activityDefinitionStore: activityDefinitions, enqueueActivity });
  function findWidget(root, widgetId) {
    if (!root) return null;
    if (root.widgetId === widgetId) return root;
    for (const child of root.children || []) {
      const found = findWidget(child, widgetId);
      if (found) return found;
    }
    return null;
  }
  const windowEventsQueue = queues.get("window-events");
  const widgetEventsQueue = queues.get("widget-events");
  const iconEventsQueue = queues.get("desktop-icons");
  function runWindowLifecycle(windowId, eventName) {
    const blueprint = windowDefinitions.get(windowId)?.events?.[eventName];
    return blueprint ? runInlineBlueprint(windowEventsQueue, `window:${windowId}:${eventName}`, blueprint) : null;
  }
  function runWidgetEvent(windowId, widgetId, eventName, value) {
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] widget event", { windowId, widgetId, eventName, value });
    /* DEV-TOOLS:END */
    const widget = findWidget(shell.getRuntimeRoot?.(windowId) || windowDefinitions.get(windowId)?.root, widgetId);
    const blueprint = widget?.events?.[eventName];
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] widget blueprint lookup", { windowId, widgetId, eventName, foundWidget: Boolean(widget), foundBlueprint: Boolean(blueprint) });
    /* DEV-TOOLS:END */
    if (!blueprint) return null;
    if (value !== undefined) variableStore.set("event:value", value);
    if (widgetId) variableStore.set("event:componentId", widgetId);
    return runInlineBlueprint(widgetEventsQueue, `widget:${windowId}:${widgetId}:${eventName}`, blueprint);
  }
  function runIconBlueprint(icon) {
    if (["desktop.launch-program", "desktop.open-folder", "desktop.open-file", "desktop.open-script"].includes(icon.blueprintId)) {
      return openVirtualPath(icon.inputs?.targetPath);
    }
    const builtin = buildBuiltinIconBlueprint(icon.blueprintId, icon.inputs || {});
    if (builtin) return runInlineBlueprint(iconEventsQueue, `icon:${icon.iconId}`, builtin);
    return runActivity(icon.blueprintId, "desktop-icons");
  }
  function openVirtualPath(path, sourceInstanceId = null, invocationArguments = [], options = {}) {
    const entry = virtualFileSystem.get(path);
    if (!entry) return null;
    const target = entry.path.endsWith(".lnk") ? virtualFileSystem.resolveShortcut(entry.path)?.target : entry;
    if (!target) return null;
    const openProgramWindow = (programId, parameters = []) => {
      const program = appRegistry.get(programId);
      return program?.kind === "window"
        ? shell.openWindow(program.target, appRegistry.getWindowParameters(programId, parameters))
        : null;
    };
    if (target.type === "directory") {
      const state = openProgramWindow("file-manager", [target.path]) || shell.openWindow("file-manager", [target.path]);
      return state;
    }
    const filename = target.path.slice(target.path.lastIndexOf("/") + 1);
    if (filename.endsWith(".txt")) return openProgramWindow("document", [target.path]) || shell.openWindow("document", [target.path]);
    if (filename.endsWith(".sh") || target.content.startsWith("#!")) {
      const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
      const command = `sh ${quote(target.path)}${invocationArguments.length ? ` ${invocationArguments.map(quote).join(" ")}` : ""}`;
      return openProgramWindow("terminal", [command, target.path.slice(0, target.path.lastIndexOf("/")) || "/"])
        || shell.openWindow("terminal", [command, target.path.slice(0, target.path.lastIndexOf("/")) || "/"]);
    }
    const programId = target.content.trim();
    const program = appRegistry.get(programId);
    const fallback = program ? null : appRegistry.getDefaultProgram();
    const selectedProgram = program || fallback;
    const sourceWindow = sourceInstanceId ? windowManager.get(sourceInstanceId) : null;
    const sourceTerminalId = sourceWindow?.windowId === "terminal" ? sourceWindow.instanceId : null;
    const cwd = options.cwd || "/home/desktop";
    if (selectedProgram.kind === "window") {
      let parameters;
      if (program) {
        parameters = appRegistry.getWindowParameters(program.id, invocationArguments);
        if (selectedProgram.target === "terminal") parameters = [parameters[0] ?? "", parameters[1] || cwd];
      } else if (selectedProgram.target === "terminal") {
        const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
        parameters = [...(selectedProgram.parameters || []), `echo ${quote(t("appManager.error.unknownApplication", "Unknown application {id} at {path}").replaceAll("{id}", programId).replaceAll("{path}", target.path))}`, cwd];
      } else parameters = [...(selectedProgram.parameters || []), programId, target.path];
      return shell.openWindow(selectedProgram.target, parameters);
    }
    const terminal = sourceTerminalId ? windowManager.get(sourceTerminalId) : shell.openWindow("terminal").instanceId;
    const runtimeContext = { arguments: invocationArguments, cwd, terminalInstanceId: terminal };
    const activityParameters = program
      ? appRegistry.getActivityParameters(program.id, [runtimeContext])
      : [...(selectedProgram.parameters || []), runtimeContext];
    return runActivity(selectedProgram.target, "main", { parameters: activityParameters });
  }
  shell.openVirtualPath = openVirtualPath;
  shell.runWidgetEvent = runWidgetEvent;
  shell.saveManager = saveManager;
  shell.runIconBlueprint = runIconBlueprint;
  eventBus.on("window:opened", ({ windowId }) => runWindowLifecycle(windowId, "onCreate"));
  eventBus.on("window:closed", ({ windowId }) => runWindowLifecycle(windowId, "onDestroy"));
  shell.runActivity = runActivity;
  shell.conditionContext = { gameClock, variableStore, publicVariableManager: publicVariables, pvGateway: publicVariables, activityQueueRegistry: queues, activityDefinitionStore: activityDefinitions };
  shell.refreshIcons();

  // DEV-TOOLS:START
  if (isDevEntry()) {
    const { initDeveloperMode } = await import("../dev/DeveloperMode.js");
    await initDeveloperMode({
      engineConfig: config,
      activityManifest: manifest,
      windowManager,
      windowDefinitionStore: windowDefinitions,
      activityQueueRegistry: queues,
      activityDefinitionStore: activityDefinitions,
      activityExecutionService: execution,
      runActivity,
      eventBus,
      variableStore,
      pvGateway: publicVariables,
      dbGateway: dataStore,
      runtimeGateway,
      appRegistry,
      appDefinitions,
      dataStructureManager: structures,
      dataStore,
      publicVariableManager: publicVariables,
      localVariableManager: localVariables,
      eventStateRegistry: eventState,
      blueprintNodesFileName: frameworkManifest.documents?.blueprintNodes || config.blueprintNodes,
      customWidgetFactories: content.customWidgetFactories,
      dialogueViews: shell.dialogueViews,
      conditionContext: shell.conditionContext,
      openWindow: (windowId, parameters = []) => shell.openWindow(windowId, parameters),
      openVirtualPath: (...args) => shell.openVirtualPath?.(...args),
      i18n,
      customBlueprintNodes,
      dataLoader,
      saveManager,
      gameClock,
      forceEndWork: () => {
        eventBus.emit("developer:force_end_work", { source: "time-debugger" });
        shell.openWindow("off-duty");
      },
    });
    shell.refreshIcons();
    // Match the legacy `?dev` route: open the developer workbench immediately
    // and keep it above ordinary game windows for the whole session.
    windowManager.open(windowDefinitions.get("dev-mode-launcher"));
  }
  // DEV-TOOLS:END

  eventBus.emit("engine:ready", {});
  const startup = config.defaultActivity;
  if (startup) {
    const instance = enqueueActivity(startup.activityId, startup.queueId || "main");
    if (instance) consumer.consume(startup.queueId || "main");
  }
  return { eventBus, windowManager, windowDefinitionStore: windowDefinitions, shell, variableStore, i18n, audioPlayback, tutorialOverlay, contentPackage: content, eventRouter, activityDefinitionStore: activityDefinitions, activityQueueRegistry: queues, activityExecutionService: execution, activityApi: { enqueue: enqueueActivity, run: runActivity, read: (q, id) => queues.getEntry(q, id), list: (q, f) => queues.listEntries(q, f), update: (q, id, p) => queues.updateEntry(q, id, p), complete: (q, id) => queues.completeEntry(q, id), cancel: (q, id) => queues.cancelEntry(q, id), consume: (q) => consumer.consume(q), callApi: (id, payload) => apiGateway.call(id, payload), apis: () => apiGateway.list() }, dataLoader, dataStore, dataStructureManager: structures, publicVariableManager: publicVariables, gameClock, timeService, stateBoundary, iconManager, virtualFileSystem, appRegistry, saveManager, eventStateRegistry: eventState };
}
