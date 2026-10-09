// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { downloadTextFile, writeDataFile } from "./devApi.js";
import { registerCustomActivityNode, unregisterCustomActivityNode, updateCustomActivityNode } from "../core/ActivityNodeRegistry.js";

function starterBlueprint() {
  return {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", x: 40, y: 40, inputs: {}, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
      end: { id: "end", type: "activityEnd", x: 260, y: 40, inputs: {}, next: {} },
    },
  };
}

/** Developer editor for reusable, function-like blueprint macro nodes. */
export class BlueprintNodeManagerView {
  constructor({ nodes = [], dataFileName = "blueprint-nodes.json", dataLoader, openEditor } = {}) {
    this.nodes = nodes;
    this.dataFileName = dataFileName;
    this.dataLoader = dataLoader || null;
    this.openEditor = openEditor || (() => {});
    this.selectedId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-blueprint-node-manager";
    this.el.innerHTML = `
      <div class="ng-blueprint-node-manager-list">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new">${t("legacy.41f289b10d18")}</button>
          <button type="button" data-action="copy">${t("legacy.4edd1d00875d")}</button>
          <button type="button" data-action="delete">${t("legacy.3755f56f2f83")}</button>
        </div>
        <div data-role="items"></div>
      </div>
      <div class="ng-blueprint-node-manager-detail" data-role="detail"></div>
    `;
    this.itemsEl = this.el.querySelector('[data-role="items"]');
    this.detailEl = this.el.querySelector('[data-role="detail"]');
    this.el.querySelector('[data-action="new"]').addEventListener("click", () => this.create());
    this.el.querySelector('[data-action="copy"]').addEventListener("click", () => this.copy());
    this.el.querySelector('[data-action="delete"]').addEventListener("click", () => this.remove());
  }

  create() {
    const id = prompt(t("legacy.8cb077e8d362"));
    if (!id || this.nodes.some((node) => node.id === id)) return;
    if (!/^[a-zA-Z][\w:-]*$/.test(id)) return alert(t("legacy.b28a0976574b"));
    const node = { id, label: id, flowInputs: [{ name: "flowIn", kind: "flow" }], flowOutputs: [{ name: "flowOut", kind: "flow" }], valueInputs: [], valueOutputs: [], blueprint: starterBlueprint() };
    this.nodes.push(node);
    registerCustomActivityNode(node);
    this.selectedId = id;
    this.render();
  }

  copy() {
    const source = this.nodes.find((node) => node.id === this.selectedId);
    if (!source) return;
    const id = prompt(t("legacy.9489917637a8"), `${source.id}-copy`);
    if (!id || this.nodes.some((node) => node.id === id)) return;
    const node = structuredClone({ ...source, id });
    this.nodes.push(node);
    registerCustomActivityNode(node);
    this.selectedId = id;
    this.render();
  }

  remove() {
    const index = this.nodes.findIndex((node) => node.id === this.selectedId);
    if (index < 0 || !confirm(`${t("legacy.4565f561c5e7")}${this.selectedId}”？`)) return;
    unregisterCustomActivityNode(this.selectedId);
    this.nodes.splice(index, 1);
    this.selectedId = null;
    this.render();
  }

  openBlueprintEditor(nodeOrId = this.selectedId) {
    const node = typeof nodeOrId === "string"
      ? this.nodes.find((entry) => entry.id === nodeOrId)
      : nodeOrId;
    if (!node) return false;
    this.openEditor(node, (blueprint) => {
      const next = { ...structuredClone(node), blueprint: structuredClone(blueprint) };
      try {
        updateCustomActivityNode(next);
      } catch (error) {
        alert(`${t("legacy.0c870112c3ca")}: ${error.message}`);
        return false;
      }
      Object.assign(node, next);
      this.render();
      return true;
    });
    return true;
  }

  _saveNode(node, fields) {
    const next = structuredClone(node);
    next.label = this.detailEl.querySelector('[data-field="label"]').value.trim() || node.id;
    next.description = this.detailEl.querySelector('[data-field="description"]').value.trim();
    for (const key of ["flowInputs", "flowOutputs", "valueInputs", "valueOutputs"]) {
      next[key] = [...this.detailEl.querySelectorAll(`[data-port-group="${key}"] [data-port-row]`)].map((row) => {
        const index = Number(row.dataset.portIndex);
        const port = structuredClone(node[key]?.[index] || {});
        port.name = row.querySelector('[data-port-field="name"]').value.trim();
        if (key.startsWith("flow")) {
          port.kind = "flow";
          delete port.type;
        } else {
          port.kind = "value";
          const type = row.querySelector('[data-port-field="type"]').value;
          if (type === "any") delete port.type;
          else port.type = type;
        }
        return port;
      });
      const names = next[key].map((port) => port.name);
      if (names.some((name) => !new RegExp("^[A-Za-z][A-Za-z0-9_-]*$").test(name)) || new Set(names).size !== names.length) {
        alert(`${t("legacy.0c870112c3ca")} ${key}: ${t("legacy.b28a0976574b")}`);
        return false;
      }
    }
    try {
      updateCustomActivityNode(next);
    } catch (error) {
      alert(`${t("legacy.0c870112c3ca")}: ${error.message}`);
      return false;
    }
    Object.assign(node, next);
    this.render();
    return true;
  }

  async _writeToDisk(node) {
    if (!this._saveNode(node)) return;
    try {
      const text = JSON.stringify(this.nodes, null, 2) + String.fromCharCode(10);
      await writeDataFile(this.dataFileName, text);
      if (this.dataLoader) {
        const saved = await this.dataLoader.loadJSON(this.dataFileName, { cache: false });
        if (JSON.stringify(saved) !== JSON.stringify(this.nodes)) throw new Error("read-back did not match the edited node list");
      }
      this.statusEl.textContent = t("legacy.d4371481b26a");
    } catch (error) {
      this.statusEl.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`;
    }
  }

  _renderPortGroup(node, key, title) {
    const group = document.createElement("section");
    group.className = "ng-blueprint-node-port-group";
    group.dataset.portGroup = key;
    const heading = document.createElement("h4");
    heading.textContent = title;
    group.appendChild(heading);
    const rows = document.createElement("div");
    (node[key] || []).forEach((port, index) => rows.appendChild(this._portRow(key, port, index)));
    group.appendChild(rows);
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = t("legacy.41f289b10d18");
    add.addEventListener("click", () => rows.appendChild(this._portRow(key,
      key.startsWith("flow")
        ? { name: key === "flowInputs" ? "flowIn" : "flowOut", kind: "flow" }
        : { name: key === "valueInputs" ? "value" : "result", kind: "value", type: "string" }, -1)));
    group.appendChild(add);
    return group;
  }

  _portRow(key, port, index) {
    const row = document.createElement("div");
    row.className = "ng-blueprint-node-port-row";
    row.dataset.portRow = "";
    row.dataset.portIndex = String(index);
    const name = document.createElement("input");
    name.type = "text";
    name.dataset.portField = "name";
    name.setAttribute("aria-label", `${key} name`);
    name.value = port.name || "";
    row.appendChild(name);
    if (!key.startsWith("flow")) {
      const type = document.createElement("select");
      type.dataset.portField = "type";
      type.setAttribute("aria-label", `${key} type`);
      for (const value of ["any", "string", "number", "boolean", "object", "array"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        type.appendChild(option);
      }
      type.value = port.type || "any";
      row.appendChild(type);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "−";
    remove.title = t("legacy.3755f56f2f83");
    remove.addEventListener("click", () => row.remove());
    row.appendChild(remove);
    return row;
  }

  render() {
    this.itemsEl.innerHTML = "";
    for (const node of this.nodes) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ng-list-manager-list-item";
      row.classList.toggle("selected", node.id === this.selectedId);
      row.textContent = `${node.label || node.id} (${node.id})`;
      row.addEventListener("click", () => { this.selectedId = node.id; this.render(); });
      this.itemsEl.appendChild(row);
    }
    const node = this.nodes.find((entry) => entry.id === this.selectedId);
    if (!node) {
      this.detailEl.textContent = t("legacy.3b4e41b92a01");
      return;
    }
    this.detailEl.innerHTML = `
      <h3></h3>
      <label>${t("legacy.7f32e700e161")}<input data-field="label" value=""></label>
      <label>Description<textarea data-field="description"></textarea></label>
      <div data-role="ports"></div>
      <div class="ng-list-manager-toolbar">
        <button type="button" data-action="save-memory">${t("legacy.b02ae67098e2")}</button>
        <button type="button" data-action="open">${t("blueprintNodeManager.editBlueprint", "编辑节点蓝图")}</button>
        <button type="button" data-action="download">${t("legacy.3f10b573ee1b")}JSON</button>
        <button type="button" data-action="write-disk">${t("legacy.81ee3266b03d")}</button>
      </div>
      <div class="ng-editor-status" aria-live="polite"></div>
    `;
    this.detailEl.querySelector("h3").textContent = `${node.label || node.id} (${node.id})`;
    this.detailEl.querySelector('[data-field="label"]').value = node.label || node.id;
    this.detailEl.querySelector('[data-field="description"]').value = node.description || "";
    this.statusEl = this.detailEl.querySelector(".ng-editor-status");
    const portHost = this.detailEl.querySelector('[data-role="ports"]');
    for (const [key, title] of [["flowInputs", "Flow inputs"], ["flowOutputs", "Flow outputs"], ["valueInputs", "Value inputs"], ["valueOutputs", "Value outputs"]]) {
      portHost.appendChild(this._renderPortGroup(node, key, title));
    }
    this.detailEl.querySelector('[data-action="save-memory"]').addEventListener("click", () => this._saveNode(node));
    this.detailEl.querySelector('[data-action="open"]').addEventListener("click", () => this.openBlueprintEditor(node));
    this.detailEl.querySelector('[data-action="download"]').addEventListener("click", () => {
      if (this._saveNode(node)) downloadTextFile(`blueprint-node-${node.id}.json`, JSON.stringify(node, null, 2) + String.fromCharCode(10));
    });
    this.detailEl.querySelector('[data-action="write-disk"]').addEventListener("click", async () => {
      await this._writeToDisk(node);
    });
  }
}

export default BlueprintNodeManagerView;
// DEV-TOOLS:END
