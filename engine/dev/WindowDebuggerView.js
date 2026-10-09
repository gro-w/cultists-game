// DEV-TOOLS:START
/** Runtime window debugger: inspect definitions and open/close instances. */
export class WindowDebuggerView {
  constructor({ windowManager, windowDefinitionStore, eventBus } = {}) {
    this.windowManager = windowManager;
    this.windowDefinitionStore = windowDefinitionStore;
    this.eventBus = eventBus;
    this.el = document.createElement("div");
    this.el.className = "ng-window-debugger";
    this._unsubscribe = [
      "window:opened", "window:closed", "window:focused", "window:minimized", "window:restored",
    ].map((name) => eventBus?.on?.(name, () => this.render())).filter(Boolean);
    this.render();
  }

  render() {
    const definitions = this.windowDefinitionStore?.list?.() || [];
    const instances = this.windowManager?.list?.() || [];
    this.el.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = "窗口调试器";
    this.el.appendChild(heading);
    const openSection = document.createElement("section");
    const openTitle = document.createElement("h4");
    openTitle.textContent = "打开窗口";
    openSection.appendChild(openTitle);
    for (const definition of definitions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${definition.icon || "🗔"} ${definition.title || definition.id}`;
      button.dataset.windowId = definition.id;
      button.addEventListener("click", () => this.windowManager.open(definition));
      openSection.appendChild(button);
    }
    this.el.appendChild(openSection);
    const activeSection = document.createElement("section");
    const activeTitle = document.createElement("h4");
    activeTitle.textContent = `已打开窗口（${instances.length}）`;
    activeSection.appendChild(activeTitle);
    if (!instances.length) {
      const empty = document.createElement("p");
      empty.textContent = "没有打开的窗口";
      activeSection.appendChild(empty);
    }
    for (const state of instances) {
      const row = document.createElement("div");
      row.className = "ng-window-debugger-row";
      const label = document.createElement("span");
      label.textContent = `${state.windowId} · ${state.instanceId}${state.fullscreen ? " · 全屏" : ""}`;
      row.appendChild(label);
      const focus = document.createElement("button");
      focus.type = "button";
      focus.textContent = "置顶";
      focus.addEventListener("click", () => this.windowManager.focus(state.instanceId));
      row.appendChild(focus);
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "关闭";
      close.addEventListener("click", () => this.windowManager.close(state.instanceId));
      row.appendChild(close);
      activeSection.appendChild(row);
    }
    this.el.appendChild(activeSection);
  }

  destroy() {
    this._unsubscribe.forEach((unsubscribe) => unsubscribe?.());
    this._unsubscribe = [];
  }
}

export default WindowDebuggerView;
// DEV-TOOLS:END
