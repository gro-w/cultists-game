import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import EventBus from "../core/EventBus.js";
import { InitialVirtualFileSystemEditorView } from "../dev/InitialVirtualFileSystemEditorView.js";

class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.handlers = new Map();
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.classList = { add() {}, remove() {} };
    this.value = "";
    this.textContent = "";
    this.hidden = false;
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(type, handler) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
  }
  fire(type, event = {}) {
    for (const handler of this.handlers.get(type) || []) handler({ preventDefault() {}, stopPropagation() {}, ...event });
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.removed = true; }
  click() { this.fire("click"); }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}

const body = new MockElement("body");
const documentListeners = new Map();
globalThis.document = {
  body,
  createElement: (tag) => new MockElement(tag),
  querySelectorAll: () => [],
  addEventListener(type, handler) { documentListeners.set(type, handler); },
  removeEventListener(type) { documentListeners.delete(type); },
};
const prompts = [];
globalThis.window = {
  innerWidth: 1200,
  innerHeight: 900,
  prompt: () => prompts.shift() ?? null,
  confirm: () => true,
};

const defaults = JSON.parse(await readFile(new URL("../../data/virtual-filesystem.json", import.meta.url), "utf8"));
let diskDocument = structuredClone(defaults);
const loader = {
  cache: new Map(),
  resolve: (path) => `data/${path}`,
  async loadJSON() { return structuredClone(diskDocument); },
};
globalThis.fetch = async (url, request) => {
  assert.equal(url, "/api/file?f=virtual-filesystem.json");
  assert.equal(request.method, "POST");
  diskDocument = JSON.parse(request.body);
  return { ok: true, json: async () => ({ ok: true }) };
};

const view = new InitialVirtualFileSystemEditorView({ dataLoader: loader, initialDocument: defaults });
assert.equal(view.el.className, "ng-initial-vfs-editor");
assert.equal(view.panes.children.length, 2, "editor composes file manager and document editor panes");
assert.equal(view.fileManagerWidget.path, "/", "initial file manager starts at VFS root");
assert.equal(view.documentWidget.fileMenuButton.hidden, true, "the file manager supplies the document-open path");

view.fileManagerWidget.navigate("/home/desktop");
const existingShortcut = view.virtualFileSystem.get("/home/desktop/HIS.lnk");
assert.ok(existingShortcut, "default desktop shortcuts are present in the initial tree");
view.documentWidget.openFile("/home/desktop/HIS.lnk");
view.documentWidget.textarea.value = "/opt/chatgtp";
view.documentWidget.dirty = true;
assert.equal(view.saveDocument(), true);
assert.equal(view.virtualFileSystem.readFile("/home/desktop/HIS.lnk"), "/opt/chatgtp", "document pane edits shortcut targets");

// The actual file-manager context menu provides create-file/folder and paste-shortcut actions.
const fileManagerView = view.fileManagerWidget.view;
const openContextMenu = () => {
  fileManagerView.fire("contextmenu", {
    clientX: 10,
    clientY: 10,
    target: { closest: () => null },
  });
  return body.children.at(-1);
};
let menu = openContextMenu();
const createFileItem = menu.children.find((item) => item.textContent === "新建文件");
assert.ok(createFileItem, "file manager context menu offers new file");
prompts.push("editor-probe.txt");
createFileItem.click();
assert.equal(view.virtualFileSystem.readFile("/home/desktop/editor-probe.txt"), "");
menu = openContextMenu();
const createFolderItem = menu.children.find((item) => item.textContent === "新建文件夹");
assert.ok(createFolderItem, "file manager context menu offers new folder");
prompts.push("Editor Folder");
createFolderItem.click();
assert.equal(view.virtualFileSystem.get("/home/desktop/Editor Folder").type, "directory");

view.virtualFileSystem.clipboard = { path: "/opt/his", operation: "copy" };
view.fileManagerWidget.navigate("/home/menu");
menu = openContextMenu();
const pasteShortcutItem = menu.children.find((item) => item.textContent === "粘贴快捷方式");
assert.ok(pasteShortcutItem, "file manager context menu offers paste shortcut");
pasteShortcutItem.click();
assert.equal(view.virtualFileSystem.readFile("/home/menu/his.lnk"), "/opt/his");

assert.equal(view.saveToMemory(), true);
assert.deepEqual(loader.cache.get("data/virtual-filesystem.json"), view.virtualFileSystem.snapshot());
assert.equal(await view.writeToDisk(), true);
assert.deepEqual(diskDocument, view.virtualFileSystem.snapshot(), "disk write reads back the edited canonical initial tree");
const cacheBeforeInvalidDraft = structuredClone(loader.cache.get("data/virtual-filesystem.json"));
const diskBeforeInvalidDraft = structuredClone(diskDocument);
view.virtualFileSystem.entries.get("/home/desktop/editor-probe.txt").metadata = { coreOnly: false };
assert.equal(view.saveToMemory(), false, "invalid core-only metadata is rejected before caching");
assert.equal(await view.writeToDisk(), false, "invalid core-only metadata is rejected before disk writes");
assert.deepEqual(loader.cache.get("data/virtual-filesystem.json"), cacheBeforeInvalidDraft);
assert.deepEqual(diskDocument, diskBeforeInvalidDraft, "invalid drafts do not overwrite the canonical file");

const developerModeSource = await readFile(new URL("../dev/DeveloperMode.js", import.meta.url), "utf8");
const genericEditorSource = await readFile(new URL("../dev/DataJsonEditorView.js", import.meta.url), "utf8");
assert.match(developerModeSource, /InitialVirtualFileSystemEditorView/);
assert.doesNotMatch(developerModeSource, /DesktopIconEditorView|StartMenuEditorView|icon-editor|start-menu-editor/);
assert.match(genericEditorSource, /"virtual-filesystem\.json"/);
console.log("initial-virtual-filesystem-editor-probe: composed file/document editor, create/edit/shortcut operations, memory/disk persistence, and removal of legacy editor entries passed");
