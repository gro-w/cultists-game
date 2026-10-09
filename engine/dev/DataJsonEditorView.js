// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { downloadTextFile, writeDataFile } from "./devApi.js";
import { encodeCl2Blueprints } from "../core/Cl2EmbeddedSerializer.js";
import { VirtualFileSystem } from "../core/VirtualFileSystem.js";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function setAt(root, path, value) {
  if (!path.length) return value;
  const next = clone(root);
  let cursor = next;
  for (let i = 0; i < path.length - 1; i += 1) cursor = cursor[path[i]];
  cursor[path[path.length - 1]] = value;
  return next;
}

function deleteAt(root, path) {
  const next = clone(root);
  if (!path.length) return next;
  let cursor = next;
  for (let i = 0; i < path.length - 1; i += 1) cursor = cursor[path[i]];
  if (Array.isArray(cursor)) cursor.splice(path[path.length - 1], 1);
  else delete cursor[path[path.length - 1]];
  return next;
}

function isSpecializedDataFile(path) {
  if (path.startsWith("activities/") || path.startsWith("activity-lists/") || path.startsWith("windows/")) return true;
  return new Set([
    "structures.framework.json",
    "databases.framework.json",
    "seed-records.json",
    "seed-records-items.json",
    "public-variables.framework.json",
    "onboarding.json",
    "virtual-filesystem.json",
    "blueprint-nodes.framework.json",
    "app-definitions.json",
  ]).has(path);
}

/** Generic visual fallback editor for JSON documents without a domain editor. */
export class DataJsonEditorView {
  constructor({ dataLoader, dataFiles = [] } = {}) {
    this.dataLoader = dataLoader;
    this.dataFiles = [...new Set(dataFiles.filter((path) => !isSpecializedDataFile(path)).concat("data-files.json"))].sort();
    this.selectedPath = null;
    this.draft = null;
    this._buildDom();
    this.renderList();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager ng-data-json-editor";
    el.innerHTML = `
      <div class="ng-list-manager-lists">
        <div class="ng-list-manager-toolbar"><input type="search" data-role="filter" placeholder="${t("legacy.cd72ec0f53cd")}JSON ${t("legacy.49deaf7da20d")}" /></div>
        <div class="ng-list-manager-list-items"></div>
      </div>
      <div class="ng-list-manager-activities">
        <div class="ng-list-manager-toolbar">
          <strong data-role="filename">${t("legacy.63b2603c5b9d")}JSON ${t("legacy.49deaf7da20d")}</strong>
          <button type="button" data-action="save-memory">${t("editor.saveToMemory")}</button>
          <button type="button" data-action="download">${t("legacy.3f10b573ee1b")}JSON</button>
          <button type="button" data-action="write-disk">${t("editor.writeToDisk")}</button>
          <span class="ng-editor-status"></span>
        </div>
        <div class="ng-data-json-tree" data-role="tree"></div>
      </div>`;
    this.el = el;
    this.listEl = el.querySelector('[class="ng-list-manager-list-items"]');
    this.filterEl = el.querySelector('[data-role="filter"]');
    this.filenameEl = el.querySelector('[data-role="filename"]');
    this.treeEl = el.querySelector('[data-role="tree"]');
    this.statusEl = el.querySelector(".ng-editor-status");
    this.filterEl.addEventListener("input", () => this.renderList());
    el.querySelector('[data-action="save-memory"]').addEventListener("click", () => this.saveToMemory());
    el.querySelector('[data-action="download"]').addEventListener("click", () => this.download());
    el.querySelector('[data-action="write-disk"]').addEventListener("click", () => this.save());
  }

  renderList() {
    const query = this.filterEl?.value.trim().toLowerCase() || "";
    this.listEl.innerHTML = "";
    for (const path of this.dataFiles.filter((item) => item.toLowerCase().includes(query))) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ng-list-manager-list-item${path === this.selectedPath ? " selected" : ""}`;
      button.textContent = path;
      button.addEventListener("click", () => this.open(path));
      this.listEl.appendChild(button);
    }
  }

  async open(path) {
    try {
      this.draft = clone(await this.dataLoader.loadJSON(path, { cache: false }));
      this.selectedPath = path;
      this.filenameEl.textContent = path;
      this.statusEl.textContent = "";
      this.renderList();
      this.renderTree();
    } catch (error) {
      this.statusEl.textContent = `${t("legacy.d9f607a20068")}: ${error.message}`;
    }
  }

  renderTree() {
    this.treeEl.innerHTML = "";
    if (this.draft === null || this.draft === undefined) {
      this.treeEl.textContent = t("legacy.0f849360133e");
      return;
    }
    this.treeEl.appendChild(this.renderValue(this.draft, [], "root"));
  }

  renderValue(value, path, label) {
    const row = document.createElement("fieldset");
    row.className = "ng-data-json-node";
    const legend = document.createElement("legend");
    legend.textContent = label;
    row.appendChild(legend);
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const child = this.renderValue(item, [...path, index], `[${index}]`);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = t("legacy.3755f56f2f83");
        remove.addEventListener("click", () => { this.draft = deleteAt(this.draft, [...path, index]); this.renderTree(); });
        child.appendChild(remove);
        row.appendChild(child);
      });
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = t("legacy.92909a50d97e");
      add.addEventListener("click", () => { this.draft = setAt(this.draft, path, [...value, ""]); this.renderTree(); });
      row.appendChild(add);
      return row;
    }
    if (value && typeof value === "object") {
      for (const [key, childValue] of Object.entries(value)) {
        const child = this.renderValue(childValue, [...path, key], key);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = t("legacy.f49294e6c8bc");
        remove.addEventListener("click", () => { this.draft = deleteAt(this.draft, [...path, key]); this.renderTree(); });
        child.appendChild(remove);
        row.appendChild(child);
      }
      const addKey = document.createElement("button");
      addKey.type = "button";
      addKey.textContent = t("legacy.6dca5a34884b");
      addKey.addEventListener("click", () => {
        const key = prompt(t("legacy.a0c9218e4629"));
        if (!key || Object.prototype.hasOwnProperty.call(value, key)) return;
        this.draft = setAt(this.draft, path, { ...value, [key]: "" });
        this.renderTree();
      });
      row.appendChild(addKey);
      return row;
    }
    const input = document.createElement("input");
    if (typeof value === "boolean") {
      input.type = "checkbox";
      input.checked = value;
      input.addEventListener("change", () => { this.draft = setAt(this.draft, path, input.checked); });
    } else {
      input.type = typeof value === "number" ? "number" : "text";
      input.value = value ?? "";
      input.step = "any";
      input.addEventListener("change", () => {
        const next = typeof value === "number" ? Number(input.value) : input.value;
        this.draft = setAt(this.draft, path, next);
      });
    }
    row.appendChild(input);
    return row;
  }

  validateDraft() {
    if (this.selectedPath === "virtual-filesystem.json") VirtualFileSystem.validateDefaultDocument(this.draft);
  }

  serializedDraft() {
    this.validateDraft();
    return encodeCl2Blueprints(this.draft, this.selectedPath);
  }

  async save() {
    if (!this.selectedPath) return;
    try {
      const value = this.serializedDraft();
      const text = `${JSON.stringify(value, null, 2)}\n`;
      await writeDataFile(this.selectedPath, text);
      const persisted = await this.dataLoader.loadJSON(this.selectedPath, { cache: false });
      if (JSON.stringify(persisted) !== JSON.stringify(this.draft)) throw new Error(t("editor.diskReadbackMismatch"));
      this.dataLoader.cache.set(this.dataLoader.resolve(this.selectedPath), clone(persisted));
      this.statusEl.textContent = t("editor.wroteToDisk");
    } catch (error) {
      this.statusEl.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`;
    }
  }

  saveToMemory() {
    if (!this.selectedPath || this.draft === null) return;
    try {
      const value = this.serializedDraft();
      this.dataLoader.cache.set(this.dataLoader.resolve(this.selectedPath), clone(value));
      this.statusEl.textContent = t("editor.savedToMemory");
    } catch (error) {
      this.statusEl.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`;
    }
  }

  download() {
    if (!this.selectedPath || this.draft === null) return;
    try {
      const value = this.serializedDraft();
      const filename = this.selectedPath.split("/").at(-1);
      downloadTextFile(filename, `${JSON.stringify(value, null, 2)}\n`);
      this.statusEl.textContent = t("editor.downloaded");
    } catch (error) {
      this.statusEl.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`;
    }
  }
}

export default DataJsonEditorView;
// DEV-TOOLS:END
