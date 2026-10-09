// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { prepareWindowValueGraph } from "./WindowValueGraph.js";
import { createWindowEditorModel } from "./WindowEditorModel.js";
import { renderWindowRoot } from "../core/WidgetLayoutRenderer.js";
import { isBoundValue } from "../core/PropertyBinding.js";
import { disposeVirtualFileWidgetInstances } from "../core/VirtualFileWidgets.js";
import { writeDataFile, downloadTextFile } from "./devApi.js";

const WIDGET_TYPES = [
  "container", "tabs", "fieldset", "details", "label", "clock", "button", "textInput", "textarea",
  "select", "checkbox", "range", "image", "dialogue", "embeddedWindow", "saveLoad", "clueWall",
  "recordTabs", "list", "table", "progress", "spacer", "fileManager", "documentEditor", "filePicker", "terminal",
];
const CONTAINER_TYPES = new Set(["container", "tabs", "fieldset", "details"]);

/**
 * WindowEditorView - WYSIWYG editor for a window definition (plan §7.3).
 * The center canvas is rendered with the exact same
 * `renderWindowRoot()` used by the runtime WindowFrame, so the editor
 * preview and the running window can never visually diverge (plan §7.1).
 * A separate structure tree gives selection/reorder/reparent affordances
 * that a pure visual canvas can't express for flex/grid containers, whose
 * x/y are explicitly not meaningful (plan §7.3 "对 flex/grid 容器明确显示
 * 哪些 x/y 属性不生效").
 */
export class WindowEditorView {
  constructor({ definition, dataFileName, onSaveToMemory, onWriteToDisk, variableStore, pvGateway, dbGateway, runtimeGateway, customWidgetFactories, openEventBlueprintEditor, openValueBlueprintEditor, openWidgetSubEditor, gameClock, saveManager, eventBus, dialogueViews, windowDefinitionStore, conditionContext, openWindow, openVirtualPath } = {}) {
    this.model = createWindowEditorModel({ definition });
    this.dataFileName = dataFileName || null;
    this.onSaveToMemory = onSaveToMemory || (() => {});
    this.onWriteToDisk = onWriteToDisk || null;
    this.variableStore = variableStore || null;
    this.pvGateway = pvGateway || null;
    this.dbGateway = dbGateway || null;
    this.runtimeGateway = runtimeGateway || null;
    this.gameClock = gameClock || null;
    this.saveManager = saveManager || null;
    this.eventBus = eventBus || null;
    const dialogueTargets = Object.keys(dialogueViews || {});
    if (!dialogueTargets.length) dialogueTargets.push("dialogue");
    this.dialogueViews = Object.fromEntries(dialogueTargets.map((target) => {
      const el = document.createElement("div");
      el.className = "ng-dialogue-preview-placeholder";
      el.textContent = "对话显示区域预览";
      return [target, { el }];
    }));
    this.windowDefinitionStore = windowDefinitionStore || null;
    this.conditionContext = conditionContext || {};
    this.openWindow = openWindow || (() => {});
    this.openVirtualPath = openVirtualPath || (() => {});
    this.customWidgetFactories = customWidgetFactories || {};
    this.previewWidgetInstances = new Map();
    this.previewInstanceId = `window-editor-preview-${this.model.definition.id}`;
    this.openEventBlueprintEditor = openEventBlueprintEditor || null;
    this.openValueBlueprintEditor = openValueBlueprintEditor || null;
    this.openWidgetSubEditor = openWidgetSubEditor || null;
    this._buildDom();
    this.render();
    this._bindKeys();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-window-editor";
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="ng-editor-toolbar">
        <button type="button" data-action="undo" title="${t("legacy.9fcefd8dc81e")}">${t("legacy.9fcefd8dc81e")}</button>
        <button type="button" data-action="redo" title="${t("legacy.1238f0d36361")}">${t("legacy.1238f0d36361")}</button>
        <select class="ng-window-editor-add-type"></select>
        <button type="button" data-action="add" title="${t("legacy.ebd5dd943c92")}">${t("legacy.94191ce210d3")}</button>
        <button type="button" data-action="add-tab" title="${t("legacy.20e94ec10fb3")}">${t("legacy.afa85f9c9cd3")}</button>
        <button type="button" data-action="duplicate" title="${t("legacy.4584c49b2881")}">${t("legacy.4edd1d00875d")}</button>
        <button type="button" data-action="delete" title="${t("legacy.7e8b0e5b4ebb")}(Delete)">${t("legacy.42b7a0e01134")}</button>
        <button type="button" data-action="save" title="${t("legacy.b02ae67098e2")}">${t("legacy.b02ae67098e2")}</button>
        <button type="button" data-action="download" title="${t("legacy.3f10b573ee1b")}JSON">${t("legacy.2b9d013177da")}</button>
        <button type="button" data-action="write-disk" title="${t("legacy.81ee3266b03d")}">${t("legacy.81ee3266b03d")}</button>
        <span class="ng-editor-status"></span>
      </div>
      <div class="ng-window-editor-body">
        <div class="ng-window-editor-structure"></div>
        <div class="ng-window-editor-preview"></div>
        <div class="ng-window-editor-inspector"></div>
      </div>
    `;
    this.el = el;
    this.statusEl = el.querySelector(".ng-editor-status");
    this.typeSelectEl = el.querySelector(".ng-window-editor-add-type");
    for (const type of WIDGET_TYPES) {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = type;
      this.typeSelectEl.appendChild(opt);
    }
    this.structureEl = el.querySelector(".ng-window-editor-structure");
    this.previewEl = el.querySelector(".ng-window-editor-preview");
    this.inspectorEl = el.querySelector(".ng-window-editor-inspector");
    el.addEventListener("click", (e) => {
      const button = e.target.closest("[data-action]");
      if (button) this._onAction(button.dataset.action);
    });
  }

  _bindKeys() {
    this.el.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea, select")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this._onAction("delete");
      }
    });
  }

  _onAction(action) {
    const selectedId = this.model.getSelectedId();
    switch (action) {
      case "undo": this.model.undo(); break;
      case "redo": this.model.redo(); break;
      case "add": {
        const selected = selectedId ? this.model.findWidget(selectedId) : null;
        const parentId = selected && CONTAINER_TYPES.has(selected.node.type) ? selected.node.widgetId : selected?.parent?.widgetId || "root";
        this.model.addWidget(this.typeSelectEl.value, parentId);
        break;
      }
      case "add-tab": this.model.addTab(selectedId || "root"); break;
      case "duplicate": if (selectedId) this.model.duplicateWidget(selectedId); break;
      case "delete": if (selectedId) this.model.removeWidget(selectedId); break;
      case "save": this._save(); return;
      case "download": downloadTextFile(this.dataFileName || `${this.model.definition.id}.json`, JSON.stringify(this.model.toDefinition(), null, 2)); return;
      case "write-disk": this._writeDisk(); return;
      default: return;
    }
    this.render();
  }

  _save() {
    this.onSaveToMemory(this.model.toDefinition());
    this.statusEl.textContent = t("legacy.bedc3c6afcd3");
  }

  async _writeDisk() {
    if (!this.dataFileName) return;
    try {
      if (this.onWriteToDisk) await this.onWriteToDisk(this.model.toDefinition());
      else await writeDataFile(this.dataFileName, JSON.stringify(this.model.toDefinition(), null, 2));
      this.statusEl.textContent = t("legacy.d4371481b26a");
    } catch (err) {
      this.statusEl.textContent = `${t("legacy.e92dc2256061")}: ${err.message}`;
    }
  }

  render() {
    this._renderStructure();
    this._renderPreview();
    this._renderInspector();
  }

  _renderStructure() {
    this.structureEl.innerHTML = "";
    const selectedId = this.model.getSelectedId();
    const renderNode = (node, depth) => {
      const row = document.createElement("div");
      row.className = "ng-window-editor-structure-row";
      row.style.paddingLeft = `${depth * 14}px`;
      row.dataset.widgetId = node.widgetId;
      row.draggable = node.widgetId !== "root";
      row.textContent = `${node.type} (${node.widgetId})`;
      row.classList.toggle("selected", node.widgetId === selectedId);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        this.model.select(node.widgetId);
        this.render();
      });
      row.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/widget-id", node.widgetId);
      });
      if (CONTAINER_TYPES.has(node.type)) {
        row.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const draggedId = e.dataTransfer.getData("text/widget-id");
          if (draggedId) this.model.moveWidget(draggedId, node.widgetId, null);
          this.render();
        });
      }
      this.structureEl.appendChild(row);
      if (CONTAINER_TYPES.has(node.type)) {
        for (const child of node.children || []) renderNode(child, depth + 1);
      }
    };
    renderNode(this.model.definition.root, 0);
  }

  _renderPreview() {
    this.previewDragCleanup?.();
    this.previewDragCleanup = null;
    this.previewEl.innerHTML = "";
    disposeVirtualFileWidgetInstances(this.previewWidgetInstances);
    this.previewWidgetInstances = new Map();
    // Same renderer + same ctx shape the runtime WindowFrame uses (plan
    // §7.1), so a bound property previews exactly as it will run.
    const { el, widgetEls } = renderWindowRoot(this.model.definition.root, {
      variableStore: this.variableStore,
      pvGateway: this.pvGateway,
      dbGateway: this.dbGateway,
      runtimeGateway: this.runtimeGateway,
      gameClock: this.gameClock,
      dialogueViews: this.dialogueViews,
      windowDefinitionStore: this.windowDefinitionStore,
      conditionContext: this.conditionContext,
      openWindow: this.openWindow,
      openVirtualPath: this.openVirtualPath,
      keywordResolver: (id) => this.dbGateway?.getRecord?.("keywords", id)?.content || null,
      valueGraph: this.model.definition.valueGraph,
      customWidgetFactories: this.customWidgetFactories,
      windowInstanceId: this.previewInstanceId,
      widgetInstances: this.previewWidgetInstances,
      parameters: [],
    });
    const previewWindow = document.createElement("div");
    previewWindow.className = "ng-window ng-window-editor-preview-window focused bevel-out";
    previewWindow.classList.toggle("fullscreen", Boolean(this.model.definition.fullscreen));
    previewWindow.style.width = `${Math.max(240, Number(this.model.definition.width) || 480)}px`;
    previewWindow.style.height = `${Math.max(160, Number(this.model.definition.height) || 360)}px`;
    previewWindow.style.left = this.model.definition.fullscreen ? "0px" : `${Number(this.model.definition.x) || 0}px`;
    previewWindow.style.top = this.model.definition.fullscreen ? "0px" : `${Number(this.model.definition.y) || 0}px`;
    const titlebar = document.createElement("div");
    titlebar.className = "ng-titlebar";
    const title = document.createElement("div");
    title.className = "ng-titlebar-title";
    const icon = document.createElement("span");
    icon.className = "ng-titlebar-icon";
    icon.textContent = this.model.definition.icon || "🗔";
    const titleText = document.createElement("span");
    titleText.className = "ng-title";
    titleText.textContent = this.model.definition.title || this.model.definition.id;
    title.append(icon, titleText);
    const controls = document.createElement("div");
    controls.className = "ng-window-controls";
    for (const [label, className] of [["_", "ng-min"], ["□", "ng-max"], ["✕", "ng-close"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `bevel-out ng-window-control ${className}`;
      button.textContent = label;
      button.disabled = true;
      controls.appendChild(button);
    }
    titlebar.append(title, controls);
    const body = document.createElement("div");
    body.className = "ng-body";
    body.appendChild(el);
    previewWindow.append(titlebar, body);
    el.addEventListener("click", (e) => {
      const target = e.target.closest("[data-widget-id]");
      if (!target) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.model.select(target.dataset.widgetId);
      this.render();
    }, true);
    this._bindPreviewDrag(el, widgetEls);
    this.previewEl.appendChild(previewWindow);
  }

  /**
   * Drag-to-reposition on the rendered preview. A free-position drop may
   * convert a flow/grid container to `stack`, but first snapshots every
   * rendered child's local coordinates so the conversion cannot collapse
   * siblings at the stack default (0,0).
   */
  _bindPreviewDrag(rootEl, widgetEls) {
    const rootWidgetId = this.model.definition.root.widgetId;
    const doc = rootEl.ownerDocument || document;
    let activeDrag = null;

    const getPosition = (containerEl, child) => {
      const childEl = widgetEls.get(child.widgetId);
      if (!childEl) return null;
      const parentRect = containerEl.getBoundingClientRect();
      const childRect = childEl.getBoundingClientRect();
      return {
        x: Math.round(childRect.left - parentRect.left - (containerEl.clientLeft || 0)),
        y: Math.round(childRect.top - parentRect.top - (containerEl.clientTop || 0)),
      };
    };

    const snapshotPositions = (containerNode, containerEl) => Object.fromEntries(
      (containerNode.children || []).map((child) => [child.widgetId, getPosition(containerEl, child)])
        .filter(([, position]) => position),
    );

    const applyStackPreview = (containerNode) => {
      const containerEl = widgetEls.get(containerNode.widgetId);
      if (!containerEl) return;
      containerEl.dataset.flow = "stack";
      containerEl.style.position = "relative";
      containerEl.style.display = "";
      containerEl.style.flexDirection = "";
      containerEl.style.flexWrap = "";
      for (const child of containerNode.children || []) {
        const childEl = widgetEls.get(child.widgetId);
        if (!childEl) continue;
        childEl.style.position = "absolute";
        childEl.style.left = `${Number.isFinite(Number(child.x)) ? child.x : 0}px`;
        childEl.style.top = `${Number.isFinite(Number(child.y)) ? child.y : 0}px`;
      }
    };

    const localDropPosition = (drag, event, parent) => {
      const containerEl = widgetEls.get(parent.widgetId);
      if (!containerEl) return null;
      const rect = containerEl.getBoundingClientRect();
      return {
        x: Math.max(0, Math.round(event.clientX - rect.left - (containerEl.clientLeft || 0) - drag.dx)),
        y: Math.max(0, Math.round(event.clientY - rect.top - (containerEl.clientTop || 0) - drag.dy)),
      };
    };

    const onPointerMove = (event) => {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      const deltaX = event.clientX - activeDrag.startX;
      const deltaY = event.clientY - activeDrag.startY;
      if (!activeDrag.started && deltaX * deltaX + deltaY * deltaY < 9) return;
      const entry = this.model.findWidget(activeDrag.widgetId);
      const parent = entry?.parent;
      if (!parent) return;
      const position = localDropPosition(activeDrag, event, parent);
      if (!position) return;
      if (!activeDrag.started) {
        const parentEl = widgetEls.get(parent.widgetId);
        const positions = snapshotPositions(parent, parentEl);
        if (!this.model.placeWidget(activeDrag.widgetId, parent.widgetId, { ...position, positions })) return;
        activeDrag.started = true;
        activeDrag.parent = parent;
        applyStackPreview(parent);
      } else {
        this.model.updateWidgetProps(activeDrag.widgetId, position, { recordHistory: false });
        const draggedEl = widgetEls.get(activeDrag.widgetId);
        if (draggedEl) {
          draggedEl.style.position = "absolute";
          draggedEl.style.left = `${position.x}px`;
          draggedEl.style.top = `${position.y}px`;
        }
      }
      event.preventDefault?.();
    };

    const releaseCapture = (drag) => {
      try {
        if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
        else drag.element.releasePointerCapture?.(drag.pointerId);
      } catch { /* The element may have been detached by a surrounding editor refresh. */ }
    };

    const finishDrag = (event, cancelled = false) => {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      const drag = activeDrag;
      if (!cancelled) onPointerMove(event);
      if (!cancelled && drag.started) {
        const hit = doc.elementFromPoint?.(event.clientX, event.clientY);
        const hitWidgetId = hit?.closest?.("[data-widget-id]")?.dataset?.widgetId || hit?.dataset?.widgetId;
        const hitEntry = hitWidgetId ? this.model.findWidget(hitWidgetId) : null;
        const destination = hitEntry && (CONTAINER_TYPES.has(hitEntry.node.type) ? hitEntry.node : hitEntry.parent);
        if (destination && destination.widgetId !== drag.parent.widgetId) {
          const destinationEl = widgetEls.get(destination.widgetId);
          const position = localDropPosition(drag, event, destination);
          if (destinationEl && position && this.model.placeWidget(drag.widgetId, destination.widgetId, {
            ...position,
            positions: snapshotPositions(destination, destinationEl),
            recordHistory: false,
          })) applyStackPreview(destination);
        }
      }
      activeDrag = null;
      releaseCapture(drag);
      if (cancelled && drag.started) this.model.undo();
      if (drag.started) this.render();
    };

    for (const [widgetId, el] of widgetEls) {
      if (widgetId === rootWidgetId) continue;
      el.style.touchAction = "none";
      el.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        const entry = this.model.findWidget(widgetId);
        if (!entry?.parent) return;
        const rect = el.getBoundingClientRect();
        activeDrag = {
          widgetId,
          element: el,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dx: event.clientX - rect.left,
          dy: event.clientY - rect.top,
          started: false,
        };
        try { el.setPointerCapture?.(event.pointerId); } catch { /* Document listeners remain the fallback. */ }
        event.stopPropagation?.();
      });
    }
    doc.addEventListener("pointermove", onPointerMove);
    const pointerUp = (event) => finishDrag(event);
    const pointerCancel = (event) => finishDrag(event, true);
    doc.addEventListener("pointerup", pointerUp);
    doc.addEventListener("pointercancel", pointerCancel);
    const cleanup = () => {
      doc.removeEventListener?.("pointermove", onPointerMove);
      doc.removeEventListener?.("pointerup", pointerUp);
      doc.removeEventListener?.("pointercancel", pointerCancel);
      if (activeDrag) {
        const drag = activeDrag;
        activeDrag = null;
        releaseCapture(drag);
        if (drag.started) this.model.undo();
      }
    };
    this.previewDragCleanup = cleanup;
    return cleanup;
  }

  _renderInspector() {
    this.inspectorEl.innerHTML = "";
    const node = this.model.getSelected();
    if (!node) {
      // Mirrors ActivityEditorView's convention: with nothing selected the
      // inspector shows the window's own metadata instead of going blank.
      this._renderWindowMetaInspector();
      if (this.openValueBlueprintEditor) this._appendValueGraphButton();
      return;
    }
    if (this.openValueBlueprintEditor) {
      const graphButton = document.createElement("button");
      graphButton.type = "button";
      graphButton.textContent = t("legacy.3079067d88f0");
      graphButton.title = t("legacy.039b8514593b");
      graphButton.addEventListener("click", () => this._openValueBlueprintEditor());
      this.inspectorEl.append(graphButton);
    }
    const fields = this._fieldsFor(node);
    for (const field of fields) {
      const row = document.createElement(field.type === "subEditor" ? "div" : "label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${field.label}</span>`;
      if (field.type === "subEditor") {
        const rawValue = node[field.key];
        const bound = Boolean(field.bindable && isBoundValue(rawValue));
        if (field.bindable) {
          const bindToggle = document.createElement("input");
          bindToggle.type = "checkbox";
          bindToggle.className = "ng-window-editor-field-bind-toggle";
          bindToggle.title = t("legacy.d648e52c700c");
          bindToggle.checked = bound;
          bindToggle.addEventListener("change", () => {
            this.model.updateWidgetProps(node.widgetId, { [field.key]: bindToggle.checked ? { variable: "" } : null });
            this.render();
          });
          row.appendChild(bindToggle);
        }
        if (bound) {
          const bindingInput = document.createElement("input");
          bindingInput.type = "text";
          bindingInput.placeholder = t("legacy.f6fff4b55164");
          bindingInput.value = rawValue.variable || (rawValue.nodeId ? `@${rawValue.nodeId}:${rawValue.port || "value"}` : "");
          bindingInput.addEventListener("input", () => {
            this.model.updateWidgetProps(node.widgetId, { [field.key]: this._parseBinding(bindingInput.value) });
            this._renderPreview();
          });
          row.appendChild(bindingInput);
        }
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.textContent = t("windowEditor.subeditor.open", "编辑…");
        editButton.disabled = !this.openWidgetSubEditor || bound;
        editButton.addEventListener("click", () => this._openWidgetSubEditor(node, field.editorKind));
        row.appendChild(editButton);
        this.inspectorEl.appendChild(row);
        continue;
      }
      const rawValue = node[field.key];
      const bound = Boolean(field.bindable && isBoundValue(rawValue));
      if (field.bindable) {
        const bindToggle = document.createElement("input");
        bindToggle.type = "checkbox";
        bindToggle.className = "ng-window-editor-field-bind-toggle";
        bindToggle.title = t("legacy.d648e52c700c");
        bindToggle.checked = bound;
        bindToggle.addEventListener("change", () => {
          const patch = bindToggle.checked
            ? { [field.key]: { variable: "" } }
            : { [field.key]: field.type === "collection" ? [] : field.type === "number" ? 0 : field.type === "checkbox" ? true : "" };
          this.model.updateWidgetProps(node.widgetId, patch);
          this.render();
        });
        row.appendChild(bindToggle);
      }
      if (field.type === "collection" && !bound) {
        row.appendChild(this._renderCollectionEditor(node, field));
        this.inspectorEl.appendChild(row);
        continue;
      }
      const input = document.createElement(field.type === "checkbox" ? "input" : field.type === "select" ? "select" : field.type === "multiline" ? "textarea" : "input");
      if (bound) {
        if (input.tagName === "INPUT") input.type = "text";
        input.placeholder = t("legacy.f6fff4b55164");
        input.value = rawValue.variable || (rawValue.nodeId ? `@${rawValue.nodeId}:${rawValue.port || "value"}` : "");
      } else if (field.type === "checkbox") {
        input.type = "checkbox";
        input.checked = Boolean(field.value);
      } else if (field.type === "number") {
        input.type = "number";
        input.value = field.value ?? "";
      } else if (field.type === "dimension") {
        input.type = "number";
        input.min = "0";
        input.value = field.value ?? "";
      } else if (field.type === "select") {
        for (const option of field.options) {
          const opt = document.createElement("option");
          opt.value = typeof option === "object" ? option.value : option;
          opt.textContent = typeof option === "object" ? option.label : option;
          input.appendChild(opt);
        }
        input.value = field.value ?? "";
      } else {
        if (input.tagName === "INPUT") input.type = "text";
        input.value = field.value ?? "";
      }
      // Text inputs only patch the model on "input" and never trigger a
      // full re-render mid-typing, so focus is never lost (plan §7.3
      // "输入框 text 事件只更新现有 inspector 值，不整体重绘导致失焦").
      const updateField = () => {
        const value = bound
          ? this._parseBinding(input.value)
          : field.type === "checkbox" ? input.checked
          : field.type === "dimension" ? (input.value === "" ? null : Number(input.value))
          : field.type === "number" ? Number(input.value)
          : input.value;
        if (field.key === "widgetId") {
          this.model.renameWidget(node.widgetId, value);
          this.render();
          return;
        }
        this.model.updateWidgetProps(node.widgetId, { [field.key]: value });
        this._renderStructure();
        this._renderPreview();
      };
      input.addEventListener(field.key === "widgetId" || field.type === "select" || field.type === "checkbox" ? "change" : "input", updateField);
      row.appendChild(input);
      this.inspectorEl.appendChild(row);
    }
    this._renderGeometryInspector(node);
    this._renderEventsInspector(node);
  }

  _renderCollectionEditor(node, field) {
    const root = document.createElement("div");
    root.className = "ng-window-editor-collection";
    const initial = Array.isArray(node[field.key]) ? structuredClone(node[field.key]) : [];
    const defaultEntry = (path = []) => field.key === "options" ? { value: "", label: "" }
      : field.key === "rows" ? (path.length === 0 ? [] : "")
      : field.key === "itemActions" ? { id: "action", label: "Action", eventName: "onAction" } : {};
    const commit = (value, refresh = false) => {
      this.model.updateWidgetProps(node.widgetId, { [field.key]: value });
      this._renderPreview();
      if (refresh) this._renderInspector();
    };
    const replaceAt = (value, path, replacement) => {
      if (!path.length) return replacement;
      const [key, ...rest] = path;
      const copy = Array.isArray(value) ? [...value] : { ...value };
      copy[key] = replaceAt(value[key], rest, replacement);
      return copy;
    };
    const addButton = (label, callback) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", callback);
      return button;
    };
    const renderValue = (value, path, depth = 0) => {
      const box = document.createElement("div");
      box.className = "ng-window-editor-value-node";
      if (depth > 6) { box.textContent = "Nested value depth limit"; return box; }
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const card = document.createElement("div");
          card.className = "ng-window-editor-value-entry";
          card.appendChild(renderValue(item, [...path, index], depth + 1));
          card.appendChild(addButton("Remove", () => {
            const next = structuredClone(node[field.key]);
            let parent = next;
            for (const part of path) parent = parent[part];
            parent.splice(index, 1);
            commit(next, true);
          }));
          box.appendChild(card);
        });
        box.appendChild(addButton("Add entry", () => {
          const next = structuredClone(node[field.key]);
          let parent = next;
          for (const part of path) parent = parent[part];
          parent.push(defaultEntry(path));
          commit(next, true);
        }));
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          const row = document.createElement("div");
          row.className = "ng-window-editor-value-property";
          const name = document.createElement("input");
          name.type = "text";
          name.value = key;
          name.setAttribute("aria-label", "Property name");
          name.addEventListener("change", () => {
            const next = structuredClone(node[field.key]);
            let parent = next;
            for (const part of path) parent = parent[part];
            const nextName = name.value.trim();
            if (nextName && nextName !== key && !(nextName in parent)) {
              parent[nextName] = parent[key];
              delete parent[key];
              commit(next, true);
            }
          });
          row.append(name, renderValue(child, [...path, key], depth + 1));
          row.appendChild(addButton("Remove", () => {
            const next = structuredClone(node[field.key]);
            let parent = next;
            for (const part of path) parent = parent[part];
            delete parent[key];
            commit(next, true);
          }));
          box.appendChild(row);
        }
        box.appendChild(addButton("Add property", () => {
          const next = structuredClone(node[field.key]);
          let parent = next;
          for (const part of path) parent = parent[part];
          let name = `field${Object.keys(parent).length + 1}`;
          while (name in parent) name += "_";
          parent[name] = "";
          commit(next, true);
        }));
      } else {
        const type = document.createElement("select");
        for (const item of ["string", "number", "boolean", "null", "object", "array"]) {
          const option = document.createElement("option");
          option.value = item;
          option.textContent = item;
          type.appendChild(option);
        }
        type.value = value === null ? "null" : typeof value;
        const input = document.createElement(value === "boolean" ? "select" : "input");
        if (value === "boolean") {
          for (const item of ["true", "false"]) {
            const option = document.createElement("option");
            option.value = item;
            option.textContent = item;
            input.appendChild(option);
          }
          input.value = String(value);
        } else {
          input.type = value === "number" ? "number" : "text";
          input.value = value == null ? "" : String(value);
        }
        const update = () => {
          const nextValue = type.value === "null" ? null : type.value === "number" ? Number(input.value)
            : type.value === "boolean" ? input.value === "true" : input.value;
          commit(replaceAt(structuredClone(node[field.key]), path, nextValue));
        };
        type.addEventListener("change", () => {
          const nextValue = type.value === "object" ? {} : type.value === "array" ? []
            : type.value === "boolean" ? false : type.value === "number" ? 0 : type.value === "null" ? null : "";
          commit(replaceAt(structuredClone(node[field.key]), path, nextValue), true);
        });
        input.addEventListener("input", update);
        box.append(type, input);
      }
      return box;
    };
    root.appendChild(renderValue(initial, []));
    return root;
  }

  _appendValueGraphButton() {
    const graphButton = document.createElement("button");
    graphButton.type = "button";
    graphButton.textContent = t("legacy.3079067d88f0");
    graphButton.title = t("legacy.039b8514593b");
    graphButton.addEventListener("click", () => this._openValueBlueprintEditor());
    this.inspectorEl.append(graphButton);
  }

  _openWidgetSubEditor(node, kind) {
    if (!this.openWidgetSubEditor || !node) return false;
    this.openWidgetSubEditor({
      kind,
      widget: structuredClone(node),
      displayName: `${this.model.definition.id || "window"} · ${node.widgetId}`,
      onSave: (patch) => {
        if (!patch || typeof patch !== "object") return false;
        const saved = this.model.updateWidgetProps(node.widgetId, structuredClone(patch));
        if (saved) this.render();
        return saved;
      },
    });
    return true;
  }

  _openValueBlueprintEditor() {
    const prepared = prepareWindowValueGraph(this.model.definition);
    this.openValueBlueprintEditor({
      blueprint: prepared.blueprint,
      displayName: `${this.model.definition.id || "window"} ${t("legacy.f6cf556d44a8")}`,
      onSaveToMemory: (blueprint) => {
        this.model.definition.root = prepared.root;
        this.model.definition.valueGraph = blueprint;
        this.render();
        this.onSaveToMemory(this.model.definition);
      },
    });
  }

  _parseBinding(text) {
    const value = String(text || "").trim();
    if (value.startsWith("@")) {
      const [nodeId, port = "value"] = value.slice(1).split(":");
      return { nodeId, port };
    }
    return { variable: value };
  }

  /**
   * x/y is only real, editable geometry when the widget's parent container
   * is `flow: "stack"` (a free-placement canvas, like a blueprint node) -
   * every other flow lays widgets out via flex/grid, where x/y do nothing,
   * so the fields are shown but disabled with an explanatory note instead
   * of pretending to be live geometry (plan §7.3 "对 flex/grid 容器明确
   * 显示哪些 x/y 属性不生效，不能伪装成可编辑几何").
   */
  _renderGeometryInspector(node) {
    const entry = this.model.findWidget(node.widgetId);
    const stackParent = Boolean(entry?.parent && entry.parent.flow === "stack");
    const section = document.createElement("div");
    section.className = "ng-window-editor-geometry";
    section.innerHTML = t("legacy.ee8c24009f69");
    if (!stackParent) {
      const note = document.createElement("div");
      note.className = "ng-editor-empty";
      note.textContent = entry?.parent ? `${t("legacy.8186bfa982cc")}flow="${entry.parent.flow || "vertical"}"，x/y ${t("legacy.0693a940628e")}stack ${t("legacy.8f2b9a19b740")}` : t("legacy.16260f48b60c");
      section.appendChild(note);
      this.inspectorEl.appendChild(section);
      return;
    }
    for (const key of ["x", "y"]) {
      const row = document.createElement("label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${key}</span>`;
      const input = document.createElement("input");
      const bound = isBoundValue(node[key]);
      const bindToggle = document.createElement("input");
      bindToggle.type = "checkbox";
      bindToggle.checked = bound;
      bindToggle.title = t("legacy.77071646e7f4");
      bindToggle.addEventListener("change", () => {
        this.model.updateWidgetProps(node.widgetId, { [key]: bindToggle.checked ? { variable: "" } : 0 });
        this._renderInspector();
      });
      row.appendChild(bindToggle);
      input.type = bound ? "text" : "number";
      input.value = bound ? (node[key].variable || (node[key].nodeId ? `@${node[key].nodeId}:${node[key].port || "value"}` : "")) : (Number.isFinite(node[key]) ? node[key] : 0);
      if (bound) input.placeholder = t("legacy.b8b53421a2d0");
      input.addEventListener("input", () => {
        this.model.updateWidgetProps(node.widgetId, { [key]: bound ? this._parseBinding(input.value) : Number(input.value) || 0 });
        this._renderPreview();
      });
      row.appendChild(input);
      section.appendChild(row);
    }
    this.inspectorEl.appendChild(section);
  }

  /** Which `events[eventName]` blueprints actually fire for a widget type (mirrors WidgetLayoutRenderer's ctx.onEvent call sites). */
  _eventNamesFor(type, node = null) {
    if (type === "button") return ["onClick"];
    if (type === "list") return [...new Set(["onItemClick", ...(node?.itemActions || []).map((action) => action.eventName || action.id).filter(Boolean)])];
    if (["textInput", "textarea", "select", "checkbox", "range"].includes(type)) return ["onChange", "onFocus", "onBlur"];
    return [];
  }

  /**
   * "窗口组件也有对应的操作蓝图，比如说 onClick、onChange 等等" - every
   * interactive widget can bind each of its events to an inline Blueprint,
   * authored in the exact same ActivityEditorView used for top-level
   * Activities (opened via `openEventBlueprintEditor`, wired by
   * DeveloperMode). Nothing here executes the blueprint - only the runtime
   * WindowFrame's `onEvent` ctx (engine.js's `runWidgetEvent`) does that -
   * this is purely the authoring affordance.
   */
  _renderEventsInspector(node) {
    const eventNames = this._eventNamesFor(node.type, node);
    if (!eventNames.length) return;
    const section = document.createElement("div");
    section.className = "ng-window-editor-events";
    section.innerHTML = t("legacy.69840b476d34");
    for (const eventName of eventNames) {
      const row = document.createElement("div");
      row.className = "ng-window-editor-event-row";
      const bound = Boolean(node.events?.[eventName]);
      const status = document.createElement("span");
      status.textContent = `${eventName}: ${bound ? t("legacy.b3addb5e3f54") : t("legacy.3bf179d8d045")}`;
      row.appendChild(status);
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = t("legacy.140e881a82ed");
      editButton.disabled = !this.openEventBlueprintEditor;
      editButton.addEventListener("click", () => {
        this.openEventBlueprintEditor(node.events?.[eventName] || null, `${node.widgetId}.${eventName}`, (blueprint) => {
          this.model.updateWidgetProps(node.widgetId, { events: { ...(node.events || {}), [eventName]: blueprint } });
          this._renderInspector();
        });
      });
      row.appendChild(editButton);
      if (bound) {
        const clearButton = document.createElement("button");
        clearButton.type = "button";
        clearButton.textContent = t("legacy.7b15e5e8e7bd");
        clearButton.addEventListener("click", () => {
          this.model.updateWidgetProps(node.widgetId, { events: { ...(node.events || {}), [eventName]: null } });
          this._renderInspector();
        });
        row.appendChild(clearButton);
      }
      section.appendChild(row);
    }
    this.inspectorEl.appendChild(section);
  }

  _renderWindowMetaInspector() {
    const definition = this.model.definition;
    const fields = [
      { key: "title", label: "title", type: "text", value: definition.title || "" },
      { key: "icon", label: "icon", type: "text", value: definition.icon || "🪟" },
      { key: "fullscreen", label: "fullscreen", type: "checkbox", value: Boolean(definition.fullscreen) },
      { key: "resizable", label: "resizable", type: "checkbox", value: definition.resizable ?? true },
      { key: "singleInstance", label: "singleInstance", type: "checkbox", value: definition.singleInstance ?? true },
      { key: "alwaysOnTop", label: "alwaysOnTop", type: "checkbox", value: Boolean(definition.alwaysOnTop) },
      { key: "x", label: "x", type: "number", value: definition.x ?? 60 },
      { key: "y", label: "y", type: "number", value: definition.y ?? 40 },
      { key: "width", label: "width", type: "number", value: definition.width ?? 480 },
      { key: "height", label: "height", type: "number", value: definition.height ?? 360 },
    ];
    for (const field of fields) {
      const row = document.createElement("label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${field.label}</span>`;
      const input = document.createElement(field.type === "select" ? "select" : "input");
      if (field.type === "checkbox") {
        input.type = "checkbox";
        input.checked = Boolean(field.value);
      } else if (field.type === "select") {
        for (const option of field.options) {
          const opt = document.createElement("option");
          opt.value = typeof option === "object" ? option.value : option;
          opt.textContent = typeof option === "object" ? option.label : option;
          input.appendChild(opt);
        }
        input.value = field.value ?? "";
      } else {
        input.type = field.type === "number" ? "number" : "text";
        if (field.key === "width") input.min = "220";
        if (field.key === "height") input.min = "140";
        input.value = field.value ?? "";
      }
      const updateWindowField = () => {
        const value = field.type === "checkbox" ? input.checked : field.type === "number" ? Number(input.value) : input.value;
        this.model.updateWindowProps({ [field.key]: value });
        if (field.key === "title" || field.key === "icon") {
          const previewWindow = this.previewEl.querySelector(".ng-window-editor-preview-window");
          const title = previewWindow?.querySelector(".ng-title");
          const icon = previewWindow?.querySelector(".ng-titlebar-icon");
          if (title) title.textContent = this.model.definition.title || this.model.definition.id;
          if (icon) icon.textContent = this.model.definition.icon || "🗔";
        } else if (field.key === "width" || field.key === "height") {
          const previewWindow = this.previewEl.querySelector(".ng-window-editor-preview-window");
          if (previewWindow && !this.model.definition.fullscreen) {
            previewWindow.style[field.key] = `${Math.max(field.key === "width" ? 260 : 160, Number(value) || 0)}px`;
          }
        } else if (field.key === "x" || field.key === "y") {
          const previewWindow = this.previewEl.querySelector(".ng-window-editor-preview-window");
          if (previewWindow && !this.model.definition.fullscreen) previewWindow.style[field.key] = `${Number(value) || 0}px`;
        } else if (field.key === "fullscreen") {
          this._renderPreview();
        }
      };
      input.addEventListener(field.type === "checkbox" || field.type === "select" ? "change" : "input", updateWindowField);
      row.appendChild(input);
      this.inspectorEl.appendChild(row);
    }
    this._renderWindowEventsInspector();
  }

  _renderWindowEventsInspector() {
    const section = document.createElement("div");
    section.className = "ng-window-editor-events";
    section.innerHTML = `<h4>${t("legacy.69840b476d34")}</h4>`;
    for (const eventName of ["onCreate", "onDestroy"]) {
      const row = document.createElement("div");
      row.className = "ng-window-editor-event-row";
      const blueprint = this.model.definition.events?.[eventName] || null;
      const status = document.createElement("span");
      status.textContent = `${eventName}: ${blueprint ? t("legacy.b3addb5e3f54") : t("legacy.3bf179d8d045")}`;
      row.appendChild(status);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = t("legacy.140e881a82ed");
      edit.disabled = !this.openEventBlueprintEditor;
      edit.addEventListener("click", () => this.openEventBlueprintEditor(blueprint, `${this.model.definition.id}.${eventName}`, (next) => {
        this.model.updateWindowProps({ events: { ...(this.model.definition.events || {}), [eventName]: next } });
        this._renderInspector();
      }));
      row.appendChild(edit);
      if (blueprint) {
        const clear = document.createElement("button");
        clear.type = "button";
        clear.textContent = t("legacy.7b15e5e8e7bd");
        clear.addEventListener("click", () => {
          this.model.updateWindowProps({ events: { ...(this.model.definition.events || {}), [eventName]: null } });
          this._renderInspector();
        });
        row.appendChild(clear);
      }
      section.appendChild(row);
    }
    this.inspectorEl.appendChild(section);
  }

  _fieldsFor(node) {
    const common = [
      { key: "widgetId", label: "widgetId", type: "text", value: node.widgetId },
      { key: "className", label: "className", type: "text", value: node.className || "", bindable: true },
      { key: "visible", label: "visible", type: "checkbox", value: node.visible ?? true, bindable: true },
      { key: "enabled", label: "enabled", type: "checkbox", value: node.enabled ?? true, bindable: true },
      { key: "width", label: "width", type: "dimension", value: node.width ?? (node.type === "clueWall" ? 620 : null), bindable: true },
      { key: "height", label: "height", type: "dimension", value: node.height ?? null, bindable: true },
      { key: "minWidth", label: "minWidth", type: "dimension", value: node.minWidth ?? null, bindable: true },
      { key: "minHeight", label: "minHeight", type: "dimension", value: node.minHeight ?? null, bindable: true },
      { key: "maxWidth", label: "maxWidth", type: "dimension", value: node.maxWidth ?? null, bindable: true },
      { key: "maxHeight", label: "maxHeight", type: "dimension", value: node.maxHeight ?? null, bindable: true },
    ];
    if (CONTAINER_TYPES.has(node.type)) {
      return [
        ...common,
        { key: "flow", label: "flow", type: "select", options: ["vertical", "horizontal", "grid", "stack"], value: node.flow || "vertical", bindable: true },
        { key: "gap", label: "gap", type: "number", value: node.gap ?? 0, bindable: true },
        { key: "padding", label: "padding", type: "number", value: node.padding ?? 0, bindable: true },
        { key: "wrap", label: "wrap", type: "checkbox", value: Boolean(node.wrap), bindable: true },
        { key: "align", label: "align", type: "text", value: node.align || "", bindable: true },
        { key: "justify", label: "justify", type: "text", value: node.justify || "", bindable: true },
        ...(node.type === "tabs" ? [{ key: "__tabsEditor", label: t("windowEditor.subeditor.tabsTitle", "选项卡"), type: "subEditor", editorKind: "tabs" }] : []),
        ...(node.type === "fieldset" ? [{ key: "legend", label: "legend", type: "text", value: node.legend || "" }] : []),
        ...(node.type === "details" ? [{ key: "summary", label: "summary", type: "text", value: node.summary || "" }] : []),
      ];
    }
    if (node.type === "label" || node.type === "button") {
      return [...common,
        { key: "text", label: "text", type: "multiline", value: node.text || "", bindable: true },
        ...(node.type === "label" ? [{ key: "keywordMarkup", label: "keywordMarkup", type: "checkbox", value: Boolean(node.keywordMarkup) }] : []),
      ];
    }
    if (node.type === "clock") return [...common, { key: "format", label: "format", type: "select", options: ["default", "his"], value: node.format || "default" }];
    if (node.type === "textInput" || node.type === "textarea") return [...common,
      { key: "value", label: "value", type: node.type === "textarea" ? "multiline" : "text", value: node.value || "", bindable: true },
      { key: "placeholder", label: "placeholder", type: "text", value: node.placeholder || "" },
    ];
    if (node.type === "image") {
      return [
        ...common,
        { key: "src", label: "src", type: "text", value: node.src || "", bindable: true },
        { key: "alt", label: "alt", type: "text", value: node.alt || "", bindable: true },
      ];
    }
    if (node.type === "range") {
      return [
        ...common,
        { key: "min", label: "min", type: "number", value: node.min ?? 0, bindable: true },
        { key: "max", label: "max", type: "number", value: node.max ?? 100, bindable: true },
        { key: "step", label: "step", type: "number", value: node.step ?? 1, bindable: true },
        { key: "value", label: "value", type: "number", value: node.value ?? 0, bindable: true },
      ];
    }
    if (node.type === "checkbox") return [...common, { key: "value", label: "value", type: "checkbox", value: Boolean(node.value), bindable: true }];
    if (node.type === "progress") {
      return [...common,
        { key: "value", label: "value", type: "number", value: node.value ?? 0, bindable: true },
        { key: "max", label: "max", type: "number", value: node.max ?? 100, bindable: true },
      ];
    }
    if (node.type === "select") {
      return [...common,
        { key: "value", label: "value", type: "text", value: node.value ?? "", bindable: true },
        { key: "options", label: "options", type: "collection", value: node.options || [], bindable: true },
        { key: "placeholder", label: "placeholder", type: "text", value: node.placeholder || "" },
        { key: "optionValueField", label: "optionValueField", type: "text", value: node.optionValueField || "value" },
        { key: "optionLabelField", label: "optionLabelField", type: "text", value: node.optionLabelField || "label" },
      ];
    }
    if (node.type === "list") {
      return [...common,
        { key: "items", label: "items", type: "collection", value: node.items || [], bindable: true },
        { key: "itemType", label: "itemType", type: "select", value: node.itemType || "div", options: [{"value":"div","label":t("legacy.bdd8f1cd734c")},{"value":"button","label":t("legacy.d1bc1cb89952")}] },
        { key: "itemTemplate", label: t("windowEditor.subeditor.listTitle", "列表项目模板"), type: "subEditor", editorKind: "list-template", bindable: true },
        { key: "itemActions", label: "itemActions", type: "collection", value: node.itemActions || [] },
      ];
    }
    if (node.type === "table") {
      return [...common, { key: "rows", label: "rows", type: "collection", value: node.rows || [], bindable: true }];
    }
    if (node.type === "dialogue") return [...common, { key: "displayTo", label: "displayTo", type: "text", value: node.displayTo || "dialogue" }];
    if (node.type === "embeddedWindow") return [...common, { key: "windowId", label: "windowId", type: "text", value: node.windowId || "" }];
    if (node.type === "fileManager") return [...common, { key: "path", label: "path", type: "text", value: node.path || "/home/desktop" }];
    if (node.type === "clueWall") return [...common,
      { key: "items", label: "items", type: "collection", value: node.items || [], bindable: true },
      { key: "columns", label: "columns", type: "number", value: node.columns ?? 3 },
      { key: "cellWidth", label: "cellWidth", type: "number", value: node.cellWidth ?? 180 },
      { key: "cellHeight", label: "cellHeight", type: "number", value: node.cellHeight ?? 72 },
      { key: "itemLabelField", label: "itemLabelField", type: "text", value: node.itemLabelField || "content" },
      { key: "itemClassName", label: "itemClassName", type: "text", value: node.itemClassName || "" },
    ];
    if (node.type === "recordTabs") return [...common,
      { key: "__recordTabsEditor", label: t("windowEditor.subeditor.recordTabsTitle", "数据选项卡"), type: "subEditor", editorKind: "record-tabs" },
    ];
    return [...common, { key: "value", label: "value", type: "text", value: node.value ?? "", bindable: true }];
  }
}

export default WindowEditorView;
// DEV-TOOLS:END
