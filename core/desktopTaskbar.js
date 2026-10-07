import { t } from "./i18n/index.js";
/**
 * Taskbar - renders task buttons for every open window and a clock. Reads
 * window state from WindowManager only; never mutates it directly except
 * through the manager's own methods (focus/toggleMinimize).
 */
export class Taskbar {
  constructor(windowManager, eventBus, rootEl) {
    this.windowManager = windowManager;
    this.eventBus = eventBus;
    this.rootEl = rootEl;
    this._unsubscribers = [];
    this._buildDom();
    this._bindEvents();
    this.render();
  }

  _buildDom() {
    this.rootEl.innerHTML = `
      <button type="button" class="start-button bevel-out">
        <span class="start-icon">🗔</span><span>${t("legacy.79cc871ca992")}</span>
      </button>
      <div class="start-menu" hidden></div>
      <div class="taskbar-tasks"></div>
      <div class="taskbar-status">
        <span class="taskbar-clock"></span>
      </div>
    `;
    this.tasksEl = this.rootEl.querySelector(".taskbar-tasks");
    this.clockEl = this.rootEl.querySelector(".taskbar-clock");
    this.startButtonEl = this.rootEl.querySelector(".start-button");
    this.startMenuEl = this.rootEl.querySelector(".start-menu");
  }

  _bindEvents() {
    ["window:opened", "window:closed", "window:focused", "window:minimized", "window:restored"].forEach((name) => {
      this._unsubscribers.push(this.eventBus.on(name, () => this.render()));
    });
    this.startButtonEl.addEventListener("click", (event) => {
      event.stopPropagation();
      this.startMenuEl.hidden = !this.startMenuEl.hidden;
    });
    this._outsideClick = () => { this.startMenuEl.hidden = true; };
    document.addEventListener("click", this._outsideClick);
  }

  /** Uses the desktop icon registry as the Start menu's application registry. */
  setApps(icons, onLaunch) {
    this.apps = (icons || []).filter((icon) => icon.startMenu !== false).map((icon) => ({ icon, onLaunch }));
    this._renderStartMenu();
  }

  _renderStartMenu() {
    if (!this.startMenuEl) return;
    this.startMenuEl.replaceChildren();
    const apps = this.apps || [];
    const phase = apps.find(({ icon }) => icon.programId === "off-duty-open" || icon.iconId === "/home/menu/下班.lnk");
    const regularApps = apps.filter(({ icon }) => icon !== phase?.icon);
    const heading = document.createElement("div");
    heading.className = "start-menu-group-title";
    heading.textContent = t("legacy.4562024ddec7");
    this.startMenuEl.appendChild(heading);
    for (const entry of regularApps) {
      this._appendStartMenuItem(entry);
    }
    if (phase) {
      const separator = document.createElement("div");
      separator.className = "start-menu-separator";
      this.startMenuEl.appendChild(separator);
      this._appendStartMenuItem(phase, "start-menu-phase-item");
    }
  }

  _appendStartMenuItem({ icon, onLaunch }, extraClass = "") {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `start-menu-item${extraClass ? ` ${extraClass}` : ""}`;
      item.dataset.iconId = icon.iconId;
      const glyph = document.createElement("span");
      glyph.className = "start-menu-item-icon";
      glyph.textContent = icon.glyph || "📦";
      const label = document.createElement("span");
      label.textContent = icon.label || icon.iconId;
      item.append(glyph, label);
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        this.startMenuEl.hidden = true;
        onLaunch?.(icon);
      });
      this.startMenuEl.appendChild(item);
      return item;
  }

  render() {
    const windows = this.windowManager.list();
    const focusedId = this.windowManager.focusedInstanceId();
    this.tasksEl.innerHTML = "";
    for (const state of windows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "taskbar-task bevel-out";
      button.classList.toggle("active", state.instanceId === focusedId && !state.minimized);
      const iconSpan = document.createElement("span");
      iconSpan.className = "taskbar-task-icon";
      iconSpan.textContent = state.icon || "🗔";
      const titleSpan = document.createElement("span");
      titleSpan.className = "taskbar-task-title";
      titleSpan.textContent = state.title;
      button.append(iconSpan, titleSpan);
      button.addEventListener("click", () => {
        if (state.minimized || state.instanceId !== focusedId) {
          this.windowManager.restore(state.instanceId);
          this.windowManager.focus(state.instanceId);
        } else {
          this.windowManager.minimize(state.instanceId);
        }
      });
      this.tasksEl.appendChild(button);
    }
  }

  /** Displays engine/game status text; never reads the system clock. */
  setClockText(text) {
    this.clockEl.textContent = text;
  }

  dispose() {
    this._unsubscribers.forEach((unsubscribe) => unsubscribe());
    this._unsubscribers = [];
    if (this._outsideClick) document.removeEventListener("click", this._outsideClick);
  }
}

export default Taskbar;
