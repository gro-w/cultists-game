// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
/**
 * WindowDefinitionManagerView - lists loaded window definitions and opens
 * each one in a WindowEditorView (plan §7). Operates directly on the live
 * `WindowDefinitionStore` (plan follow-up: "自定义窗口管理器也可以+-按钮
 * (新建、删除、复制)") so new/duplicate/delete actions are immediately
 * visible without a separate draft/refresh step, mirroring how
 * DataStructureEditorView edits its live manager instance directly.
 */
function defaultWindowDefinition(id) {
  return {
    id,
    title: id,
    icon: "🪟",
    mode: "window",
    fullscreen: false,
    x: 80,
    y: 60,
    width: 480,
    height: 320,
    root: { widgetId: "root", type: "container", flow: "stack", gap: 8, padding: 10, children: [] },
    events: { onCreate: null, onDestroy: null },
  };
}

export class WindowDefinitionManagerView {
  constructor(windowDefinitionStore, { openEditor } = {}) {
    this.windowDefinitionStore = windowDefinitionStore;
    this.openEditor = openEditor || (() => {});
    this.selectedId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists" style="width:100%;">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new">${t("legacy.7dd1b16c1a3b")}</button>
          <button type="button" data-action="duplicate">${t("legacy.8fcd42990517")}</button>
          <button type="button" data-action="delete">${t("legacy.3feeec112412")}</button>
          <span class="ng-editor-status">${t("legacy.8121d2e98d77")}WYSIWYG ${t("legacy.de52b1ca16dc")}</span>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
    `;
    this.el = el;
    this.itemsEl = el.querySelector(".ng-list-manager-list-items");
    this.statusEl = el.querySelector(".ng-editor-status");

    el.querySelector('[data-action="new"]').addEventListener("click", () => {
      const id = prompt(t("legacy.580a4fff7e38"));
      if (!id) return;
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) { this.statusEl.textContent = "Window ID must use letters, digits, _ or - and start with a letter"; return; }
      if (this.windowDefinitionStore.get(id)) { this.statusEl.textContent = `${t("legacy.02f536ce5393")}"${id}" ${t("legacy.a867d42ddf26")}`; return; }
      this.windowDefinitionStore.register(defaultWindowDefinition(id));
      this.selectedId = id;
      this.render();
    });
    el.querySelector('[data-action="duplicate"]').addEventListener("click", () => {
      if (!this.selectedId) return;
      const source = this.windowDefinitionStore.get(this.selectedId);
      if (!source) return;
      const id = prompt(t("legacy.580a4fff7e38"), `${this.selectedId}-copy`);
      if (!id) return;
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) { this.statusEl.textContent = "Window ID must use letters, digits, _ or - and start with a letter"; return; }
      if (this.windowDefinitionStore.get(id)) { this.statusEl.textContent = `${t("legacy.02f536ce5393")}"${id}" ${t("legacy.a867d42ddf26")}`; return; }
      this.windowDefinitionStore.register({ ...JSON.parse(JSON.stringify(source)), id });
      this.selectedId = id;
      this.render();
    });
    el.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!this.selectedId) return;
      this.windowDefinitionStore.unregister(this.selectedId);
      this.selectedId = null;
      this.render();
    });
  }

  render() {
    this.itemsEl.innerHTML = "";
    // Only definitions with a `root` widget tree are WYSIWYG-editable (plan
    // §7.1); legacy `body`-only definitions (e.g. example.json, or dev-tool
    // windows registered by DeveloperMode itself) have no editable
    // structure and would otherwise crash the editor on open.
    for (const definition of this.windowDefinitionStore.list().filter((definition) => definition.root)) {
      const item = document.createElement("div");
      item.className = "ng-list-manager-list-item" + (definition.id === this.selectedId ? " selected" : "");
      item.textContent = `${definition.id}${definition.fullscreen ? ` (${t("legacy.93c44f6b1b28")})` : ""}`;
      item.addEventListener("click", () => { this.selectedId = definition.id; this.render(); });
      item.addEventListener("dblclick", () => this.openEditor(definition));
      this.itemsEl.appendChild(item);
    }
  }
}

export default WindowDefinitionManagerView;
// DEV-TOOLS:END
