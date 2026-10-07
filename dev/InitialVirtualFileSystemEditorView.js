// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import EventBus from "../core/EventBus.js";
import { VirtualFileSystem } from "../core/VirtualFileSystem.js";
import { createVirtualFileWidgetFactories } from "../core/VirtualFileWidgets.js";
import { downloadTextFile, writeDataFile } from "./devApi.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Edits the canonical initial VFS through the same file-manager/document widgets used at runtime. */
export class InitialVirtualFileSystemEditorView {
  constructor({ dataLoader, initialDocument, appRegistry, filePath = "virtual-filesystem.json" } = {}) {
    this.dataLoader = dataLoader;
    this.filePath = filePath;
    this.eventBus = new EventBus();
    this.virtualFileSystem = new VirtualFileSystem(clone(initialDocument), this.eventBus);
    this._buildDom();
    this._buildFileWidgets(appRegistry);
  }

  _buildDom() {
    this.el = document.createElement("section");
    this.el.className = "ng-initial-vfs-editor";

    this.toolbar = document.createElement("div");
    this.toolbar.className = "ng-initial-vfs-toolbar";
    this.saveDocumentButton = document.createElement("button");
    this.saveDocumentButton.type = "button";
    this.saveDocumentButton.textContent = t("initialVfs.saveFile");
    this.saveDocumentButton.addEventListener("click", () => this.saveDocument());
    this.saveMemoryButton = document.createElement("button");
    this.saveMemoryButton.type = "button";
    this.saveMemoryButton.textContent = t("editor.saveToMemory");
    this.saveMemoryButton.addEventListener("click", () => this.saveToMemory());
    this.downloadButton = document.createElement("button");
    this.downloadButton.type = "button";
    this.downloadButton.textContent = t("editor.download");
    this.downloadButton.addEventListener("click", () => this.download());
    this.writeDiskButton = document.createElement("button");
    this.writeDiskButton.type = "button";
    this.writeDiskButton.textContent = t("editor.writeToDisk");
    this.writeDiskButton.addEventListener("click", () => this.writeToDisk());
    this.status = document.createElement("span");
    this.status.className = "ng-initial-vfs-status";
    this.status.setAttribute("role", "status");
    this.toolbar.append(this.saveDocumentButton, this.saveMemoryButton, this.downloadButton, this.writeDiskButton, this.status);

    this.help = document.createElement("div");
    this.help.className = "ng-initial-vfs-help";
    this.help.textContent = t("initialVfs.help");
    this.panes = document.createElement("div");
    this.panes.className = "ng-initial-vfs-panes";
    this.filePane = document.createElement("div");
    this.filePane.className = "ng-initial-vfs-file-pane";
    this.documentPane = document.createElement("div");
    this.documentPane.className = "ng-initial-vfs-document-pane";
    this.panes.append(this.filePane, this.documentPane);
    this.el.append(this.toolbar, this.help, this.panes);
  }

  _buildFileWidgets(appRegistry) {
    const widgetInstances = new Map();
    let documentWidget = null;
    const factories = createVirtualFileWidgetFactories({
      virtualFileSystem: this.virtualFileSystem,
      appRegistry,
      eventBus: this.eventBus,
      openVirtualPath: (path) => documentWidget?.openFile(path),
    });
    const context = { windowInstanceId: "initial-vfs-editor", widgetInstances };
    this.filePane.appendChild(factories.fileManager(
      { widgetId: "initial-vfs-file-manager", path: "/" },
      context,
    ));
    this.documentPane.appendChild(factories.documentEditor(
      { widgetId: "initial-vfs-document-editor" },
      context,
    ));
    documentWidget = widgetInstances.get("initial-vfs-document-editor");
    // The file manager is the document picker for this composite editor; avoid
    // exposing document-menu actions that require a separate picker window.
    documentWidget.fileMenuButton.hidden = true;
    documentWidget.menu.hidden = true;
    this.fileManagerWidget = widgetInstances.get("initial-vfs-file-manager");
    this.documentWidget = documentWidget;
  }

  _snapshot() {
    if (this.documentWidget?.dirty) {
      if (!this.documentWidget.path) throw new Error(t("initialVfs.noOpenFile"));
      this.documentWidget.save();
      if (this.documentWidget.dirty) throw new Error(this.documentWidget.status.textContent || t("initialVfs.noOpenFile"));
    }
    const snapshot = this.virtualFileSystem.snapshot();
    VirtualFileSystem.validateDefaultDocument(snapshot);
    return snapshot;
  }

  _serialized() {
    return `${JSON.stringify(this._snapshot(), null, 2)}\n`;
  }

  saveDocument() {
    if (!this.documentWidget?.path) {
      this.status.textContent = t("initialVfs.noOpenFile");
      return false;
    }
    this.documentWidget.save();
    if (this.documentWidget.dirty) {
      this.status.textContent = this.documentWidget.status.textContent;
      return false;
    }
    this.status.textContent = t("document.saved");
    return true;
  }

  saveToMemory() {
    try {
      const snapshot = JSON.parse(this._serialized());
      this.dataLoader.cache.set(this.dataLoader.resolve(this.filePath), clone(snapshot));
      this.status.textContent = t("editor.savedToMemory");
      return true;
    } catch (error) {
      this.status.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`;
      return false;
    }
  }

  download() {
    try {
      const text = this._serialized();
      downloadTextFile(this.filePath.split("/").at(-1), text);
      this.status.textContent = t("editor.downloaded");
      return true;
    } catch (error) {
      this.status.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`;
      return false;
    }
  }

  async writeToDisk() {
    try {
      const text = this._serialized();
      const expected = JSON.parse(text);
      await writeDataFile(this.filePath, text);
      const persisted = await this.dataLoader.loadJSON(this.filePath, { cache: false });
      if (JSON.stringify(persisted) !== JSON.stringify(expected)) throw new Error(t("editor.diskReadbackMismatch"));
      this.dataLoader.cache.set(this.dataLoader.resolve(this.filePath), clone(persisted));
      this.status.textContent = t("editor.wroteToDisk");
      return true;
    } catch (error) {
      this.status.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`;
      return false;
    }
  }
}

export default InitialVirtualFileSystemEditorView;
// DEV-TOOLS:END
