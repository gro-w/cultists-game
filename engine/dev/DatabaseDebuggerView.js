// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { writeDataFile } from "./devApi.js";
import { ActivityEditorView } from "./ActivityEditorView.js";

const clone = (value) => structuredClone(value);

function primaryKeyOf(dataStore, databaseId, record) {
  const db = dataStore.listDatabases().find((entry) => entry.databaseId === databaseId);
  return record?.[db?.primaryKey || "id"];
}

/** First window: choose a database, then open its record editor in a new window. */
export class DatabaseEditorView {
  constructor({ dataStore, dataStructureManager, dataLoader, onOpenDatabase } = {}) {
    this.dataStore = dataStore;
    this.dataStructureManager = dataStructureManager;
    this.dataLoader = dataLoader;
    this.onOpenDatabase = onOpenDatabase;
    this.selectedDatabaseId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-database-selector-editor";
    this.el.innerHTML = `
      <div class="ng-database-selector-toolbar">
        <button type="button" data-action="refresh">${t("legacy.38108eaa1d32")}</button>
        <button type="button" data-action="open">${t("legacy.65fc81e16119")}</button>
        <span class="ng-editor-status"></span>
      </div>
      <div class="ng-database-selector-list"></div>`;
    this.listEl = this.el.querySelector(".ng-database-selector-list");
    this.statusEl = this.el.querySelector(".ng-editor-status");
    this.el.querySelector('[data-action="refresh"]').addEventListener("click", () => this.render());
    this.el.querySelector('[data-action="open"]').addEventListener("click", () => {
      if (!this.selectedDatabaseId) return;
      this.onOpenDatabase?.(this.selectedDatabaseId);
    });
  }

  render() {
    const databases = this.dataStore.listDatabases();
    if (!this.selectedDatabaseId || !databases.some((db) => db.databaseId === this.selectedDatabaseId)) {
      this.selectedDatabaseId = databases[0]?.databaseId || null;
    }
    this.listEl.replaceChildren();
    databases.forEach((db) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `ng-database-selector-row${db.databaseId === this.selectedDatabaseId ? " selected" : ""}`;
      row.dataset.databaseId = db.databaseId;
      row.textContent = `${db.databaseId}（${db.recordCount} ${t("legacy.372545bb9e8e")}`;
      row.addEventListener("click", () => { this.selectedDatabaseId = db.databaseId; this.render(); });
      row.addEventListener("dblclick", () => this.onOpenDatabase?.(db.databaseId));
      this.listEl.appendChild(row);
    });
    this.statusEl.textContent = this.selectedDatabaseId ? `${t("legacy.9c5605840c67")}${this.selectedDatabaseId}` : t("legacy.0c64a3dc077d");
  }
}

/** Second window: choose records on the left and edit one record on the right. */
export class DatabaseRecordEditorView {
  constructor({ dataStore, dataStructureManager, dataLoader, databaseId } = {}) {
    this.dataStore = dataStore;
    this.dataStructureManager = dataStructureManager;
    this.dataLoader = dataLoader;
    this.databaseId = databaseId;
    this.selectedKey = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-database-record-editor";
    this.el.innerHTML = `
      <aside class="ng-database-record-list">
        <div class="ng-database-record-list-toolbar">
          <button type="button" data-action="add" title="${t("legacy.3f6da571c706")}">＋</button>
          <button type="button" data-action="copy" title="${t("legacy.d6ba3a9ab8e1")}">⧉</button>
          <button type="button" data-action="delete" title="${t("legacy.8dd153b49f26")}">−</button>
          <button type="button" data-action="save-file" title="${t("legacy.cd94cdb2b03b")}">💾</button>
        </div>
        <div class="ng-database-record-items"></div>
      </aside>
      <main class="ng-database-record-inspector">
        <div class="ng-database-record-toolbar"><strong class="ng-database-record-title"></strong><span class="ng-editor-status"></span></div>
        <div class="ng-database-record-fields"></div>
      </main>`;
    this.listEl = this.el.querySelector(".ng-database-record-items");
    this.fieldsEl = this.el.querySelector(".ng-database-record-fields");
    this.titleEl = this.el.querySelector(".ng-database-record-title");
    this.statusEl = this.el.querySelector(".ng-editor-status");
    this.el.querySelector('[data-action="add"]').addEventListener("click", () => this.addRecord());
    this.el.querySelector('[data-action="copy"]').addEventListener("click", () => this.copyRecord());
    this.el.querySelector('[data-action="delete"]').addEventListener("click", () => this.deleteRecord());
    this.el.querySelector('[data-action="save-file"]').addEventListener("click", () => this.saveDatabase());
  }

  _db() { return this.dataStore.listDatabases().find((entry) => entry.databaseId === this.databaseId); }
  _records() { return this.dataStore.findRecords(this.databaseId, {}); }

  addRecord() {
    try {
      const record = this.dataStore.createRecord(this.databaseId, {});
      this.selectedKey = primaryKeyOf(this.dataStore, this.databaseId, record);
      this.render();
    } catch (error) { this.statusEl.textContent = `${t("legacy.1bd8bc7cc1b7")}${error.message}`; }
  }

  copyRecord() {
    const source = this._records().find((record) => primaryKeyOf(this.dataStore, this.databaseId, record) === this.selectedKey);
    if (!source) return;
    try {
      const db = this._db();
      const copy = { ...clone(source) };
      delete copy[db.primaryKey];
      const record = this.dataStore.createRecord(this.databaseId, copy);
      this.selectedKey = primaryKeyOf(this.dataStore, this.databaseId, record);
      this.render();
    } catch (error) { this.statusEl.textContent = `${t("legacy.db4f6b3a4c3b")}${error.message}`; }
  }

  deleteRecord() {
    if (this.selectedKey == null) return;
    try {
      this.dataStore.deleteRecord(this.databaseId, this.selectedKey);
      this.selectedKey = null;
      this.render();
    } catch (error) { this.statusEl.textContent = `${t("legacy.2b5829a325d7")}${error.message}`; }
  }

  render() {
    const records = this._records();
    if (!records.some((record) => primaryKeyOf(this.dataStore, this.databaseId, record) === this.selectedKey)) {
      this.selectedKey = records[0] ? primaryKeyOf(this.dataStore, this.databaseId, records[0]) : null;
    }
    this.listEl.replaceChildren();
    records.forEach((record) => {
      const key = primaryKeyOf(this.dataStore, this.databaseId, record);
      const row = document.createElement("button");
      row.type = "button";
      row.className = `ng-database-record-item${key === this.selectedKey ? " selected" : ""}`;
      row.dataset.recordKey = key;
      row.textContent = String(record.name || record.displayName || key);
      row.addEventListener("click", () => { this.selectedKey = key; this.render(); });
      this.listEl.appendChild(row);
    });
    this.renderInspector(records.find((record) => primaryKeyOf(this.dataStore, this.databaseId, record) === this.selectedKey));
  }

  renderInspector(record) {
    this.fieldsEl.replaceChildren();
    const db = this._db();
    this.titleEl.textContent = `${this.databaseId} / ${this.selectedKey ?? t("legacy.2e2bb61ef72f")}`;
    if (!record || !db) return;
    const structure = this.dataStructureManager?.get(db.recordType);
    const controls = new Map();
    for (const field of structure?.fields || Object.keys(record).map((id) => ({ id, type: "string" }))) {
      if (field.type === "activity") continue;
      const label = document.createElement("label");
      label.className = "ng-database-record-field";
      const caption = document.createElement("span");
      caption.textContent = `${field.id}（${field.type}）`;
      const control = ["bool"].includes(field.type) ? document.createElement("input") : document.createElement(["array", "object"].includes(field.type) || field.type.startsWith("array<") ? "textarea" : "input");
      if (field.type === "bool") { control.type = "checkbox"; control.checked = Boolean(record[field.id]); }
      else if (["integer", "smallInteger", "real"].includes(field.type)) { control.type = "number"; control.step = field.type === "real" ? "any" : "1"; control.value = record[field.id] ?? ""; }
      else if (["array", "object"].includes(field.type) || field.type.startsWith("array<")) { control.rows = 4; control.value = JSON.stringify(record[field.id] ?? (field.type === "object" ? {} : []), null, 2); }
      else { control.type = "text"; control.value = record[field.id] ?? ""; }
      controls.set(field.id, { control, field });
      label.append(caption, control); this.fieldsEl.appendChild(label);
    }
    const save = document.createElement("button"); save.type = "button"; save.textContent = t("legacy.61bc0b0ca8b1");
    save.addEventListener("click", () => {
      try {
        const patch = {};
        controls.forEach(({ control, field }, id) => {
          if (field.type === "bool") patch[id] = control.checked;
          else if (["integer", "smallInteger", "real"].includes(field.type)) patch[id] = Number(control.value);
          else if (["array", "object"].includes(field.type) || field.type.startsWith("array<")) patch[id] = JSON.parse(control.value || (field.type === "object" ? "{}" : "[]"));
          else patch[id] = control.value;
        });
        this.dataStore.updateRecord(this.databaseId, this.selectedKey, patch);
        this.statusEl.textContent = t("legacy.bedc3c6afcd3");
        this.render();
      } catch (error) { this.statusEl.textContent = `${t("legacy.b12163000cd3")}${error.message}`; }
    });
    this.fieldsEl.appendChild(save);
  }

  async saveDatabase() {
    const db = this._db();
    if (!db) return;
    try {
      const value = { [this.databaseId]: this._records() };
      await writeDataFile(db.recordFile, JSON.stringify(value, null, 2));
      this.statusEl.textContent = `${t("legacy.a39837537e98")}${db.recordFile}`;
    } catch (error) { this.statusEl.textContent = `${t("legacy.8b046d23e43c")}${error.message}`; }
  }
}

export default DatabaseEditorView;
// DEV-TOOLS:END
