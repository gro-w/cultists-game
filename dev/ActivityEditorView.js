// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { PointerInteraction } from "../core/desktopPointerInteraction.js";
import { listActivityNodeTypes, getActivityNodeDefinition, listActivityNodePorts, arePortsCompatible, classifyActivityNodePorts } from "../core/ActivityNodeRegistry.js";
import { createActivityEditorModel } from "./ActivityEditorModel.js";
import { downloadTextFile, writeDataFile } from "./devApi.js";
import { serializeCl2 } from "../core/Cl2Serializer.js";
import { parseCl2 } from "../core/Cl2Parser.js";
import { compileCl2Activity } from "../core/Cl2Compiler.js";

// Layout constants mirror the old engine's blueprint editor
// (js/desktop/DevDialogueEditorTab.js) so the two look and feel the same.
const NODE_WIDTH = 185;
const PORT_ROW_TOP = 38;
const PORT_ROW_HEIGHT = 19;
const NODE_MIN_HEIGHT = 90;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

/**
 * ActivityEditorView - DOM rendering + gesture wiring for one Activity
 * editor window (plan §6.2). Deliberately reuses the old engine's
 * blueprint-canvas visual language (win95 node cards, red/green port pins,
 * bezier SVG arrows, dashed box-select rectangle, ctrl/cmd multi-select,
 * multi-node drag, zoom) - see js/desktop/DevDialogueEditorTab.js - while
 * keeping all state in a single ActivityEditorModel instance owned
 * exclusively by this view; nothing is read from or written to
 * module-level state, so opening N editor windows creates N fully
 * independent models + views.
 */
export class ActivityEditorView {
  constructor({ activityId, blueprint, displayName, onSaveToMemory, onRenameId, dataFileName, valueOnly = false } = {}) {
    this.valueOnly = Boolean(valueOnly);
    this.model = createActivityEditorModel({ activityId, blueprint, displayName, valueOnly: this.valueOnly });
    this.onSaveToMemory = onSaveToMemory || (() => {});
    this.onRenameId = onRenameId || (() => {});
    this.dataFileName = dataFileName || null;
    this.zoom = 1;
    this.editorMode = "graph";
    this._dragPointer = new PointerInteraction();
    this._connectionDragPointer = new PointerInteraction();
    this._boxSelectPointer = new PointerInteraction();
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-activity-editor";
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="ng-editor-toolbar">
        <button type="button" data-action="undo" title="${t("legacy.9fcefd8dc81e")}">${t("legacy.9fcefd8dc81e")}</button>
        <button type="button" data-action="redo" title="${t("legacy.1238f0d36361")}">${t("legacy.1238f0d36361")}</button>
        <button type="button" data-action="copy" title="${t("legacy.bbda8e0907ff")}(Ctrl/Cmd+C)">${t("legacy.4edd1d00875d")}</button>
        <button type="button" data-action="paste" title="${t("legacy.5cc0f8acca4d")}(Ctrl/Cmd+V)">${t("legacy.de7fb7d3cf47")}</button>
        <button type="button" data-action="delete-selected" title="${t("legacy.7e8b0e5b4ebb")}(Delete)">${t("legacy.42b7a0e01134")}</button>
        <button type="button" data-action="validate" title="${t("legacy.20feeceade52")}">${t("legacy.20feeceade52")}</button>
        <button type="button" data-action="auto-layout" title="${t("legacy.5b91bd71e136")}">${t("legacy.5b91bd71e136")}</button>
        <button type="button" data-action="save" title="${t("legacy.b02ae67098e2")}">${t("legacy.b02ae67098e2")}</button>
        <button type="button" data-action="download" title="${t("legacy.3f10b573ee1b")}JSON">${t("legacy.2b9d013177da")}</button>
        <button type="button" data-action="write-disk" title="${t("legacy.81ee3266b03d")}">${t("legacy.81ee3266b03d")}</button>
        <button type="button" data-action="toggle-source" title="${t("dev.blueprint.toggleCl2", "切换 CL2 脚本编辑器")}">${t("dev.blueprint.toggleCl2", "CL2 脚本编辑器")}</button>
        ${this.valueOnly ? "" : `<button type="button" data-action="view-javascript" title="${t("dev.blueprint.viewCompiledJavaScript", "查看 JIT JavaScript")}">${t("dev.blueprint.viewCompiledJavaScript", "查看 JIT JavaScript")}</button>`}
        <span class="ng-editor-zoom-tools">
          <button type="button" data-action="zoom-out">－</button>
          <span class="ng-editor-zoom-label">100%</span>
          <button type="button" data-action="zoom-in">＋</button>
        </span>
        <span class="ng-editor-status"></span>
      </div>
      <div class="ng-editor-body">
        <div class="ng-editor-palette"></div>
        <div class="ng-editor-canvas-container">
          <div class="ng-editor-canvas-content">
            <svg class="ng-editor-connections"><defs></defs></svg>
            <div class="ng-editor-canvas"></div>
          </div>
        </div>
        <div class="ng-editor-inspector"></div>
        <textarea class="ng-editor-source" spellcheck="false" aria-label="${t("dev.blueprint.cl2Source", "CL2 脚本")}"></textarea>
        <section class="ng-editor-generated-source" aria-label="${t("dev.blueprint.generatedJavaScript", "JIT 编译出的 JavaScript（只读）")}" hidden>
          <div class="ng-editor-generated-toolbar">
            <span>${t("dev.blueprint.generatedJavaScript", "JIT 编译出的 JavaScript（只读）")}</span>
            <button type="button" data-action="close-javascript">${t("dev.blueprint.closeCompiledJavaScript", "关闭")}</button>
          </div>
          <textarea class="ng-editor-generated-code" readonly spellcheck="false" aria-label="${t("dev.blueprint.generatedJavaScript", "JIT 编译出的 JavaScript（只读）")}"></textarea>
          <div class="ng-editor-generated-error" role="alert" hidden></div>
        </section>
      </div>
    `;
    this.el = el;
    this.statusEl = el.querySelector(".ng-editor-status");
    this.zoomLabelEl = el.querySelector(".ng-editor-zoom-label");
    this.paletteEl = el.querySelector(".ng-editor-palette");
    this.canvasContainerEl = el.querySelector(".ng-editor-canvas-container");
    this.canvasContentEl = el.querySelector(".ng-editor-canvas-content");
    this.canvasEl = el.querySelector(".ng-editor-canvas");
    this.connectionsEl = el.querySelector(".ng-editor-connections");
    this.inspectorEl = el.querySelector(".ng-editor-inspector");
    this.sourceEl = el.querySelector(".ng-editor-source");
    this.generatedSourcePanelEl = el.querySelector(".ng-editor-generated-source");
    this.generatedSourceEl = el.querySelector(".ng-editor-generated-code");
    this.generatedSourceErrorEl = el.querySelector(".ng-editor-generated-error");

    this._ensureArrowMarker();
    this._buildPalette();
    this._bindToolbar();
    this._bindCanvas();
    this._bindKeyboard();
    this._applyZoom();
  }

  _ensureArrowMarker() {
    const defs = this.connectionsEl.querySelector("defs");
    defs.innerHTML = `<marker id="ng-editor-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#000080"/></marker>`;
  }

  _buildPalette() {
    this.paletteEl.innerHTML = "";
    for (const type of listActivityNodeTypes()) {
      const definition = getActivityNodeDefinition(type);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ng-editor-palette-item";
      button.textContent = definition.label;
      button.addEventListener("click", () => {
        const node = this.model.addNode(type, 80 + this.model.listNodes().length * 20, 80 + this.model.listNodes().length * 20);
        this.model.selectOnly(node.id);
        this.render();
      });
      this.paletteEl.appendChild(button);
    }
  }

  _bindToolbar() {
    this.el.querySelector('[data-action="undo"]').addEventListener("click", () => {
      this.model.undo();
      this.render();
    });
    this.el.querySelector('[data-action="redo"]').addEventListener("click", () => {
      this.model.redo();
      this.render();
    });
    this.el.querySelector('[data-action="copy"]').addEventListener("click", () => {
      if (!this.model.getSelection().length) return;
      this._clipboard = this.model.copySelected();
      this._setStatus(`${t("legacy.d7a0f5842769")}${this._clipboard.nodes.length} ${t("legacy.df2dd979aa20")}`);
    });
    this.el.querySelector('[data-action="paste"]').addEventListener("click", () => {
      if (!this._clipboard) return;
      this.model.pasteNodes(this._clipboard);
      this.render();
    });
    this.el.querySelector('[data-action="delete-selected"]').addEventListener("click", () => {
      this.model.deleteSelected();
      this.render();
    });
    this.el.querySelector('[data-action="validate"]').addEventListener("click", () => {
      const result = this.model.validateForSave();
      this._setStatus(result.ok ? t("legacy.7035f86dd0f0") : `${t("legacy.2da7449d8887")}: ${result.errors.join("；")}`, !result.ok);
    });
    this.el.querySelector('[data-action="save"]').addEventListener("click", () => this._save());
    this.el.querySelector('[data-action="auto-layout"]').addEventListener("click", () => {
      this.model.autoLayout();
      this.render();
    });
    this.el.querySelector('[data-action="download"]').addEventListener("click", () => {
      downloadTextFile(`${this.model.activityId || "activity"}.CL2.txt`, this.model.toDownloadPayload());
    });
    this.el.querySelector('[data-action="write-disk"]').addEventListener("click", () => this._writeToDisk());
    this.el.querySelector('[data-action="toggle-source"]').addEventListener("click", () => this._toggleSourceMode());
    this.el.querySelector('[data-action="view-javascript"]')?.addEventListener("click", () => this._showCompiledJavaScript());
    this.el.querySelector('[data-action="close-javascript"]').addEventListener("click", () => this._closeCompiledJavaScript());
    this.el.querySelector('[data-action="zoom-in"]').addEventListener("click", () => this._setZoom(this.zoom + ZOOM_STEP));
    this.el.querySelector('[data-action="zoom-out"]').addEventListener("click", () => this._setZoom(this.zoom - ZOOM_STEP));
  }

  _setZoom(next) {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 10) / 10));
    this._applyZoom();
  }

  _toggleSourceMode() {
    this._closeCompiledJavaScript();
    const toggle = this.el.querySelector('[data-action="toggle-source"]');
    if (this.editorMode === "graph") {
      this.sourceEl.value = serializeCl2(this.model.exportBlueprint(), { activityId: this.model.activityId });
      this.editorMode = "source";
      this.el.classList.add("ng-editor-source-mode");
      toggle.textContent = t("dev.blueprint.toggleGraph", "蓝图编辑器");
      this.sourceEl.focus();
      return;
    }
    const parsed = parseCl2(this.sourceEl.value, { sourcePath: this.dataFileName || "<editor>", validate: !this.valueOnly });
    if (!parsed.ok) {
      const details = parsed.diagnostics.map((item) => item.message || String(item)).join("；");
      this._setStatus(`${t("legacy.2da7449d8887")}: ${details}`, true);
      return;
    }
    const candidateModel = createActivityEditorModel({ activityId: this.model.activityId, blueprint: parsed.graph, displayName: this.model.displayName, valueOnly: this.valueOnly });
    const validation = candidateModel.validateForSave();
    if (!validation.ok) {
      this._setStatus(`${t("legacy.2da7449d8887")}: ${validation.errors.join("；")}`, true);
      return;
    }
    this.model.loadBlueprint(parsed.graph);
    this.editorMode = "graph";
    this.el.classList.remove("ng-editor-source-mode");
    toggle.textContent = t("dev.blueprint.toggleCl2", "CL2 脚本编辑器");
    this.render();
  }

  _showCompiledJavaScript() {
    this.generatedSourcePanelEl.hidden = false;
    this.el.classList.add("ng-editor-javascript-mode");
    this.generatedSourceEl.value = "";
    this.generatedSourceErrorEl.hidden = true;
    this.generatedSourceErrorEl.textContent = "";

    try {
      let blueprint;
      if (this.editorMode === "source") {
        const parsed = parseCl2(this.sourceEl.value, {
          sourcePath: this.dataFileName || "<editor>",
          validate: true,
        });
        if (!parsed.ok) throw new Error(parsed.diagnostics.map((item) => item.message || String(item)).join("；"));
        const candidateModel = createActivityEditorModel({
          activityId: this.model.activityId,
          blueprint: parsed.graph,
          displayName: this.model.displayName,
        });
        const validation = candidateModel.validateForSave();
        if (!validation.ok) throw new Error(validation.errors.join("；"));
        blueprint = parsed.graph;
      } else {
        const validation = this.model.validateForSave();
        if (!validation.ok) throw new Error(validation.errors.join("；"));
        blueprint = this.model.exportBlueprint();
      }

      // Compile the current draft on every click; never show a cached
      // ActivityDefinitionStore compilation in this editor view.
      const compiled = compileCl2Activity(blueprint);
      this.generatedSourceEl.value = compiled.source;
      this._setStatus(t("dev.blueprint.javascriptRecompiled", "JIT JavaScript 已重新编译"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = `${t("dev.blueprint.javascriptCompileFailed", "JIT 编译失败：")}${message}`;
      this.generatedSourceErrorEl.textContent = failure;
      this.generatedSourceErrorEl.hidden = false;
      this._setStatus(failure, true);
    }
  }

  _closeCompiledJavaScript() {
    if (!this.generatedSourcePanelEl || this.generatedSourcePanelEl.hidden) return;
    this.generatedSourcePanelEl.hidden = true;
    this.el.classList.remove("ng-editor-javascript-mode");
  }

  _applyZoom() {
    this.canvasContentEl.style.transform = `scale(${this.zoom})`;
    this.canvasContentEl.style.transformOrigin = "top left";
    this.zoomLabelEl.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  _save() {
    const result = this.model.validateForSave();
    if (!result.ok) {
      this._setStatus(`${t("legacy.b3d3b2cd3e4b")}: ${result.errors.join("；")}`, true);
      return false;
    }
    this.onSaveToMemory(this.model.exportBlueprint());
    this._setStatus(t("legacy.bedc3c6afcd3"));
    return true;
  }

  async _writeToDisk() {
    if (!this.dataFileName) {
      this._setStatus(t("legacy.eacc36abad94"), true);
      return;
    }
    if (!this._save()) return;
    try {
      await writeDataFile(this.dataFileName, this.model.toDownloadPayload());
      this._setStatus(`${t("legacy.a39837537e98")}${this.dataFileName}`);
    } catch (error) {
      this._setStatus(`${t("legacy.e92dc2256061")}: ${error.message}`, true);
    }
  }

  _setStatus(text, isError = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("ng-editor-status-error", isError);
  }

  _bindKeyboard() {
    this.el.addEventListener("pointerdown", () => this.el.focus());
    this.el.addEventListener("keydown", (e) => {
      if (document.activeElement !== this.el) return;
      const isModifier = e.ctrlKey || e.metaKey;
      if ((e.key === "Delete" || e.key === "Backspace") && this.model.getSelection().length) {
        e.preventDefault();
        this.model.deleteSelected();
        this.render();
      } else if (isModifier && e.key.toLowerCase() === "c" && this.model.getSelection().length) {
        e.preventDefault();
        this._clipboard = this.model.copySelected();
        this._setStatus(`${t("legacy.d7a0f5842769")}${this._clipboard.nodes.length} ${t("legacy.df2dd979aa20")}`);
      } else if (isModifier && e.key.toLowerCase() === "v" && this._clipboard) {
        e.preventDefault();
        this.model.pasteNodes(this._clipboard);
        this.render();
      }
    });
  }

  _bindCanvas() {
    this.canvasEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const portEl = e.target.closest("[data-port-name]");
      if (portEl) return this._startConnectionDrag(e, portEl);
      const nodeEl = e.target.closest(".ng-editor-node");
      if (nodeEl) return this._startNodeDrag(e, nodeEl);
      // Clicked empty canvas: clear selection (unless extending) and start a box-select.
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        this.model.clearSelection();
        this._renderSelectionHighlight();
        this._renderInspector();
      }
      this._startBoxSelect(e);
    });
  }

  /** Convert a pointer event's client coordinates into logical (zoom-invariant) canvas coordinates. */
  _canvasPoint(clientX, clientY) {
    const rect = this.canvasEl.getBoundingClientRect();
    return { x: (clientX - rect.left) / this.zoom, y: (clientY - rect.top) / this.zoom };
  }

  _startNodeDrag(e, nodeEl) {
    const id = nodeEl.dataset.nodeId;
    const additive = e.ctrlKey || e.metaKey;
    if (additive) {
      this.model.toggleSelect(id);
    } else if (!this.model.isSelected(id) || this.model.getSelection().length <= 1) {
      // Plain click on a node that isn't already part of a multi-selection
      // collapses to selecting just that node; clicking a node that IS part
      // of an existing multi-selection preserves the whole group so the
      // drag below moves every selected node together.
      this.model.selectOnly(id);
    }
    this._renderSelectionHighlight();
    this._renderInspector();
    if (!this.model.isSelected(id)) return;

    const start = this._canvasPoint(e.clientX, e.clientY);
    let last = start;
    let began = false;
    this._dragPointer.start({
      onMove: (moveEvent) => {
        const point = this._canvasPoint(moveEvent.clientX, moveEvent.clientY);
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (!dx && !dy) return;
        if (!began) { this.model.beginDrag(); began = true; }
        this.model.moveSelected(dx, dy);
        last = point;
        this._updateDraggedPositions();
      },
      onEnd: () => { if (began) this.render(); },
    });
  }

  /** Cheap incremental update during a drag gesture: only reposition the dragged node elements and redraw connection lines, without rebuilding the whole node list (plan §6.2 "拖拽过程中不要重建画布"). */
  _updateDraggedPositions() {
    for (const id of this.model.getSelection()) {
      const node = this.model.getNode(id);
      const el = this.canvasEl.querySelector(`.ng-editor-node[data-node-id="${cssEscape(id)}"]`);
      if (node && el) {
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
      }
    }
    this._renderConnections();
  }

  _startBoxSelect(e) {
    const origin = this._canvasPoint(e.clientX, e.clientY);
    const additive = e.shiftKey;
    const box = document.createElement("div");
    box.className = "ng-editor-selection-box";
    this.canvasEl.appendChild(box);
    const updateBox = (point) => {
      const rect = {
        x: Math.min(origin.x, point.x),
        y: Math.min(origin.y, point.y),
        width: Math.abs(point.x - origin.x),
        height: Math.abs(point.y - origin.y),
      };
      box.style.left = `${rect.x}px`;
      box.style.top = `${rect.y}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      return rect;
    };
    updateBox(origin);
    this._boxSelectPointer.start({
      onMove: (moveEvent) => {
        const rect = updateBox(this._canvasPoint(moveEvent.clientX, moveEvent.clientY));
        this.model.selectInBox(rect, { additive });
        this._renderSelectionHighlight();
      },
      onEnd: () => {
        box.remove();
        this._renderInspector();
      },
    });
  }

  _startConnectionDrag(e, portEl) {
    e.stopPropagation();
    const nodeId = portEl.closest(".ng-editor-node").dataset.nodeId;
    const portName = portEl.dataset.portName;
    const direction = portEl.dataset.portDirection;
    if (direction !== "output") {
      this._setStatus(t("legacy.0c138dbaf35b"), true);
      return; // connections are always dragged from an output port, matching the old engine
    }
    const fromNodeId = nodeId;
    const fromPort = portName;
    this._setStatus(t("legacy.e3b7edb8bb15"));
    this._connectionDragPointer.start({
      onMove: (moveEvent) => this._drawTempConnection(portEl, moveEvent.clientX, moveEvent.clientY),
      onEnd: (upEvent) => {
        this._renderConnections();
        const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const targetPort = target?.closest('[data-port-direction="input"]');
        if (targetPort) {
          const toNodeId = targetPort.closest(".ng-editor-node").dataset.nodeId;
          const toPort = targetPort.dataset.portName;
          const result = this.model.connect(fromNodeId, fromPort, toNodeId, toPort);
          this._setStatus(result.ok ? t("legacy.65fe35c45e4e") : `${t("legacy.0a4585b3ca34")}${result.error}`, !result.ok);
          if (result.ok) this._renderConnections();
        } else {
          this._setStatus("");
        }
      },
    });
  }

  _drawTempConnection(sourcePinEl, clientX, clientY) {
    this._renderConnections();
    const wrapRect = this.canvasEl.getBoundingClientRect();
    const sourceRect = sourcePinEl.getBoundingClientRect();
    const x1 = (sourceRect.left - wrapRect.left + sourceRect.width / 2) / this.zoom;
    const y1 = (sourceRect.top - wrapRect.top + sourceRect.height / 2) / this.zoom;
    const x2 = (clientX - wrapRect.left) / this.zoom;
    const y2 = (clientY - wrapRect.top) / this.zoom;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
    path.setAttribute("class", "ng-editor-connection-path ng-editor-connection-temp");
    this.connectionsEl.appendChild(path);
  }

  _portPosition(nodeId, direction, index) {
    const node = this.model.getNode(nodeId);
    if (!node) return { x: 0, y: 0 };
    const y = node.y + PORT_ROW_TOP + index * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
    const x = direction === "output" ? node.x + NODE_WIDTH : node.x;
    return { x, y };
  }

  render() {
    this._renderNodes();
    this._renderConnections();
    this._renderInspector();
  }

  _renderNodes() {
    const nodes = this.model.listNodes();
    const existingIds = new Set(nodes.map((n) => n.id));
    [...this.canvasEl.querySelectorAll(".ng-editor-node")].forEach((el) => {
      if (!existingIds.has(el.dataset.nodeId)) el.remove();
    });

    for (const node of nodes) {
      let el = this.canvasEl.querySelector(`.ng-editor-node[data-node-id="${cssEscape(node.id)}"]`);
      const definition = getActivityNodeDefinition(node.type);
      // Flow ports and value ports are both rendered as connectable pins
      // (plan §6.2 value-port wiring); value ports get a distinct pin color
      // via the `data-port-kind="value"` CSS hook.
      const inputPorts = listActivityNodePorts(node.type, "input");
      const outputPorts = node.cl2Class === "valueReceiver" ? [] : listActivityNodePorts(node.type, "output");
      const portRows = Math.max(inputPorts.length, outputPorts.length);
      const isStart = node.id === this.model.startNodeId;
      const nodeClass = node.cl2Class || classifyActivityNodePorts(definition) || "unknown";
      if (!el) {
        el = document.createElement("div");
        el.className = "ng-editor-node";
        el.dataset.nodeId = node.id;
        el.innerHTML = `
          <div class="ng-editor-node-header"><span class="ng-editor-node-title"></span><span class="ng-editor-node-start-icon" aria-hidden="true"></span></div>
          <div class="ng-editor-node-body"></div>
          <div class="ng-editor-port-layer inputs"></div>
          <div class="ng-editor-port-layer outputs"></div>
          <div class="ng-editor-node-footer"><span class="ng-editor-node-badge"></span></div>
        `;
        this.canvasEl.appendChild(el);
      }
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.style.width = `${NODE_WIDTH}px`;
      el.style.minHeight = `${Math.max(NODE_MIN_HEIGHT, PORT_ROW_TOP + portRows * PORT_ROW_HEIGHT + 24)}px`;
      el.classList.toggle("selected", this.model.isSelected(node.id));
      el.classList.toggle("start", isStart);
      el.dataset.nodeClass = nodeClass;
      el.classList.toggle("value-receiver", nodeClass === "valueReceiver");
      el.querySelector(".ng-editor-node-title").textContent = definition?.label || node.type;
      el.querySelector(".ng-editor-node-start-icon").textContent = isStart ? "🏠" : "";
      el.querySelector(".ng-editor-node-body").textContent = JSON.stringify(node.inputs || {});
      el.querySelector(".ng-editor-node-badge").textContent = node.type;
      const inputsLayer = el.querySelector(".ng-editor-port-layer.inputs");
      const outputsLayer = el.querySelector(".ng-editor-port-layer.outputs");
      inputsLayer.innerHTML = inputPorts.map((port, index) => this._portRowMarkup(port, "input", index)).join("");
      outputsLayer.innerHTML = outputPorts.map((port, index) => this._portRowMarkup(port, "output", index)).join("");
    }
  }

  _portRowMarkup(port, direction, index) {
    const top = PORT_ROW_TOP + index * PORT_ROW_HEIGHT;
    const pin = `<span class="ng-editor-port-pin" data-port-name="${port.name}" data-port-direction="${direction}" data-port-kind="${port.kind}"></span>`;
    const label = `<span class="ng-editor-port-label">${port.name}</span>`;
    return `<div class="ng-editor-port-row ${direction}" style="top:${top}px">${direction === "input" ? pin : ""}${label}${direction === "output" ? pin : ""}</div>`;
  }

  /** Re-toggles the `.selected` class on already-rendered node elements without touching their contents (used by drag/box-select for cheap live feedback). */
  _renderSelectionHighlight() {
    this.canvasEl.querySelectorAll(".ng-editor-node").forEach((el) => {
      el.classList.toggle("selected", this.model.isSelected(el.dataset.nodeId));
    });
  }

  _renderConnections() {
    const svg = this.connectionsEl;
    [...svg.querySelectorAll("path")].forEach((path) => path.remove());
    const connections = this.model.listConnections();
    const nodes = this.model.listNodes();
    const outputIndex = new Map();
    const inputIndex = new Map();
    nodes.forEach((node) => {
      listActivityNodePorts(node.type, "output").forEach((port, index) => outputIndex.set(`${node.id}:${port.name}`, index));
      listActivityNodePorts(node.type, "input").forEach((port, index) => inputIndex.set(`${node.id}:${port.name}`, index));
    });
    for (const connection of connections) {
      const from = this._portPosition(connection.fromNodeId, "output", outputIndex.get(`${connection.fromNodeId}:${connection.fromPort}`) || 0);
      const to = this._portPosition(connection.toNodeId, "input", inputIndex.get(`${connection.toNodeId}:${connection.toPort}`) || 0);
      svg.appendChild(this._buildConnectionPath(from, to));
    }
  }

  _buildConnectionPath(from, to) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const dx = Math.max(40, Math.abs(to.x - from.x) / 2);
    path.setAttribute("d", `M${from.x},${from.y} C${from.x + dx},${from.y} ${to.x - dx},${to.y} ${to.x},${to.y}`);
    path.setAttribute("class", "ng-editor-connection-path");
    path.setAttribute("marker-end", "url(#ng-editor-arrow)");
    return path;
  }

  _renderInspector() {
    const selection = this.model.getSelection();
    this.inspectorEl.innerHTML = "";
    if (selection.length === 0) {
      this._renderActivityMetadata();
      return;
    }
    if (selection.length > 1) {
      this.inspectorEl.textContent = `${t("legacy.ef1a32a96e17")}${selection.length} ${t("legacy.df2dd979aa20")}`;
      return;
    }
    const node = this.model.getNode(selection[0]);
    const definition = getActivityNodeDefinition(node.type);
    const title = document.createElement("div");
    title.className = "ng-editor-inspector-title";
    title.textContent = `${node.id} (${definition?.label || node.type})`;
    this.inspectorEl.appendChild(title);

    // Flow output "下家" dropdowns (old engine _renderFlowOutputs/_saveFlowTarget pattern):
    // each flow output can point at any flow-input port, or be left unconnected.
    for (const flowPort of definition?.flowOutputs || []) {
      const row = document.createElement("label");
      row.className = "ng-editor-inspector-row";
      row.innerHTML = `<span>${flowPort.name} →</span>`;
      const select = document.createElement("select");
      const currentTarget = node.next?.[flowPort.name];
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = t("legacy.c9c0846fc7ce");
      select.appendChild(emptyOption);
      for (const target of this._listFlowInputTargets()) {
        const option = document.createElement("option");
        option.value = `${target.nodeId}\u0000${target.port}`;
        option.textContent = `${target.nodeId}.${target.port}`;
        if (currentTarget?.nodeId === target.nodeId && currentTarget?.port === target.port) option.selected = true;
        select.appendChild(option);
      }
      if (!currentTarget) emptyOption.selected = true;
      select.addEventListener("change", () => {
        if (!select.value) {
          this.model.disconnectFlowOutput(node.id, flowPort.name);
        } else {
          const [toNodeId, toPort] = select.value.split("\u0000");
          const result = this.model.connect(node.id, flowPort.name, toNodeId, toPort);
          if (!result.ok) this._setStatus(result.error, true);
        }
        this.render();
      });
      row.appendChild(select);
      this.inspectorEl.appendChild(row);
    }

    // Value input "上家" dropdowns (old engine _setInputSource pattern):
    // each value input is either a constant (editable literal) or wired to
    // one compatible upstream value output.
    for (const valuePort of definition?.valueInputs || []) {
      const row = document.createElement("label");
      row.className = "ng-editor-inspector-row";
      row.innerHTML = `<span>${valuePort.name}</span>`;
      const currentWire = this.model.listConnections().find((c) => c.toNodeId === node.id && c.toPort === valuePort.name);
      const select = document.createElement("select");
      const constantOption = document.createElement("option");
      constantOption.value = "";
      constantOption.textContent = t("legacy.cec3d5c5996b");
      select.appendChild(constantOption);
      for (const source of this._listValueSources(valuePort)) {
        const option = document.createElement("option");
        option.value = `${source.nodeId}\u0000${source.port}`;
        option.textContent = `${source.nodeId}.${source.port}`;
        if (currentWire && currentWire.fromNodeId === source.nodeId && currentWire.fromPort === source.port) option.selected = true;
        select.appendChild(option);
      }
      if (!currentWire) constantOption.selected = true;
      select.addEventListener("change", () => {
        if (!select.value) {
          this.model.clearValueInput(node.id, valuePort.name);
        } else {
          const [fromNodeId, fromPort] = select.value.split("\u0000");
          const result = this.model.connect(fromNodeId, fromPort, node.id, valuePort.name);
          if (!result.ok) this._setStatus(result.error, true);
        }
        this.render();
      });
      row.appendChild(select);
      if (!currentWire) {
        const value = node.inputs?.[valuePort.name];
        const input = document.createElement("input");
        input.type = "text";
        input.value = value === undefined ? "" : JSON.stringify(value);
        input.addEventListener("change", () => {
          try {
            node.inputs[valuePort.name] = input.value === "" ? undefined : JSON.parse(input.value);
          } catch {
            node.inputs[valuePort.name] = input.value;
          }
          this._renderNodes();
        });
        row.appendChild(input);
      }
      this.inspectorEl.appendChild(row);
    }
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = t("legacy.ff37dc39f935");
    deleteButton.addEventListener("click", () => {
      this.model.deleteNode(node.id);
      this.render();
    });
    this.inspectorEl.appendChild(deleteButton);
  }

  /** All nodes' flow-input ports, as connect() targets for the flow-output dropdowns above. */
  _listFlowInputTargets() {
    const targets = [];
    for (const candidate of this.model.listNodes()) {
      for (const port of listActivityNodePorts(candidate.type, "input")) {
        if (port.kind === "flow") targets.push({ nodeId: candidate.id, port: port.name });
      }
    }
    return targets;
  }

  /** Every value-output port across all nodes whose port type is compatible with `targetPort`, as connect() sources for a value-input dropdown. */
  _listValueSources(targetPort) {
    const sources = [];
    for (const candidate of this.model.listNodes()) {
      if (candidate.cl2Class === "valueReceiver") continue;
      for (const port of listActivityNodePorts(candidate.type, "output")) {
        if (port.kind === "value" && arePortsCompatible(port, targetPort)) sources.push({ nodeId: candidate.id, port: port.name });
      }
    }
    return sources;
  }

  /** No node selected: show the activity's own metadata instead (plan item 2), rather than a bare "未选中节点" placeholder. */
  _renderActivityMetadata() {
    const title = document.createElement("div");
    title.className = "ng-editor-inspector-title";
    title.textContent = t("legacy.2e2c4f99fc53");
    this.inspectorEl.appendChild(title);

    const nameRow = document.createElement("label");
    nameRow.className = "ng-editor-inspector-row";
    nameRow.innerHTML = "<span>displayName</span>";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = this.model.displayName;
    nameInput.addEventListener("change", () => this.model.setDisplayName(nameInput.value));
    nameRow.appendChild(nameInput);
    this.inspectorEl.appendChild(nameRow);

    const idRow = document.createElement("label");
    idRow.className = "ng-editor-inspector-row";
    idRow.innerHTML = "<span>activityId</span>";
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.value = this.model.activityId ?? "";
    idInput.addEventListener("change", () => {
      const nextId = idInput.value.trim();
      if (!nextId || nextId === this.model.activityId) { idInput.value = this.model.activityId ?? ""; return; }
      const previousId = this.model.activityId;
      try {
        this.model.setActivityId(nextId);
        this.onRenameId(previousId, nextId);
      } catch (err) {
        this.model.setActivityId(previousId);
        idInput.value = previousId ?? "";
        alert(err.message);
      }
    });
    idRow.appendChild(idInput);
    this.inspectorEl.appendChild(idRow);

    const startRow = document.createElement("div");
    startRow.className = "ng-editor-inspector-row";
    startRow.innerHTML = `<span>startNodeId</span><span>${this.model.startNodeId ?? `（${t("legacy.6e7400e98d2f")}`}</span>`;
    this.inspectorEl.appendChild(startRow);

    const countRow = document.createElement("div");
    countRow.className = "ng-editor-inspector-row";
    countRow.innerHTML = `<span>${t("legacy.c4fdaf4d2a8e")}</span><span>${this.model.nodeCount}</span>`;
    this.inspectorEl.appendChild(countRow);
  }

  dispose() {
    this._dragPointer.cancel();
    this._connectionDragPointer.cancel();
    this._boxSelectPointer.cancel();
  }
}

function cssEscape(value) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

export default ActivityEditorView;
// DEV-TOOLS:END
