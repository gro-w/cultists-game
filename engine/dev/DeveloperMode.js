// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { setActiveI18nManager } from "../core/i18n/index.js";
import { createActivityListManagerModel } from "./ActivityListManagerModel.js";
import { ActivityListManagerView } from "./ActivityListManagerView.js";
import { ActivityEditorView } from "./ActivityEditorView.js";
import { ActivityDebuggerView } from "./ActivityDebuggerView.js";
import { WindowDefinitionManagerView } from "./WindowDefinitionManagerView.js";
import { WindowEditorView } from "./WindowEditorView.js";
import { WindowWidgetSubEditorView } from "./WindowWidgetSubEditorView.js";
import { InitialVirtualFileSystemEditorView } from "./InitialVirtualFileSystemEditorView.js";
import { DataStructureEditorView } from "./DataStructureEditorView.js";
import { DatabaseEditorView, DatabaseRecordEditorView } from "./DatabaseDebuggerView.js";
import { PublicVariableEditorView } from "./PublicVariableEditorView.js";
import { PublicVariableDebuggerView } from "./PublicVariableDebuggerView.js";
import { LocalVariableEditorView } from "./LocalVariableEditorView.js";
import { OnboardingEditorView } from "./OnboardingEditorView.js";
import { SaveDebuggerView } from "./SaveDebuggerView.js";
import { BlueprintNodeManagerView } from "./BlueprintNodeManagerView.js";
import { DataJsonEditorView } from "./DataJsonEditorView.js";
import { AppProgramManagerView } from "./AppProgramManagerView.js";
import { TimeDebuggerView } from "./TimeDebuggerView.js";
import { I18nManagerView } from "./I18nManagerView.js";
import { WindowDebuggerView } from "./WindowDebuggerView.js";

import { parseCl2 } from "../core/Cl2Parser.js";
import { writeDataFile } from "./devApi.js";



const LIST_MANAGER_WINDOW_ID = "dev-activity-list-manager";
const DEBUGGER_WINDOW_ID = "dev-activity-debugger";
const WINDOW_MANAGER_WINDOW_ID = "dev-window-definition-manager";
const INITIAL_VFS_EDITOR_WINDOW_ID = "dev-initial-vfs-editor";
const STRUCTURE_MANAGER_WINDOW_ID = "dev-structure-manager";
const DATABASE_EDITOR_WINDOW_ID = "dev-database-editor";
const PUBLIC_VARIABLE_MANAGER_WINDOW_ID = "dev-public-variable-manager";
const PUBLIC_VARIABLE_DEBUGGER_WINDOW_ID = "dev-public-variable-debugger";
const LOCAL_VARIABLE_MANAGER_WINDOW_ID = "dev-local-variable-manager";
const ONBOARDING_EDITOR_WINDOW_ID = "dev-onboarding-editor";
const SAVE_DEBUGGER_WINDOW_ID = "dev-save-debugger";
const BLUEPRINT_NODE_MANAGER_WINDOW_ID = "dev-blueprint-node-manager";
const DATA_JSON_EDITOR_WINDOW_ID = "dev-data-json-editor";
const APP_PROGRAM_MANAGER_WINDOW_ID = "dev-app-program-manager";
const TIME_DEBUGGER_WINDOW_ID = "dev-time-debugger";
const I18N_MANAGER_WINDOW_ID = "dev-i18n-manager";
const WINDOW_DEBUGGER_WINDOW_ID = "dev-window-debugger";

const LAUNCHER_WINDOW_ID = "dev-mode-launcher";
let editorWindowSeq = 0;
let windowEditorWindowSeq = 0;
let widgetEventEditorSeq = 0;
let widgetSubEditorSeq = 0;
let databaseEditorWindowSeq = 0;

/**
 * DeveloperMode - top-level controller wired into ng/engine.js only when
 * isDevEntry() is true (plan §3.1 strict `?dev` gate). Reads existing game
 * data through the same DataLoader boundary as the engine - never
 * through the dev-server API, which is write-only (per repository
 * decision). Writing back to disk is done exclusively via devApi's
 * writeDataFile(), called from the list manager / editor views.
 */
export async function initDeveloperMode({
  engineConfig,
  activityManifest,
  windowManager,
  windowDefinitionStore,
  activityQueueRegistry,
  activityDefinitionStore,
  activityExecutionService,
  runActivity,
  eventBus,
  variableStore,
  pvGateway,
  dbGateway,
  runtimeGateway,
  appRegistry,
  dataStructureManager,
  dataStore,
  publicVariableManager,
  localVariableManager,
  eventStateRegistry,
  dataLoader,
  saveManager,
  gameClock,
  i18n,
  customBlueprintNodes = [],
  blueprintNodesFileName = "blueprint-nodes.json",
  customWidgetFactories = {},
  dialogueViews = {},
  conditionContext = {},
  openWindow = null,
  openVirtualPath = null,
  forceEndWork = null,

}) {
  setActiveI18nManager(i18n);
  const model = createActivityListManagerModel();
  const dataFileManifest = await dataLoader.loadJSON("data-files.json", { cache: false });

  async function writeVerifiedJson(fileName, value) {
    const text = JSON.stringify(value, null, 2);
    await writeDataFile(fileName, text);
    const saved = await dataLoader.loadJSON(fileName, { cache: false });
    if (JSON.stringify(saved) !== JSON.stringify(value)) throw new Error(`Read-back mismatch for ${fileName}`);
  }

  async function writeWindowDefinition(definition) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(definition.id || "")) throw new Error("Invalid window ID");
    if (!Array.isArray(engineConfig.windowManifest) || !Array.isArray(dataFileManifest.files)) {
      throw new Error("The content package must use array windowManifest and files manifests");
    }
    const fileName = `windows/${definition.id}.json`;
    const nextConfig = structuredClone(engineConfig);
    const documentName = `${definition.id}.json`;
    if (!nextConfig.windowManifest.includes(documentName)) nextConfig.windowManifest.push(documentName);
    const nextFiles = structuredClone(dataFileManifest);
    if (!nextFiles.files.includes(fileName)) nextFiles.files.push(fileName);
    await writeVerifiedJson(fileName, definition);
    await writeVerifiedJson("game-manifest.json", nextConfig);
    await writeVerifiedJson("data-files.json", nextFiles);
    engineConfig.windowManifest = nextConfig.windowManifest;
    dataFileManifest.files = nextFiles.files;
  }

  function openEditor(activity) {
    const windowId = `dev-activity-editor-${activity.id}-${editorWindowSeq++}`;
    let currentId = activity.id;
    const view = new ActivityEditorView({
      activityId: activity.id,
      blueprint: activity.blueprint,
      displayName: activity.displayName,
      dataFileName: `activities/${activity.id}.CL2.txt`,
      onSaveToMemory: (blueprint) => model.saveActivityBlueprint(currentId, blueprint),
      onRenameId: (oldId, newId) => {
        model.renameActivity(oldId, newId);
        currentId = newId;
        view.dataFileName = `activities/${newId}.CL2.txt`;
      },
    });
    const definition = windowDefinitionStore.register({
      id: windowId,
      title: `Activity ${t("legacy.428de132ceb4")}- ${activity.displayName}`,
      icon: "🧩",
      width: 860,
      height: 560,
      resizable: true,
      singleInstance: true,
      body: view.el,
    });
    windowManager.open(definition);
  }

  const listManagerView = new ActivityListManagerView(model, { openEditor });
  // Developer mode must not hold desktop mounting on the complete Activity
  // editor corpus. Populate the already-created manager in the background.
  loadExistingActivities(model, engineConfig, activityManifest, dataLoader, dataFileManifest?.files || [])
    .then(() => listManagerView.render())
    .catch((error) => console.error("Developer Activity loading failed", error));
  windowDefinitionStore.register({
    id: LIST_MANAGER_WINDOW_ID,
    title: t("legacy.17e5a992b112"),
    icon: "📦",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: listManagerView.el,
  });

  // The debugger only needs live runtime pieces (queue registry + event
  // bus), so it's fine to build it even if the caller doesn't pass them in
  // (e.g. an older bootstrap ordering); it just shows an empty queue list.
  const debuggerView = new ActivityDebuggerView({ activityQueueRegistry, activityDefinitionStore, activityExecutionService, localVariableManager, eventBus, runActivity });
  windowDefinitionStore.register({
    id: DEBUGGER_WINDOW_ID,
    title: t("legacy.881ffd8a0a2c"),
    icon: "🐞",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: debuggerView.el,
  });

  const saveDebuggerView = new SaveDebuggerView({ saveManager });
  windowDefinitionStore.register({
    id: SAVE_DEBUGGER_WINDOW_ID,
    title: t("legacy.c7a86028fa21"),
    icon: "💾",
    width: 760,
    height: 560,
    resizable: true,
    singleInstance: true,
    body: saveDebuggerView.el,
  });

  const timeDebuggerView = new TimeDebuggerView({ gameClock, forceEndWork });
  windowDefinitionStore.register({
    id: TIME_DEBUGGER_WINDOW_ID,
    title: t("legacy.94aaa46fd1f3"),
    icon: "⏱️",
    width: 420,
    height: 300,
    resizable: true,
    singleInstance: true,
    body: timeDebuggerView.el,
  });

  const i18nManagerView = new I18nManagerView({ i18n });
  windowDefinitionStore.register({
    id: I18N_MANAGER_WINDOW_ID,
    title: i18n.translate("i18n.manager.title"),
    icon: "🌐",
    width: 520,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: i18nManagerView.el,
  });

  const windowDebuggerView = new WindowDebuggerView({ windowManager, windowDefinitionStore, eventBus });
  windowDefinitionStore.register({
    id: WINDOW_DEBUGGER_WINDOW_ID,
    title: "窗口调试器",
    icon: "🔍",
    width: 620,
    height: 520,
    resizable: true,
    singleInstance: true,
    body: windowDebuggerView.el,
  });

  function openWindowEditor(definition) {
    const windowId = `dev-window-editor-${definition.id}-${windowEditorWindowSeq++}`;
    const view = new WindowEditorView({
      definition,
      dataFileName: `windows/${definition.id}.json`,
      onWriteToDisk: writeWindowDefinition,
      onSaveToMemory: (updated) => windowDefinitionStore.register(updated),
      customWidgetFactories,
      variableStore,
      pvGateway,
      dbGateway,
      runtimeGateway,
      openEventBlueprintEditor: openWidgetEventEditor,
      openValueBlueprintEditor: openWidgetValueEditor,
      openWidgetSubEditor: openWidgetPropertySubEditor,
      gameClock,
      windowDefinitionStore,
      dialogueViews,
      conditionContext,
      openWindow,
      openVirtualPath,
    });
    const editorDefinition = windowDefinitionStore.register({
      id: windowId,
      title: `${t("legacy.8f0c7559b50a")}- ${definition.id}`,
      icon: "🪟",
      width: 900,
      height: 560,
      resizable: true,
      singleInstance: true,
      body: view.el,
    });
    windowManager.open(editorDefinition);
  }

  function openWidgetPropertySubEditor({ kind, widget, displayName, onSave } = {}) {
    const windowId = `dev-window-widget-subeditor-${widgetSubEditorSeq++}`;
    const view = new WindowWidgetSubEditorView({ kind, widget, onSave });
    const isListTemplate = kind === "list-template";
    const definition = windowDefinitionStore.register({
      id: windowId,
      title: `${t("windowEditor.subeditor.windowTitle", "窗口组件编辑器")} - ${displayName || widget?.widgetId || ""}`,
      icon: "🪟",
      width: isListTemplate ? 980 : 600,
      height: isListTemplate ? 680 : 560,
      resizable: true,
      singleInstance: false,
      body: view.el,
    });
    windowManager.open(definition);
  }

  function openWidgetValueEditor({ blueprint, displayName, onSaveToMemory } = {}) {
    const windowId = `dev-widget-value-editor-${widgetEventEditorSeq++}`;
    const view = new ActivityEditorView({
      activityId: windowId,
      blueprint,
      displayName,
      valueOnly: true,
      onSaveToMemory,
    });
    const definition = windowDefinitionStore.register({
      id: windowId,
      title: `${t("legacy.6a809005a97d")}- ${displayName || "untitled"}`,
      icon: "🔢",
      width: 980,
      height: 620,
      resizable: true,
      singleInstance: false,
      body: view.el,
    });
    windowManager.open(definition);
  }

  /**
   * Opens a widget's `events.onClick`/`onChange`/... inline blueprint in the
   * exact same ActivityEditorView used for top-level Activities (plan §4.2
   * "组件交互事件...统一经过 ActivityExecutionService"), so authoring a
   * component's click/change behaviour is no different from authoring any
   * other Activity - same node palette, same visual language, same save
   * flow, just written back into the widget's `events[eventName]` field
   * instead of `data/activities/*.json`.
   */
  function openWidgetEventEditor(blueprint, displayName, onSave) {
    const windowId = `dev-widget-event-editor-${widgetEventEditorSeq++}`;
    const view = new ActivityEditorView({
      activityId: windowId,
      blueprint,
      displayName,
      onSaveToMemory: onSave,
    });
    const definition = windowDefinitionStore.register({
      id: windowId,
      title: `${t("legacy.7c99016adb5c")}- ${displayName}`,
      icon: "⚡️",
      width: 860,
      height: 560,
      resizable: true,
      singleInstance: true,
      body: view.el,
    });
    windowManager.open(definition);
  }

  const windowManagerView = new WindowDefinitionManagerView(windowDefinitionStore, { openEditor: openWindowEditor });
  windowDefinitionStore.register({
    id: WINDOW_MANAGER_WINDOW_ID,
    title: t("legacy.31c262a8b0a2"),
    icon: "🪟",
    width: 480,
    height: 360,
    resizable: true,
    singleInstance: true,
    body: windowManagerView.el,
  });

  const initialFileSystem = await dataLoader.loadJSON(engineConfig?.virtualFileSystem || "virtual-filesystem.json", { cache: false });
  const initialVfsEditorView = new InitialVirtualFileSystemEditorView({
    dataLoader,
    initialDocument: initialFileSystem,
    appRegistry,
    filePath: engineConfig?.virtualFileSystem || "virtual-filesystem.json",
  });
  windowDefinitionStore.register({
    id: INITIAL_VFS_EDITOR_WINDOW_ID,
    title: t("initialVfs.title"),
    icon: "🗂️",
    width: 1040,
    height: 680,
    resizable: true,
    singleInstance: true,
    body: initialVfsEditorView.el,
  });

  // Data structure manager (plan §9.2) - visual editor for structures.framework.json,
  // shared with the live DataStructureManager so a database debugger
  // opened afterwards immediately sees any schema change.
  const structureEditorView = new DataStructureEditorView({ dataStructureManager });
  windowDefinitionStore.register({
    id: STRUCTURE_MANAGER_WINDOW_ID,
    title: t("legacy.aee22ce678c6"),
    icon: "🧱",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: structureEditorView.el,
  });

  // First database window only selects a database. Opening one mounts a
  // separate record editor so database selection and record selection cannot
  // overwrite each other's state.
  const openDatabaseEditor = (databaseId) => {
    const id = `dev-database-record-editor-${databaseId}-${databaseEditorWindowSeq++}`;
    const view = new DatabaseRecordEditorView({ dataStore, dataStructureManager, dataLoader, databaseId });
    const definition = windowDefinitionStore.register({
      id,
      title: `${t("legacy.2ac0cd047737")}- ${databaseId}`,
      icon: "🗃️",
      width: 900,
      height: 600,
      resizable: true,
      singleInstance: false,
      body: view.el,
    });
    windowManager.open(definition);
  };
  const databaseEditorView = new DatabaseEditorView({ dataStore, dataStructureManager, dataLoader, onOpenDatabase: openDatabaseEditor });
  windowDefinitionStore.register({
    id: DATABASE_EDITOR_WINDOW_ID,
    title: t("legacy.df85571b280e"),
    icon: "🗄️",
    width: 440,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: databaseEditorView.el,
  });

  // Public variable manager (plan §10.2) - visual editor for
  // public-variables.framework.json, shared with the live PublicVariableManager so a
  // public-variable debugger opened afterwards immediately sees any schema
  // change (mirrors DataStructureEditorView's editor/debugger split).
  const publicVariableEditorView = new PublicVariableEditorView({ publicVariableManager });
  windowDefinitionStore.register({
    id: PUBLIC_VARIABLE_MANAGER_WINDOW_ID,
    title: t("legacy.122d971cae32"),
    icon: "🌐",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: publicVariableEditorView.el,
  });

  // Public variable debugger - runtime value browser/editor for the live
  // PublicVariableManager, always going through its set/setObjectRef API
  // (never a direct Map mutation), never writing back to a data file.
  const publicVariableDebuggerView = new PublicVariableDebuggerView({ publicVariableManager });
  windowDefinitionStore.register({
    id: PUBLIC_VARIABLE_DEBUGGER_WINDOW_ID,
    title: t("legacy.ac44fa7035df"),
    icon: "🧮",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: publicVariableDebuggerView.el,
  });

  const localVariableEditorView = new LocalVariableEditorView({ localVariableManager });
  windowDefinitionStore.register({
    id: LOCAL_VARIABLE_MANAGER_WINDOW_ID,
    title: t("legacy.2e7c7cd97d6f"),
    icon: "📍",
    width: 680,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: localVariableEditorView.el,
  });

  // Onboarding hint editor (Phase 8 新手引导) - visual editor for
  // onboarding.json, shared with the live OnboardingManager so a "预览"
  // click immediately re-shows a hint through the real TutorialOverlay.
  const onboardingEditorView = new OnboardingEditorView({ eventStateRegistry });
  windowDefinitionStore.register({
    id: ONBOARDING_EDITOR_WINDOW_ID,
    title: t("legacy.1bf0c2e6cd4c"),
    icon: "💡",
    width: 480,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: onboardingEditorView.el,
  });

  function openBlueprintNodeEditor(node, onSaveToMemory = () => {}) {
    const view = new ActivityEditorView({
      activityId: `blueprint-node-${node.id}`,
      blueprint: node.blueprint,
      displayName: node.label || node.id,
      onSaveToMemory: (blueprint) => {
        onSaveToMemory(blueprint);
      },
    });
    const definition = windowDefinitionStore.register({
      id: `dev-blueprint-node-editor-${node.id}`,
      title: `${t("legacy.7591813b9a39")}- ${node.label || node.id}`,
      icon: "🔷",
      width: 980,
      height: 620,
      resizable: true,
      singleInstance: true,
      body: view.el,
    });
    windowManager.open(definition);
  }

  const blueprintNodeManagerView = new BlueprintNodeManagerView({
    nodes: customBlueprintNodes,
    dataFileName: blueprintNodesFileName,
    dataLoader,
    openEditor: openBlueprintNodeEditor,
  });
  windowDefinitionStore.register({
    id: BLUEPRINT_NODE_MANAGER_WINDOW_ID,
    title: t("legacy.0fc5566a6ab3"),
    icon: "🔷",
    width: 760,
    height: 520,
    resizable: true,
    singleInstance: true,
    body: blueprintNodeManagerView.el,
  });

  const dataJsonEditorView = new DataJsonEditorView({
    dataLoader,
    dataFiles: dataFileManifest?.files || [],
  });
  windowDefinitionStore.register({
    id: DATA_JSON_EDITOR_WINDOW_ID,
    title: t("legacy.4ad4371a1666"),
    icon: "📄",
    width: 1040,
    height: 680,
    resizable: true,
    singleInstance: true,
    body: dataJsonEditorView.el,
  });

  const appProgramManagerView = new AppProgramManagerView({ appRegistry, dataLoader, windowDefinitionStore, activityDefinitionStore });
  windowDefinitionStore.register({
    id: APP_PROGRAM_MANAGER_WINDOW_ID,
    title: t("appManager.title"),
    icon: "🧩",
    width: 840,
    height: 620,
    resizable: true,
    singleInstance: true,
    body: appProgramManagerView.el,
  });


  // Single desktop-icon entry point (plan follow-up: "把桌面上各个开发人员
  // 模式图标放在同一个开发人员模式app里面") - every dev sub-tool above is
  // still its own singleInstance window, just launched from one shared
  // launcher window instead of one desktop icon each. The launcher is
  // The upper section owns JSON-backed authoring and disk persistence. The
  // lower section owns live runtime/save state; its mutations never write a
  // source JSON document.
  const launcherEl = document.createElement("div");
  launcherEl.className = "ng-dev-launcher";
  launcherEl.innerHTML = `
    <div class="ng-dev-launcher-section">
      <h4>${t("legacy.50aed45e1389")}JSON ${t("legacy.736e99f26407")}</h4>
      <button type="button" class="ng-dev-desktop-icon" data-tool="list-manager"><span class="ng-dev-icon-glyph">📦</span><span>Activity ${t("legacy.35bd37ad3381")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="window-manager"><span class="ng-dev-icon-glyph">🪟</span><span>${t("legacy.3b195364abf4")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="initial-vfs-editor"><span class="ng-dev-icon-glyph">🗂️</span><span>${t("initialVfs.title")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="app-program-manager"><span class="ng-dev-icon-glyph">🧩</span><span>${t("appManager.title")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="structure-manager"><span class="ng-dev-icon-glyph">🧱</span><span>${t("legacy.aee22ce678c6")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="database-debugger"><span class="ng-dev-icon-glyph">🗄️</span><span>${t("legacy.df85571b280e")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="public-variable-manager"><span class="ng-dev-icon-glyph">🌐</span><span>${t("legacy.122d971cae32")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="local-variable-manager"><span class="ng-dev-icon-glyph">📍</span><span>${t("legacy.2e7c7cd97d6f")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="onboarding-editor"><span class="ng-dev-icon-glyph">💡</span><span>${t("legacy.1bf0c2e6cd4c")}</span></button>

      <button type="button" class="ng-dev-desktop-icon" data-tool="blueprint-node-manager"><span class="ng-dev-icon-glyph">🔷</span><span>${t("legacy.0fc5566a6ab3")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="data-json-editor"><span class="ng-dev-icon-glyph">📄</span><span>${t("legacy.fb91bdb18b33")}JSON ${t("legacy.fefac5e5a9aa")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="i18n-manager"><span class="ng-dev-icon-glyph">🌐</span><span>i18n ${t("legacy.35bd37ad3381")}</span></button>

    </div>
    <div class="ng-dev-launcher-section">
      <h4>${t("legacy.a6990bcae9a8")}</h4>
      <button type="button" class="ng-dev-desktop-icon" data-tool="window-debugger"><span class="ng-dev-icon-glyph">🔍</span><span>窗口调试器</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="debugger"><span class="ng-dev-icon-glyph">🐞</span><span>${t("legacy.881ffd8a0a2c")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="save-debugger"><span class="ng-dev-icon-glyph">💾</span><span>${t("legacy.c7a86028fa21")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="public-variable-debugger"><span class="ng-dev-icon-glyph">🧮</span><span>${t("legacy.ac44fa7035df")}</span></button>
      <button type="button" class="ng-dev-desktop-icon" data-tool="time-debugger"><span class="ng-dev-icon-glyph">⏱️</span><span>${t("legacy.94aaa46fd1f3")}</span></button>

    </div>
  `;
  launcherEl.querySelector('[data-tool="list-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(LIST_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(DEBUGGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="window-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(WINDOW_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="window-debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(WINDOW_DEBUGGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="initial-vfs-editor"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(INITIAL_VFS_EDITOR_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="app-program-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(APP_PROGRAM_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="structure-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(STRUCTURE_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="database-debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(DATABASE_EDITOR_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="public-variable-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(PUBLIC_VARIABLE_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="local-variable-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(LOCAL_VARIABLE_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="onboarding-editor"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(ONBOARDING_EDITOR_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="blueprint-node-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(BLUEPRINT_NODE_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="data-json-editor"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(DATA_JSON_EDITOR_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="i18n-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(I18N_MANAGER_WINDOW_ID));
  });

  launcherEl.querySelector('[data-tool="save-debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(SAVE_DEBUGGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="public-variable-debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(PUBLIC_VARIABLE_DEBUGGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="time-debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(TIME_DEBUGGER_WINDOW_ID));
  });

  windowDefinitionStore.register({
    id: LAUNCHER_WINDOW_ID,
    title: t("legacy.5e276d748766"),
    icon: "🛠️",
    width: 360,
    height: 620,
    resizable: true,
    singleInstance: true,
    alwaysOnTop: true,
    body: launcherEl,
  });

  return {
    model,
    openListManager: () => windowManager.open(windowDefinitionStore.get(LIST_MANAGER_WINDOW_ID)),
    openDebugger: () => windowManager.open(windowDefinitionStore.get(DEBUGGER_WINDOW_ID)),
    openWindowManager: () => windowManager.open(windowDefinitionStore.get(WINDOW_MANAGER_WINDOW_ID)),
    openInitialVirtualFileSystemEditor: () => windowManager.open(windowDefinitionStore.get(INITIAL_VFS_EDITOR_WINDOW_ID)),
    openStructureManager: () => windowManager.open(windowDefinitionStore.get(STRUCTURE_MANAGER_WINDOW_ID)),
    openDatabaseDebugger: () => windowManager.open(windowDefinitionStore.get(DATABASE_EDITOR_WINDOW_ID)),
    openSaveDebugger: () => windowManager.open(windowDefinitionStore.get(SAVE_DEBUGGER_WINDOW_ID)),
    openPublicVariableManager: () => windowManager.open(windowDefinitionStore.get(PUBLIC_VARIABLE_MANAGER_WINDOW_ID)),
    openPublicVariableDebugger: () => windowManager.open(windowDefinitionStore.get(PUBLIC_VARIABLE_DEBUGGER_WINDOW_ID)),
    openLocalVariableManager: () => windowManager.open(windowDefinitionStore.get(LOCAL_VARIABLE_MANAGER_WINDOW_ID)),
    openOnboardingEditor: () => windowManager.open(windowDefinitionStore.get(ONBOARDING_EDITOR_WINDOW_ID)),
    openBlueprintNodeManager: () => windowManager.open(windowDefinitionStore.get(BLUEPRINT_NODE_MANAGER_WINDOW_ID)),
    openDataJsonEditor: () => windowManager.open(windowDefinitionStore.get(DATA_JSON_EDITOR_WINDOW_ID)),
    openAppProgramManager: () => windowManager.open(windowDefinitionStore.get(APP_PROGRAM_MANAGER_WINDOW_ID)),
    openTimeDebugger: () => windowManager.open(windowDefinitionStore.get(TIME_DEBUGGER_WINDOW_ID)),
    openI18nManager: () => windowManager.open(windowDefinitionStore.get(I18N_MANAGER_WINDOW_ID)),

  };
}

async function loadExistingActivities(model, engineConfig, activityManifest, dataLoader, dataFiles = []) {
  const manifestEntries = new Map(
    (activityManifest?.activityIds || []).map((entry) => [entry.id, entry]),
  );
  const listFiles = Array.isArray(engineConfig?.activityLists) ? engineConfig.activityLists : [];
  for (const listFile of listFiles) {
    const list = await dataLoader.loadJSON(`activity-lists/${listFile}`, { optional: true });
    if (!list) continue;
    model.registerList(list);
    for (const activityId of list.activityIds || []) {
      const manifestEntry = manifestEntries.get(activityId);
      if (!manifestEntry?.file) continue;
      if (!manifestEntry.file.endsWith(".CL2.txt")) continue;
      const source = await dataLoader.loadText(`activities/${manifestEntry.file}`, { optional: true });
      if (!source) continue;
      const parsed = parseCl2(source, { sourcePath: `activities/${manifestEntry.file}` });
      if (!parsed.ok) continue;
      model.registerActivity(list.id, { id: activityId, displayName: manifestEntry.displayName || activityId, blueprint: parsed.graph, source }, manifestEntry);
    }
  }

  // Every activity JSON has a dedicated ActivityEditorView, even when the
  // activity is not referenced by a player-facing activity list.
  const allActivitiesListId = "__all-activities__";
  model.registerList({ id: allActivitiesListId, activityIds: [] });
  for (const entry of activityManifest?.activityIds || []) {
    const id = typeof entry === "string" ? entry : entry.id;
    const file = typeof entry === "string" ? `${id}.CL2.txt` : entry.file;
    if (!id || !file?.endsWith(".CL2.txt")) continue;
    const source = await dataLoader.loadText(`activities/${file}`, { optional: true });
    if (!source) continue;
    const parsed = parseCl2(source, { sourcePath: `activities/${file}` });
    if (!parsed.ok) continue;
    model.registerActivity(allActivitiesListId, { id, displayName: entry.displayName || id, blueprint: parsed.graph, source }, entry);
  }
}

/**
 * A single desktop icon opens the shared dev-mode launcher window, which
 * in turn opens each individual dev sub-tool (plan follow-up: consolidate
 * multiple dev-mode desktop icons into one "开发人员模式" app).
 */
export function buildDeveloperDesktopIcons() {
  return [{
    iconId: "dev-mode-launcher-icon",
    glyph: "🛠️",
    label: t("legacy.5e276d748766"),
    blueprintId: "desktop.open-window",
    inputs: { windowId: LAUNCHER_WINDOW_ID },
  }];
}

export default initDeveloperMode;
// DEV-TOOLS:END
