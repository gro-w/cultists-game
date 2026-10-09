// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { writeDataFile } from "./devApi.js";

/**
 * OnboardingEditorView - visual editor for `data/onboarding.json` (the
 * new-手引导 hint content OnboardingManager.loadHints() reads). Mirrors
 * PublicVariableEditorView's list+detail layout: operates directly on the
 * live `OnboardingManager` instance (so edits preview immediately - a hint
 * whose `trigger` milestone was already marked can be re-requested via the
 * "预览" button), and persists via the shared `writeDataFile`. A hint is
 * `{id, trigger, completeOn, target, title, text}` - the exact shape
 * `TutorialOverlay`/`markOnboardingMilestone` already consume, so this
 * editor never needs engine changes to add a new hint.
 */
export class OnboardingEditorView {
  constructor({ eventStateRegistry } = {}) {
    this.eventStateRegistry = eventStateRegistry;
    this.selectedHintId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-hint">${t("legacy.1056316eb368")}</button>
          <button type="button" data-action="delete-hint">${t("legacy.930d1cd89578")}</button>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
      <div class="ng-list-manager-activities">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="preview">${t("legacy.3198b1f10022")}</button>
          <button type="button" data-action="save">${t("legacy.81ee3266b03d")}</button>
          <span class="ng-editor-status"></span>
        </div>
        <div class="ng-window-editor-fields"></div>
      </div>
    `;
    this.el = el;
    this.listEl = el.querySelector(".ng-list-manager-list-items");
    this.fieldsEl = el.querySelector(".ng-window-editor-fields");
    this.statusEl = el.querySelector(".ng-editor-status");

    el.querySelector('[data-action="new-hint"]').addEventListener("click", () => {
      const id = prompt(t("legacy.44dee332806c"));
      if (!id) return;
      if (this._hints().some((hint) => hint.id === id)) {
        this.statusEl.textContent = `${t("legacy.8ba8335fe501")}id "${id}" ${t("legacy.a867d42ddf26")}`;
        return;
      }
      const hints = [...this._hints(), { id, trigger: "", completeOn: "", target: "", title: "", text: "" }];
      this._applyHints(hints);
      this.selectedHintId = id;
      this.render();
    });
    el.querySelector('[data-action="delete-hint"]').addEventListener("click", () => {
      if (!this.selectedHintId) return;
      this._applyHints(this._hints().filter((hint) => hint.id !== this.selectedHintId));
      this.selectedHintId = null;
      this.render();
    });
    el.querySelector('[data-action="preview"]').addEventListener("click", () => {
      const hint = this._hints().find((h) => h.id === this.selectedHintId);
      if (!hint) return;
      this.eventStateRegistry.eventBus?.emit(this.eventStateRegistry.events.request, { ...hint });
    });
    el.querySelector('[data-action="save"]').addEventListener("click", async () => {
      try {
        await writeDataFile("onboarding.json", JSON.stringify(this._hints(), null, 2));
        this.statusEl.textContent = t("legacy.d4371481b26a");
      } catch (err) {
        this.statusEl.textContent = `${t("legacy.e92dc2256061")}: ${err.message}`;
      }
    });
  }

  _hints() {
    return this.eventStateRegistry.list();
  }

  /** Replaces the live manager's hint list (does not touch milestone/shown/dismissed progress - same contract as `loadHints`). */
  _applyHints(hints) {
    this.eventStateRegistry.loadDefinitions(hints);
  }

  render() {
    this.listEl.innerHTML = "";
    for (const hint of this._hints()) {
      const row = document.createElement("div");
      row.className = "ng-list-manager-list-item" + (hint.id === this.selectedHintId ? " selected" : "");
      row.textContent = `${hint.title || hint.id} (${hint.id})`;
      row.addEventListener("click", () => {
        this.selectedHintId = hint.id;
        this.render();
      });
      this.listEl.appendChild(row);
    }
    this._renderFields();
  }

  _renderFields() {
    this.fieldsEl.innerHTML = "";
    const hint = this._hints().find((h) => h.id === this.selectedHintId);
    if (!hint) {
      this.fieldsEl.textContent = t("legacy.3ac2ec38d85b");
      return;
    }
    const makeField = (label, key, type = "text") => {
      const row = document.createElement("label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${label}</span>`;
      const input = document.createElement(type === "textarea" ? "textarea" : "input");
      if (type !== "textarea") input.type = type;
      input.value = hint[key] || "";
      input.addEventListener("change", () => {
        const hints = this._hints().map((h) => (h.id === hint.id ? { ...h, [key]: input.value } : h));
        this._applyHints(hints);
        this.render();
      });
      row.appendChild(input);
      this.fieldsEl.appendChild(row);
    };
    makeField(t("legacy.639c44f03e8e"), "trigger");
    makeField(t("legacy.479d221dbadd"), "completeOn");
    makeField(t("legacy.6788250b065a"), "target");
    makeField(t("legacy.3f760554e45f"), "title");
    makeField(t("legacy.c4c98e32e9e7"), "text", "textarea");
  }
}

export default OnboardingEditorView;
// DEV-TOOLS:END
