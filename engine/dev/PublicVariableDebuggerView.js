// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
/**
 * PublicVariableDebuggerView - runtime debugger for the live
 * `PublicVariableManager` (plan §10.3-equivalent runtime inspection,
 * mirrors DatabaseDebuggerView's "不能在 UI 中直接改状态绕过 API" rule).
 * Lists every registered public-variable definition alongside its current
 * live value and lets a developer edit it - but exclusively through
 * `PublicVariableManager.set()`/`setObjectRef()`, never by reaching into
 * its internal Map, so type coercion/bounds/persistence semantics are
 * never bypassed even from developer tools. Never writes back to
 * data/public-variables.framework.json - that's PublicVariableEditorView's job.
 */
export class PublicVariableDebuggerView {
  constructor({ publicVariableManager } = {}) {
    this.publicVariableManager = publicVariableManager;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-activities" style="width:100%">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="refresh">${t("legacy.38108eaa1d32")}</button>
          <span class="ng-editor-status"></span>
        </div>
        <div class="ng-database-debugger-records ng-public-variable-debugger-rows"></div>
      </div>
    `;
    this.el = el;
    this.rowsEl = el.querySelector(".ng-public-variable-debugger-rows");
    this.statusEl = el.querySelector(".ng-editor-status");
    el.querySelector('[data-action="refresh"]').addEventListener("click", () => this.render());
  }

  render() {
    this.rowsEl.innerHTML = "";
    for (const definition of this.publicVariableManager.list()) {
      this.rowsEl.appendChild(this._renderRow(definition));
    }
  }

  _renderRow(definition) {
    const row = document.createElement("div");
    row.className = "ng-window-editor-structure-row";

    const label = document.createElement("span");
    label.textContent = `${definition.id} ${definition.name} (${definition.type})`;

    const value = this.publicVariableManager.get(definition.id);
    let input;
    if (definition.type === "bool") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(value);
      input.addEventListener("change", () => this._apply(definition, input.checked));
    } else if (definition.type === "object") {
      input = document.createElement("input");
      input.placeholder = "{objectType, objectId} (JSON) or empty to clear";
      input.value = value ? JSON.stringify(value) : "";
    } else {
      input = document.createElement("input");
      input.value = value ?? "";
    }
    if (definition.readOnly) input.disabled = true;

    const setButton = document.createElement("button");
    setButton.type = "button";
    setButton.textContent = t("legacy.7debf9cb0372");
    setButton.disabled = Boolean(definition.readOnly);
    setButton.addEventListener("click", () => {
      if (definition.type === "bool") return; // checkbox applies immediately on change
      if (definition.type === "object") {
        if (!input.value) return this._apply(definition, null, true);
        try {
          const ref = JSON.parse(input.value);
          this._apply(definition, ref, true);
        } catch (err) {
          this.statusEl.textContent = `${t("legacy.7f77f4569549")}: ${err.message}`;
        }
        return;
      }
      this._apply(definition, input.value);
    });

    row.append(label, input, setButton);
    return row;
  }

  _apply(definition, value, isObjectRef = false) {
    try {
      if (isObjectRef) this.publicVariableManager.setObjectRef(definition.id, value);
      else this.publicVariableManager.set(definition.id, value);
      this.statusEl.textContent = t("legacy.112f98675ee2");
      this.render();
    } catch (err) {
      this.statusEl.textContent = `${t("legacy.8f8818f05bfa")}: ${err.message}`;
    }
  }
}

export default PublicVariableDebuggerView;
// DEV-TOOLS:END
