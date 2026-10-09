// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
/** Visual runtime-save debugger. It never edits or writes canonical game JSON. */
export class SaveDebuggerView {
  constructor({ saveManager } = {}) {
    this.saveManager = saveManager;
    this.el = document.createElement("div");
    this.el.className = "ng-dev-save-debugger";
    this.el.innerHTML = `
      <div class="ng-dev-toolbar">
        <button type="button" data-action="read">${t("legacy.09e57168614c")}</button>
        <button type="button" data-action="apply">${t("legacy.df385b3b9f95")}</button>
      </div>
      <p class="ng-dev-help">${t("legacy.d9e6375884e5")}JSON ${t("legacy.34c64b2b4026")}</p>
      <div class="ng-save-debugger-fields" data-role="fields"></div>
      <output data-role="status"></output>
    `;
    this.fieldsEl = this.el.querySelector('[data-role="fields"]');
    this.statusEl = this.el.querySelector('[data-role="status"]');
    this.el.querySelector('[data-action="read"]').addEventListener("click", () => this.read());
    this.el.querySelector('[data-action="apply"]').addEventListener("click", () => this.apply());
    this.read();
  }

  _field(label, value, path, type = "text") {
    const row = document.createElement("label");
    row.className = "ng-save-debugger-field";
    row.textContent = label;
    const input = document.createElement(type === "textarea" ? "textarea" : "input");
    input.type = type === "textarea" ? undefined : type;
    input.value = type === "checkbox" ? "" : (typeof value === "string" ? value : String(value ?? ""));
    if (type === "checkbox") input.checked = Boolean(value);
    input.dataset.path = path;
    input.dataset.valueType = type;
    if (type === "textarea") input.spellcheck = false;
    row.append(input);
    return row;
  }

  _section(title) {
    const section = document.createElement("fieldset");
    section.className = "ng-save-debugger-section";
    const legend = document.createElement("legend");
    legend.textContent = title;
    section.append(legend);
    return section;
  }

  read() {
    try {
      const envelope = this.saveManager.snapshot();
      const state = envelope.state;
      this.fieldsEl.replaceChildren();

      const clock = this._section(t("legacy.467ce31a8417"));
      clock.append(this._field(t("legacy.b6fed9af8313"), state.gameClock.day, "gameClock.day", "number"));
      clock.append(this._field(t("legacy.28bf227b9bf7"), state.gameClock.minutes, "gameClock.minutes", "number"));
      this.fieldsEl.append(clock);

      const gameState = this._section(t("legacy.547e60af7794"));
      for (const key of ["day", "phase", "duty", "location", "energy", "mental", "physical", "satiety"]) {
        const value = state.gameState[key];
        gameState.append(this._field(key, value, `gameState.${key}`, typeof value === "number" ? "number" : "text"));
      }
      this.fieldsEl.append(gameState);

      const variables = this._section(t("legacy.6d480f049924"));
      for (const [key, value] of Object.entries(state.variables)) {
        const type = typeof value === "boolean" ? "checkbox" : (typeof value === "number" ? "number" : (value && typeof value === "object" ? "textarea" : "text"));
        const display = type === "textarea" ? JSON.stringify(value, null, 2) : value;
        variables.append(this._field(key, display, `variables.${key}`, type));
      }
      if (!Object.keys(state.variables).length) variables.append(document.createTextNode(t("legacy.0bfe114481a7")));
      this.fieldsEl.append(variables);

      const publicVariables = this._section(t("legacy.4f0efc6ac572"));
      const definitions = new Map(this.saveManager.publicVariableManager?.list().map((item) => [String(item.id), item]) || []);
      for (const [id, value] of Object.entries(state.publicVariables)) {
        const definition = definitions.get(id);
        const label = definition ? `${definition.name} (#${id})` : `${t("legacy.c812a722713f")}#${id}`;
        const type = typeof value === "boolean" ? "checkbox" : (typeof value === "number" ? "number" : (value && typeof value === "object" ? "textarea" : "text"));
        const display = type === "textarea" ? JSON.stringify(value, null, 2) : value;
        publicVariables.append(this._field(label, display, `publicVariables.${id}`, type));
      }
      this.fieldsEl.append(publicVariables);

      const summary = this._section(t("legacy.beb255c18677"));
      summary.append(document.createTextNode(`${t("legacy.bc41610e4666")}${Object.keys(state.queues || {}).length} ${t("legacy.49572aa2ae35")}${(state.windows || []).length} ${t("legacy.e2a6453021ca")}${Object.keys(state.runtime || {}).length} ${t("legacy.f7b2a6ee68ec")}`));
      this.fieldsEl.append(summary);
      this.statusEl.textContent = t("legacy.28d6effd89bd");
    } catch (error) {
      this.statusEl.textContent = `${t("legacy.d9f607a20068")}: ${error.message}`;
    }
  }

  _readValue(input) {
    const type = input.dataset.valueType;
    if (type === "checkbox") return input.checked;
    if (type === "number") return Number(input.value);
    if (type === "textarea") return JSON.parse(input.value);
    return input.value;
  }

  apply() {
    try {
      const envelope = this.saveManager.snapshot();
      for (const input of this.fieldsEl.querySelectorAll("[data-path]")) {
        const separator = input.dataset.path.indexOf(".");
        const group = input.dataset.path.slice(0, separator);
        const key = input.dataset.path.slice(separator + 1);
        const value = this._readValue(input);
        if (group === "gameClock" || group === "gameState") envelope.state[group][key] = value;
        else if (group === "variables") envelope.state.variables[key] = value;
        else if (group === "publicVariables") envelope.state.publicVariables[key] = value;
      }
      this.saveManager.restore(envelope);
      this.statusEl.textContent = t("legacy.e1a5cef1136b");
      this.read();
    } catch (error) {
      this.statusEl.textContent = `${t("legacy.64c04880b21f")}: ${error.message}`;
    }
  }
}

export default SaveDebuggerView;
// DEV-TOOLS:END
