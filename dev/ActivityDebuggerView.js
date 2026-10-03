// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { ACTIVITY_EVENTS } from "../core/ActivityEvents.js";

/** Live runtime Activity inspector. All mutations go through queue/execution APIs. */
export class ActivityDebuggerView {
  constructor({ activityQueueRegistry, activityDefinitionStore, activityExecutionService, localVariableManager, eventBus, runActivity = null }) {
    this.activityQueueRegistry = activityQueueRegistry;
    this.activityDefinitionStore = activityDefinitionStore;
    this.activityExecutionService = activityExecutionService;
    this.localVariableManager = localVariableManager;
    this.eventBus = eventBus;
    this.runActivity = runActivity;
    this._unsubscribers = [];
    this._buildDom();
    this._bindEvents();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-activity-debugger";
    el.innerHTML = `<div class="ng-debugger-toolbar"><button data-action="refresh">${t("legacy.38108eaa1d32")}</button><select data-role="new-activity"></select><select data-role="new-queue"></select><button data-action="create">${t("legacy.df0ec16d44ca")}</button><select data-role="ending"></select><button data-action="trigger-ending">${t("legacy.debug.triggerEnding")}</button><span class="ng-debugger-status"></span></div><div class="ng-debugger-body"></div>`;
    this.el = el;
    this.bodyEl = el.querySelector(".ng-debugger-body");
    this.statusEl = el.querySelector(".ng-debugger-status");
    el.querySelector('[data-action="refresh"]').addEventListener("click", () => this.render());
    el.querySelector('[data-action="create"]').addEventListener("click", () => this.createInstance());
    el.querySelector('[data-action="trigger-ending"]').addEventListener("click", () => this.triggerEnding());
  }

  _bindEvents() {
    if (!this.eventBus) return;
    for (const eventName of [...Object.values(ACTIVITY_EVENTS), "activity:local-variable-changed"]) this._unsubscribers.push(this.eventBus.on(eventName, () => this.render()));
  }

  render() {
    const activities = this.activityDefinitionStore?.list() || [];
    const activitySelect = this.el.querySelector('[data-role="new-activity"]');
    const queueSelect = this.el.querySelector('[data-role="new-queue"]');
    const endingSelect = this.el.querySelector('[data-role="ending"]');
    const selectedActivity = activitySelect.value;
    const selectedQueue = queueSelect.value;
    activitySelect.innerHTML = activities.map((item) => `<option value="${this.escape(item.id)}">${this.escape(item.displayName || item.id)}</option>`).join("");
    queueSelect.innerHTML = (this.activityQueueRegistry?.list() || []).map((queue) => `<option value="${this.escape(queue.queueId)}">${this.escape(queue.queueId)}</option>`).join("");
    if (selectedActivity) activitySelect.value = selectedActivity;
    if (selectedQueue) queueSelect.value = selectedQueue;
    const endings = activities.filter((item) => String(item.id).startsWith("ending"));
    endingSelect.innerHTML = endings.map((item) => `<option value="${this.escape(item.id)}">${this.escape(item.displayName || item.id)}</option>`).join("");
    this.bodyEl.innerHTML = "";
    for (const queue of this.activityQueueRegistry?.list() || []) this.bodyEl.appendChild(this.renderQueue(queue));
    this.statusEl.textContent = `${t("legacy.0f4f88883db6")}${new Date().toLocaleTimeString()}`;
  }

  escape(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"); }

  createInstance() {
    const activityId = this.el.querySelector('[data-role="new-activity"]').value;
    const queueId = this.el.querySelector('[data-role="new-queue"]').value || "main";
    const definition = this.activityDefinitionStore?.get(activityId);
    if (!definition) return;
    this.activityQueueRegistry.append(queueId, { activityId, currentNodeId: definition.blueprint?.startNodeId || null });
  }

  triggerEnding() {
    const activityId = this.el.querySelector('[data-role="ending"]').value;
    if (!activityId || typeof this.runActivity !== "function") {
      this.statusEl.textContent = t("legacy.debug.noEnding");
      return;
    }
    const instance = this.runActivity(activityId, "main", { ignoreAvailability: true });
    this.statusEl.textContent = instance ? `${t("legacy.debug.endingTriggered")}${activityId}` : `${t("legacy.debug.endingFailed")}${activityId}`;
  }

  renderQueue(queue) {
    const section = document.createElement("div");
    section.className = "ng-debugger-queue";
    const title = document.createElement("div");
    title.className = "ng-debugger-queue-title";
    title.textContent = `${t("legacy.cd35413f05e7")}: ${queue.queueId}${queue.nonBlocking ? ` (${t("legacy.654667ec1887")})` : ""} - ${queue.entries.length} ${t("legacy.88aba736b142")}`;
    section.appendChild(title);
    const table = document.createElement("table");
    table.className = "ng-debugger-table";
    table.innerHTML = t("legacy.396cced3a4f6");
    const tbody = table.querySelector("tbody");
    queue.entries.forEach((entry) => tbody.appendChild(this.renderEntry(queue, entry)));
    section.appendChild(table);
    return section;
  }

  renderEntry(queue, entry) {
    const row = document.createElement("tr");
    const definition = this.activityDefinitionStore?.get(entry.activityId);
    const nodeSelect = document.createElement("select");
    const executableNodeIds = definition?.compiled?.debugInfo?.nodeIds || Object.keys(definition?.blueprint?.nodes || {});
    executableNodeIds.forEach((nodeId) => {
      const node = definition?.blueprint?.nodes?.[nodeId];
      if (!node) return;
      const option = new Option(`${node.id} · ${node.type}`, node.id);
      option.selected = node.id === entry.currentNodeId;
      nodeSelect.add(option);
    });
    nodeSelect.disabled = entry.status === "resolved";
    nodeSelect.addEventListener("change", () => this.activityExecutionService?.update(queue, entry.instanceId, { currentNodeId: nodeSelect.value }));
    const stepControl = document.createElement("div");
    stepControl.className = "ng-debugger-step-control";
    stepControl.append(nodeSelect);
    const breakpointLabel = document.createElement("label");
    const breakpointToggle = document.createElement("input");
    breakpointToggle.type = "checkbox";
    breakpointToggle.disabled = entry.status === "resolved";
    breakpointToggle.checked = (entry.breakpointNodeIds || []).includes(nodeSelect.value);
    breakpointToggle.addEventListener("change", () => {
      const nodeIds = new Set(entry.breakpointNodeIds || []);
      if (breakpointToggle.checked) nodeIds.add(nodeSelect.value);
      else nodeIds.delete(nodeSelect.value);
      this.activityExecutionService?.update(queue, entry.instanceId, { breakpointNodeIds: [...nodeIds] });
    });
    nodeSelect.addEventListener("change", () => {
      breakpointToggle.checked = (this.activityQueueRegistry?.get(queue.queueId)?.get(entry.instanceId)?.breakpointNodeIds || []).includes(nodeSelect.value);
    });
    breakpointLabel.append(breakpointToggle, document.createTextNode(t("dev.activityDebugger.breakpoint")));
    stepControl.append(breakpointLabel);
    const statusSelect = document.createElement("select");
    ["unresolved", "paused", "failed", "resolved"].forEach((status) => { const option = new Option(status, status); option.selected = status === entry.status; statusSelect.add(option); });
    statusSelect.addEventListener("change", () => this.activityExecutionService?.update(queue, entry.instanceId, { status: statusSelect.value }));
    const local = document.createElement("div");
    const localValues = { ...(entry.localVariables || {}) };
    (this.localVariableManager?.list() || []).forEach((definition) => {
      if (!Object.prototype.hasOwnProperty.call(localValues, definition.id)) localValues[definition.id] = definition.defaultValue;
    });
    Object.entries(localValues).forEach(([key, value]) => {
      const input = document.createElement("input"); input.value = typeof value === "object" ? JSON.stringify(value) : value ?? ""; input.title = key;
      input.addEventListener("change", () => { let next = input.value; try { next = typeof value === "object" ? JSON.parse(next) : next; } catch { this.statusEl.textContent = t("legacy.3017a64eb407"); return; } this.activityExecutionService?.setLocalVariable(entry.instanceId, key, next); });
      const label = document.createElement("label"); label.textContent = `${key}: `; label.appendChild(input); local.appendChild(label);
    });
    const compiled = definition?.compiled?.debugInfo;
    if (compiled) {
      const liveState = this.activityExecutionService?.getDebugState(entry.instanceId);
      const trace = document.createElement("details");
      const traceSummary = document.createElement("summary");
      traceSummary.textContent = `${t("dev.activityDebugger.stepTrace")} (${compiled.nodeIds.length})`;
      const traceData = document.createElement("pre");
      traceData.textContent = JSON.stringify({
        currentNodeId: liveState?.currentNodeId ?? entry.currentNodeId ?? null,
        currentStep: liveState?.currentStep ?? entry.currentStep ?? null,
        waitingNodeId: liveState?.waitingNodeId ?? entry.waitingNodeId ?? null,
        executedNodeIds: liveState?.executedNodeIds ?? entry.executedNodeIds ?? [],
        executionStep: liveState?.executionStep ?? entry.executionStep ?? 0,
        executionTrace: liveState?.executionTrace ?? entry.executionTrace ?? [],
        breakpointNodeIds: liveState?.breakpointNodeIds ?? entry.breakpointNodeIds ?? [],
        pausedAtBreakpointId: liveState?.pausedAtBreakpointId ?? entry.pausedAtBreakpointId ?? null,
        localVariables: liveState?.localVariables ?? entry.localVariables ?? {},
        sourceMap: compiled.sourceMap,
      }, null, 2);
      trace.append(traceSummary, traceData);
      const generated = document.createElement("details");
      const generatedSummary = document.createElement("summary");
      generatedSummary.textContent = t("dev.activityDebugger.generatedCode");
      const generatedSource = document.createElement("pre");
      generatedSource.textContent = compiled.source;
      generated.append(generatedSummary, generatedSource);
      trace.append(generated);
      local.append(trace);
    }
    const remove = document.createElement("button"); remove.textContent = t("legacy.e1ab0153ef20"); remove.addEventListener("click", () => this.activityQueueRegistry.removeEntry(queue.queueId, entry.instanceId));
    const cells = [entry.instanceId, entry.activityId, statusSelect, stepControl, local, remove];
    cells.forEach((value) => { const cell = document.createElement("td"); if (typeof value === "string") cell.textContent = value; else cell.appendChild(value); row.appendChild(cell); });
    return row;
  }

  dispose() { this._unsubscribers.forEach((unsubscribe) => unsubscribe()); this._unsubscribers = []; }
}

export default ActivityDebuggerView;
// DEV-TOOLS:END