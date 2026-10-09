// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { writeDataFile, downloadTextFile } from "./devApi.js";

/**
 * ActivityListManagerView - DOM rendering for the "Activity 列表管理器"
 * developer window (plan §6.1). Operates on a single ActivityListManagerModel
 * instance; `openEditor(activity)` is supplied by DeveloperMode so this view
 * never has to know how editor windows get mounted.
 */
export class ActivityListManagerView {
  constructor(model, { openEditor } = {}) {
    this.model = model;
    this.openEditor = openEditor || (() => {});
    this.selectedListId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-list">${t("legacy.438667ea28fa")}</button>
          <button type="button" data-action="duplicate-list">${t("legacy.b3d30939f4e1")}</button>
          <button type="button" data-action="rename-list">${t("legacy.1cd80fd7a8b3")}</button>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
      <div class="ng-list-manager-activities">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-activity">${t("legacy.9a4cd058d43e")}Activity</button>
          <button type="button" data-action="duplicate-activity">${t("legacy.c844fa567d20")}Activity</button>
        </div>
        <div class="ng-list-manager-activity-items"></div>
      </div>
    `;
    this.el = el;
    this.listItemsEl = el.querySelector(".ng-list-manager-list-items");
    this.activityItemsEl = el.querySelector(".ng-list-manager-activity-items");
    el.querySelector('[data-action="new-list"]').addEventListener("click", () => {
      const id = prompt(t("legacy.8ecbc28570df"));
      if (id) { this.model.createList(id); this.render(); }
    });
    el.querySelector('[data-action="duplicate-list"]').addEventListener("click", () => {
      if (!this.selectedListId) return;
      const id = prompt(t("legacy.8ecbc28570df"));
      if (id) { this.model.duplicateList(this.selectedListId, id); this.render(); }
    });
    el.querySelector('[data-action="rename-list"]').addEventListener("click", () => {
      if (!this.selectedListId || this.model.isBuiltInList(this.selectedListId)) return;
      const id = prompt(t("legacy.119398dad774"), this.selectedListId);
      if (id) { this.model.renameList(this.selectedListId, id); this.selectedListId = id; this.render(); }
    });
    el.querySelector('[data-action="new-activity"]').addEventListener("click", () => {
      if (!this.selectedListId) return;
      const id = prompt(t("legacy.0659b6caf010"));
      if (id) {
        this.model.createActivity(this.selectedListId, id, {
          startNodeId: "start",
          nodes: {
            start: { id: "start", type: "flowStart", x: 40, y: 40, inputs: {} },
            end: { id: "end", type: "activityEnd", x: 240, y: 40, inputs: {} },
          },
          connections: [{ id: "edge-1", fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" }],
        });
        this.render();
      }
    });
    el.querySelector('[data-action="duplicate-activity"]').addEventListener("click", () => {
      const source = this.activityItemsEl.querySelector(".ng-list-manager-activity.selected")?.dataset.activityId;
      if (!this.selectedListId || !source) return;
      const id = prompt(t("legacy.0659b6caf010"));
      if (id) { this.model.duplicateActivity(this.selectedListId, source, id); this.render(); }
    });
  }

  render() {
    this.listItemsEl.innerHTML = "";
    const lists = this.model.listLists();
    if (!this.selectedListId && lists.length) this.selectedListId = lists[0].id;
    for (const list of lists) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ng-list-manager-list-item";
      item.classList.toggle("selected", list.id === this.selectedListId);
      item.classList.toggle("builtin", this.model.isBuiltInList(list.id));
      item.textContent = list.id;
      item.addEventListener("click", () => { this.selectedListId = list.id; this.render(); });
      this.listItemsEl.appendChild(item);
    }

    this.activityItemsEl.innerHTML = "";
    if (!this.selectedListId) return;
    for (const activity of this.model.listActivities(this.selectedListId)) {
      this.activityItemsEl.appendChild(this._buildActivityRow(activity));
    }
  }

  _buildActivityRow(activity) {
    const row = document.createElement("div");
    row.className = "ng-list-manager-activity";
    row.dataset.activityId = activity.id;
    row.innerHTML = `
      <span class="ng-list-manager-activity-name">${activity.displayName}</span>
      <label><input type="checkbox" data-flag="timeLoaded" ${activity.timeLoaded ? "checked" : ""}/> ${t("legacy.becc63f8ae39")}</label>
      <label><input type="checkbox" data-flag="autoRun" ${activity.autoRun ? "checked" : ""}/> ${t("legacy.3736f7e25eb4")}</label>
      <button type="button" data-action="open">${t("legacy.a7f814c0a40d")}</button>
      <button type="button" data-action="download">${t("legacy.2b9d013177da")}</button>
      <button type="button" data-action="write-disk">${t("legacy.81ee3266b03d")}</button>
      <button type="button" data-action="remove-from-list">${t("legacy.4e4edc033de6")}</button>
      <button type="button" data-action="delete-file">${t("legacy.935cd54eecaa")}</button>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest("input,button")) return;
      this.activityItemsEl.querySelectorAll(".ng-list-manager-activity").forEach((el) => el.classList.remove("selected"));
      row.classList.add("selected");
    });
    row.querySelector('[data-flag="timeLoaded"]').addEventListener("change", (e) => {
      this.model.setActivityMeta(activity.id, { timeLoaded: e.target.checked });
    });
    row.querySelector('[data-flag="autoRun"]').addEventListener("change", (e) => {
      this.model.setActivityMeta(activity.id, { autoRun: e.target.checked });
    });
    row.querySelector('[data-action="open"]').addEventListener("click", () => this.openEditor(this.model.getActivity(activity.id)));
    row.querySelector('[data-action="download"]').addEventListener("click", () => {
      downloadTextFile(`${activity.id}.CL2.txt`, this.model.exportActivityCL2(activity.id));
    });
    row.querySelector('[data-action="write-disk"]').addEventListener("click", async () => {
      try {
        await writeDataFile(`activities/${activity.id}.CL2.txt`, this.model.exportActivityCL2(activity.id));
      } catch (error) {
        alert(`${t("legacy.e92dc2256061")}: ${error.message}`);
      }
    });
    row.querySelector('[data-action="remove-from-list"]').addEventListener("click", () => {
      this.model.removeFromList(this.selectedListId, activity.id);
      this.render();
    });
    row.querySelector('[data-action="delete-file"]').addEventListener("click", () => {
      if (!confirm(`${t("legacy.b71806bdfa0d")}Activity ${t("legacy.d21edc4832bc")}"${activity.id}"？${t("legacy.548b5e8d6d46")}`)) return;
      this.model.deleteActivityDefinition(activity.id);
      this.render();
    });
    return row;
  }
}

export default ActivityListManagerView;
// DEV-TOOLS:END
