import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import EventBus from "../core/EventBus.js";
import { VirtualFileSystem } from "../core/VirtualFileSystem.js";
import { createVirtualFileWidgetFactories } from "../core/VirtualFileWidgets.js";
import { WindowManager } from "../core/WindowManager.js";
import { renderDesktopIcons } from "../core/desktopDesktopIcon.js";

const [documentDefinition, pickerDefinition, widgets, desktopIcons, stylesheet] = await Promise.all([
  readFile(new URL("../../data/windows/document.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../../data/windows/file-picker.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../core/VirtualFileWidgets.js", import.meta.url), "utf8"),
  readFile(new URL("../core/desktopDesktopIcon.js", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
]);

const windows = new WindowManager(new EventBus(), { storage: { getItem: () => null, setItem: () => {} } });
const firstDocument = windows.open(documentDefinition);
const secondDocument = windows.open(documentDefinition);
assert.notEqual(firstDocument.instanceId, secondDocument.instanceId, "document windows open independently");
assert.equal(windows.list().filter((state) => state.windowId === "document").length, 2);
assert.equal(windows.open(pickerDefinition).instanceId, windows.open(pickerDefinition).instanceId, "file picker remains single-instance");

const fileManagerSource = widgets.slice(widgets.indexOf("class FileManagerWidget"), widgets.indexOf("class DocumentEditorWidget"));
const contextMenuSource = widgets.slice(widgets.indexOf("export function showVirtualFileContextMenu"), widgets.indexOf("function programDisplay"));
assert.doesNotMatch(fileManagerSource, /createElement\(["']button["']\)|makeButton\(/, "file manager controls and entries use non-button elements");
assert.doesNotMatch(contextMenuSource, /createElement\(["']button["']\)|makeButton\(/, "desktop/file-manager context menu items use non-button elements");
assert.match(desktopIcons, /document\.createElement\("div"\)/);
assert.doesNotMatch(desktopIcons, /document\.createElement\("button"\)/, "desktop icons do not render native buttons");
assert.match(widgets, /document\.saveAs/);
assert.match(widgets, /result\.mode === "save-as"/);
assert.match(widgets, /this\.openPicker\("save-as"\)/);
assert.match(stylesheet, /\.vfs-document-menu\[hidden\]\s*\{\s*display:\s*none\s*!important;/, "document menu hidden state overrides its flex display rule");

class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.handlers = new Map();
    this.attributes = {};
    this.textContent = "";
    this.value = "";
    this.dataset = {};
    this.style = {};
    this.classList = { add: () => {} };
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, handler) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
  }
  fire(type, event = {}) { (this.handlers.get(type) || []).forEach((handler) => handler({ preventDefault() {}, ...event })); }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.removed = true; }
  replaceChildren(...children) { this.children = [...children]; }
}

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
globalThis.document = { createElement: (tagName) => new MockElement(tagName) };
const confirmCalls = [];
globalThis.window = { confirm: (message) => { confirmCalls.push(message); return false; } };
try {
  const defaults = JSON.parse(await readFile(new URL("../../data/virtual-filesystem.json", import.meta.url), "utf8"));
  const fileSystem = new VirtualFileSystem(defaults);
  const iconRoot = new MockElement("div");
  const activated = [];
  renderDesktopIcons(iconRoot, [{ iconId: "/home/desktop/test.lnk", label: "Test", position: { x: 1, y: 2 } }], {
    onActivate: (icon) => activated.push(icon.iconId),
  });
  assert.equal(iconRoot.children[0].tagName, "div", "desktop icons render without native buttons");
  assert.equal(iconRoot.children[0].attributes.role, "button");
  assert.equal(iconRoot.children[0].tabIndex, 0);
  iconRoot.children[0].fire("keydown", { key: "Enter" });
  assert.deepEqual(activated, ["/home/desktop/test.lnk"], "desktop icons remain keyboard activatable");
  fileSystem.createFile("/home/desktop/Existing.txt", "original");
  fileSystem.createFile("/home/desktop/Second.txt", "second document");
  const eventBus = new EventBus();
  const openedWindows = [];
  const factories = createVirtualFileWidgetFactories({
    virtualFileSystem: fileSystem,
    eventBus,
    openWindow: (windowId) => { openedWindows.push(windowId); return { instanceId: "picker-1" }; },
  });
  const fileManager = factories.fileManager({ widgetId: "fm-root" }, { windowInstanceId: "fm-1" });
  const descendants = (element) => [element, ...element.children.flatMap(descendants)];
  const parameterizedManagerContext = { windowInstanceId: "fm-parameterized", parameters: ["/opt"] };
  factories.fileManager({ widgetId: "file-manager-root" }, parameterizedManagerContext);
  assert.equal(parameterizedManagerContext.widgetInstances.get("file-manager-root").path, "/opt", "file manager launch parameters select its directory");
  eventBus.emit("window:parameters", { instanceId: "fm-parameterized", windowId: "file-manager", parameters: ["/home/desktop"] });
  assert.equal(parameterizedManagerContext.widgetInstances.get("file-manager-root").path, "/home/desktop", "reopening a file manager updates its directory");
  assert.ok(descendants(fileManager).every((element) => element.tagName !== "button"), "file manager renders no native buttons");
  const parameterizedTerminalContext = { windowInstanceId: "terminal-parameters", parameters: ["pwd", "/opt"] };
  factories.terminal({ widgetId: "terminal-parameters-root" }, parameterizedTerminalContext);
  const parameterizedTerminal = parameterizedTerminalContext.widgetInstances.get("terminal-parameters-root");
  assert.equal(parameterizedTerminal.prompt.textContent, "/opt>", "terminal launch parameters set its working directory");
  assert.ok(parameterizedTerminal.output.textContent.endsWith("/opt> pwd\n/opt"), "terminal launch parameters execute their command");
  eventBus.emit("window:parameters", { instanceId: "terminal-parameters", windowId: "terminal", parameters: ["pwd", "/home/desktop"] });
  assert.equal(parameterizedTerminal.prompt.textContent, "/home/desktop>", "reopening the terminal updates its working directory");
  assert.ok(parameterizedTerminal.output.textContent.endsWith("/home/desktop> pwd\n/home/desktop"));
  const terminalContext = { windowInstanceId: "terminal-1" };
  factories.terminal({ widgetId: "terminal-root" }, terminalContext);
  const terminal = terminalContext.widgetInstances.get("terminal-root");
  assert.equal(terminal.prompt.textContent, "/home/desktop>", "terminal prompt uses its POSIX working directory");
  assert.equal(terminal.output.textContent, "Cultists Virtual Terminal · POSIX shell", "terminal keeps a Linux/POSIX shell banner");
  assert.match(stylesheet, /\.vfs-terminal \{[^}]*border:\s*2px inset/, "terminal console has the CMD-like recessed console frame");
  terminal.input.value = "pwd";
  terminal.executeInput();
  assert.match(terminal.output.textContent, /\/home\/desktop> pwd\n\/home\/desktop$/);
  terminal.input.value = "cd /opt";
  terminal.executeInput();
  assert.equal(terminal.prompt.textContent, "/opt>", "terminal prompt follows cd in POSIX form");
  const parameterizedDocumentContext = { windowInstanceId: "doc-parameterized", parameters: ["/home/desktop/Existing.txt"] };
  factories.documentEditor({ widgetId: "editor-parameterized" }, parameterizedDocumentContext);
  const parameterizedDocument = parameterizedDocumentContext.widgetInstances.get("editor-parameterized");
  assert.equal(parameterizedDocument.path, "/home/desktop/Existing.txt", "document launch parameters open the requested file");
  assert.equal(parameterizedDocument.textarea.value, "original");
  eventBus.emit("window:parameters", { instanceId: "doc-parameterized", windowId: "document", parameters: ["/home/desktop/Second.txt"] });
  assert.equal(parameterizedDocument.path, "/home/desktop/Second.txt", "reopening a document editor changes its file");
  assert.equal(parameterizedDocument.textarea.value, "second document");
  const firstContext = { windowInstanceId: "doc-1" };
  const secondContext = { windowInstanceId: "doc-2" };
  const firstEditor = factories.documentEditor({ widgetId: "editor-1" }, firstContext);
  const secondEditor = factories.documentEditor({ widgetId: "editor-2" }, secondContext);
  let pickerRequest;
  eventBus.on("file-picker:request", (request) => { pickerRequest = request; });
  const fileMenu = firstEditor.children[0];
  const fileButton = fileMenu.children[0];
  const menu = fileMenu.children[1];
  fileButton.fire("click");
  assert.equal(menu.hidden, false, "File menu opens from its menu button");
  menu.children[2].fire("click");
  assert.deepEqual(openedWindows, ["file-picker"]);
  assert.equal(menu.hidden, true);
  assert.equal(pickerRequest.mode, "save-as", "Save As opens the picker in save-as mode");
  assert.equal(pickerRequest.ownerWindowInstanceId, "doc-1");
  const firstWidget = firstContext.widgetInstances.get("editor-1");
  const secondWidget = secondContext.widgetInstances.get("editor-2");
  assert.ok(firstWidget && secondWidget && firstWidget !== secondWidget, "each document window owns a separate widget instance");
  assert.equal(firstWidget.path, null);
  assert.equal(firstWidget.textarea.value, "");
  firstWidget.textarea.value = "new copy";
  eventBus.emit("file-picker:result", { instanceId: "doc-1", mode: "save-as", path: "/home/desktop/Copy.txt" });
  assert.equal(fileSystem.readFile("/home/desktop/Copy.txt"), "new copy", "Save As writes a new copy to the chosen VFS path");
  assert.equal(firstWidget.path, "/home/desktop/Copy.txt");
  firstWidget.textarea.value = "overwrite attempt";
  eventBus.emit("file-picker:result", { instanceId: "doc-1", mode: "save-as", path: "/home/desktop/Existing.txt" });
  assert.equal(fileSystem.readFile("/home/desktop/Existing.txt"), "original", "declining overwrite leaves target content unchanged");
  assert.equal(confirmCalls.length, 1, "Save As asks before overwriting an existing file");
  assert.equal(secondWidget.path, null, "a picker result for one document does not change the other document window");
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}

console.log("virtual-file-ui-probe: accessible non-button desktop/file-manager controls, multi-instance documents, menu visibility, and Save As passed");
