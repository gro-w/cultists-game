// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { writeDataFile } from "./devApi.js";

const FIELD_TYPES = ["bool", "smallInteger", "integer", "real", "string", "objectRef", "array", "array<string>", "array<number>", "object", "activity"];

/**
 * DataStructureEditorView - visual editor for `data/structures.framework.json` (plan
 * §9.2 "结构 schema"). Lets a developer create/rename/remove structures and
 * add/edit/remove their fields (id/type/required/default) without hand
 * editing JSON, then persists via the shared `writeDataFile` + registers
 * the change into the live `DataStructureManager` immediately so any open
 * database debugger reflects the new schema right away.
 */
export class DataStructureEditorView {
  constructor({ dataStructureManager } = {}) {
    this.dataStructureManager = dataStructureManager;
    this.selectedId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-structure">${t("legacy.e00a6a41fccc")}</button>
          <button type="button" data-action="delete-structure">${t("legacy.fa06526a2ba2")}</button>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
      <div class="ng-list-manager-activities">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-field">${t("legacy.1687c80b946f")}</button>
          <button type="button" data-action="save">${t("legacy.81ee3266b03d")}</button>
          <span class="ng-editor-status"></span>
        </div>
        <div class="ng-window-editor-structure ng-data-structure-fields"></div>
      </div>
    `;
    this.el = el;
    this.listEl = el.querySelector(".ng-list-manager-list-items");
    this.fieldsEl = el.querySelector(".ng-data-structure-fields");
    this.statusEl = el.querySelector(".ng-editor-status");

    el.querySelector('[data-action="new-structure"]').addEventListener("click", () => {
      const id = prompt(t("legacy.8b7b42ae7a1c"));
      if (!id) return;
      this.dataStructureManager.register({ id, displayName: id, fields: [] });
      this.selectedId = id;
      this.render();
    });
    el.querySelector('[data-action="delete-structure"]').addEventListener("click", () => {
      if (!this.selectedId) return;
      this.dataStructureManager.unregister(this.selectedId);
      this.selectedId = null;
      this.render();
    });
    el.querySelector('[data-action="new-field"]').addEventListener("click", () => {
      const structure = this.dataStructureManager.get(this.selectedId);
      if (!structure) return;
      const fieldId = prompt(t("legacy.4eb3fef0c28d"));
      if (!fieldId) return;
      structure.fields.push({ id: fieldId, type: "string", required: false });
      this.render();
    });
    el.querySelector('[data-action="save"]').addEventListener("click", async () => {
      try {
        await writeDataFile("structures.framework.json", JSON.stringify(this.dataStructureManager.toJSON(), null, 2));
        this.statusEl.textContent = t("legacy.d4371481b26a");
      } catch (err) {
        this.statusEl.textContent = `${t("legacy.e92dc2256061")}: ${err.message}`;
      }
    });
  }

  render() {
    this.listEl.innerHTML = "";
    for (const structure of this.dataStructureManager.list()) {
      const row = document.createElement("div");
      row.className = "ng-list-manager-list-item" + (structure.id === this.selectedId ? " selected" : "");
      row.textContent = structure.id;
      row.addEventListener("click", () => { this.selectedId = structure.id; this.render(); });
      this.listEl.appendChild(row);
    }
    this._renderFields();
  }

  _renderFields() {
    this.fieldsEl.innerHTML = "";
    const structure = this.dataStructureManager.get(this.selectedId);
    if (!structure) {
      this.fieldsEl.textContent = t("legacy.f3a699bb5dab");
      return;
    }
    for (const field of structure.fields) {
      const row = document.createElement("div");
      row.className = "ng-window-editor-structure-row";

      const idInput = document.createElement("input");
      idInput.value = field.id;
      idInput.title = t("legacy.f20322fe4406");
      idInput.addEventListener("change", () => { field.id = idInput.value; this.render(); });

      const typeSelect = document.createElement("select");
      for (const type of FIELD_TYPES) {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        option.selected = field.type === type;
        typeSelect.appendChild(option);
      }
      typeSelect.addEventListener("change", () => { field.type = typeSelect.value; });

      const requiredLabel = document.createElement("label");
      const requiredCheckbox = document.createElement("input");
      requiredCheckbox.type = "checkbox";
      requiredCheckbox.checked = Boolean(field.required);
      requiredCheckbox.addEventListener("change", () => { field.required = requiredCheckbox.checked; });
      requiredLabel.append(requiredCheckbox, t("legacy.a65510ab54e6"));

      const defaultInput = document.createElement("input");
      defaultInput.placeholder = "default (JSON)";
      defaultInput.value = field.default !== undefined ? JSON.stringify(field.default) : "";
      defaultInput.addEventListener("change", () => {
        if (!defaultInput.value) { delete field.default; return; }
        try {
          field.default = JSON.parse(defaultInput.value);
        } catch (err) {
          this.statusEl.textContent = `default ${t("legacy.3695562d4879")}JSON: ${err.message}`;
        }
      });

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = t("legacy.3755f56f2f83");
      removeButton.addEventListener("click", () => {
        structure.fields = structure.fields.filter((f) => f !== field);
        this.render();
      });

      row.append(idInput, typeSelect, requiredLabel, defaultInput, removeButton);
      this.fieldsEl.appendChild(row);
    }
  }
}

export default DataStructureEditorView;
// DEV-TOOLS:END
