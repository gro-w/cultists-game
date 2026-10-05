// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { prepareWindowValueGraph } from "./WindowValueGraph.js";
import { createWindowEditorModel } from "./WindowEditorModel.js";
import { renderWindowRoot } from "../core/WidgetLayoutRenderer.js";
import { isBoundValue } from "../core/PropertyBinding.js";
import { writeDataFile, downloadTextFile } from "./devApi.js";

const WIDGET_TYPES = [
  "container", "tabs", "label", "button", "textInput", "textarea",
  "select", "checkbox", "image", "list", "table", "progress", "spacer",
];

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
  constructor({ definition, dataFileName, onSaveToMemory, variableStore, pvGateway, dbGateway, runtimeGateway, openEventBlueprintEditor, openValueBlueprintEditor } = {}) {
    this.model = createWindowEditorModel({ definition });
    this.dataFileName = dataFileName || null;
    this.onSaveToMemory = onSaveToMemory || (() => {});
    this.variableStore = variableStore || null;
    this.pvGateway = pvGateway || null;
    this.dbGateway = dbGateway || null;
    this.runtimeGateway = runtimeGateway || null;
    this.openEventBlueprintEditor = openEventBlueprintEditor || null;
    this.openValueBlueprintEditor = openValueBlueprintEditor || null;
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
      case "add": this.model.addWidget(this.typeSelectEl.value, selectedId || "root"); break;
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
      await writeDataFile(this.dataFileName, JSON.stringify(this.model.toDefinition(), null, 2));
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
      if (node.type === "container" || node.type === "tabs") {
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
      if (node.type === "container" || node.type === "tabs") {
        for (const child of node.children || []) renderNode(child, depth + 1);
      }
    };
    renderNode(this.model.definition.root, 0);
  }

  _renderPreview() {
    this.previewEl.innerHTML = "";
    // Same renderer + same ctx shape the runtime WindowFrame uses (plan
    // §7.1), so a bound property previews exactly as it will run.
    const { el, widgetEls } = renderWindowRoot(this.model.definition.root, {
      variableStore: this.variableStore,
      pvGateway: this.pvGateway,
      dbGateway: this.dbGateway,
      runtimeGateway: this.runtimeGateway,
      valueGraph: this.model.definition.valueGraph,
    });
    el.addEventListener("click", (e) => {
      const target = e.target.closest("[data-widget-id]");
      if (!target) return;
      e.stopPropagation();
      this.model.select(target.dataset.widgetId);
      this.render();
    });
    this._bindPreviewDrag(el, widgetEls);
    this.previewEl.appendChild(el);
  }

  /**
   * Drag-to-reposition directly on the rendered preview canvas (plan §7.3
   * "组件可选中、移动..." plus the follow-up "组件可以拖动放置到任何位置，
   * 就像蓝图节点一样，拖到哪里就是哪里" / "而不是只能拖动排序"). Dropping a
   * widget onto any container always free-positions it at the exact drop
   * point, auto-converting that container's `flow` to `"stack"` first if
   * it wasn't already (a container keeps its declared `vertical`/
   * `horizontal`/`grid` flex/grid layout until a developer actually drags
   * something into/within it in the editor, at which point it becomes an
   * explicit free-position canvas - this never happens on its own at
   * runtime, only as a result of an editor drag gesture).
   */
  _bindPreviewDrag(rootEl, widgetEls) {
    const rootWidgetId = this.model.definition.root.widgetId;
    let dragOffset = { dx: 0, dy: 0 };

    const dropFreePosition = (containerNode, event) => {
      const draggedId = event.dataTransfer.getData("text/widget-id");
      if (!draggedId) return;
      const draggedEntry = this.model.findWidget(draggedId);
      if (!draggedEntry || draggedId === containerNode.widgetId) return;
      if (containerNode.flow !== "stack") {
        this.model.updateWidgetProps(containerNode.widgetId, { flow: "stack" });
      }
      if (draggedEntry.parent !== containerNode) {
        this.model.moveWidget(draggedId, containerNode.widgetId, null);
      }
      const containerEl = widgetEls.get(containerNode.widgetId);
      const rect = containerEl.getBoundingClientRect();
      const x = Math.max(0, Math.round(event.clientX - rect.left - dragOffset.dx));
      const y = Math.max(0, Math.round(event.clientY - rect.top - dragOffset.dy));
      this.model.updateWidgetProps(draggedId, { x, y });
      this.render();
    };

    const dropOnto = (widgetId, event) => {
      const draggedId = event.dataTransfer.getData("text/widget-id");
      if (!draggedId || draggedId === widgetId) return;
      const targetEntry = this.model.findWidget(widgetId);
      if (!targetEntry) return;
      // Dropping directly onto a container free-positions inside it;
      // dropping onto a leaf widget free-positions inside that widget's
      // own parent container instead (both always convert to flow:"stack"
      // if needed, so any component can be dragged anywhere - plan
      // follow-up "而不是只能拖动排序").
      if (targetEntry.node.type === "container" || targetEntry.node.type === "tabs") {
        dropFreePosition(targetEntry.node, event);
      } else if (targetEntry.parent) {
        dropFreePosition(targetEntry.parent, event);
      }
    };
    for (const [widgetId, el] of widgetEls) {
      if (widgetId === rootWidgetId) continue;
      el.draggable = true;
      el.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/widget-id", widgetId);
        const rect = el.getBoundingClientRect();
        dragOffset = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      });
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropOnto(widgetId, e);
      });
    }
    // Dropping on empty canvas space (the root container itself, not a
    // nested widget) always free-positions against the root - mirrors the
    // structure tree's root row drop target - converting root to
    // flow:"stack" first if needed.
    rootEl.addEventListener("dragover", (e) => e.preventDefault());
    rootEl.addEventListener("drop", (e) => {
      if (e.target !== rootEl) return; // a nested widget's own drop handler already ran (and stopped propagation)
      e.preventDefault();
      dropFreePosition(this.model.definition.root, e);
    });
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
      const row = document.createElement("label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${field.label}</span>`;
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
            : { [field.key]: field.type === "number" ? 0 : field.type === "checkbox" ? true : "" };
          this.model.updateWidgetProps(node.widgetId, patch);
          this.render();
        });
        row.appendChild(bindToggle);
      }
      const input = document.createElement(field.type === "checkbox" ? "input" : field.type === "select" ? "select" : "input");
      if (bound) {
        input.type = "text";
        input.placeholder = t("legacy.f6fff4b55164");
        input.value = rawValue.variable || (rawValue.nodeId ? `@${rawValue.nodeId}:${rawValue.port || "value"}` : "");
      } else if (field.type === "checkbox") {
        input.type = "checkbox";
        input.checked = Boolean(field.value);
      } else if (field.type === "number") {
        input.type = "number";
        input.value = field.value ?? "";
      } else if (field.type === "select") {
        for (const option of field.options) {
          const opt = document.createElement("option");
          opt.value = option;
          opt.textContent = option;
          input.appendChild(opt);
        }
        input.value = field.value ?? "";
      } else {
        input.type = "text";
        input.value = field.value ?? "";
      }
      // Text inputs only patch the model on "input" and never trigger a
      // full re-render mid-typing, so focus is never lost (plan §7.3
      // "输入框 text 事件只更新现有 inspector 值，不整体重绘导致失焦").
      input.addEventListener("input", () => {
        const value = bound
          ? this._parseBinding(input.value)
          : field.type === "checkbox" ? input.checked
          : field.type === "number" ? Number(input.value)
          : ["options", "items", "rows"].includes(field.key) ? this._parseJsonField(input.value)
          : input.value;
        this.model.updateWidgetProps(node.widgetId, { [field.key]: value });
        this._renderStructure();
        this._renderPreview();
      });
      row.appendChild(input);
      this.inspectorEl.appendChild(row);
    }
    this._renderGeometryInspector(node);
    this._renderEventsInspector(node);
  }

  _appendValueGraphButton() {
    const graphButton = document.createElement("button");
    graphButton.type = "button";
    graphButton.textContent = t("legacy.3079067d88f0");
    graphButton.title = t("legacy.039b8514593b");
    graphButton.addEventListener("click", () => this._openValueBlueprintEditor());
    this.inspectorEl.append(graphButton);
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

  _parseJsonField(text) {
    try { return JSON.parse(text); } catch { return text; }
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
  _eventNamesFor(type) {
    if (type === "button") return ["onClick"];
    if (type === "list") return ["onItemClick"];
    if (["textInput", "textarea", "select", "checkbox"].includes(type)) return ["onChange", "onFocus", "onBlur"];
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
    const eventNames = this._eventNamesFor(node.type);
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
      { key: "title", label: "title", type: "text", value: definition.title || "", bindable: true },
      { key: "mode", label: "mode", type: "select", options: ["window", "custom"], value: definition.mode || "window" },
      { key: "fullscreen", label: "fullscreen", type: "checkbox", value: Boolean(definition.fullscreen) },
    ];
    for (const field of fields) {
      const row = document.createElement("label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${field.label}</span>`;
      const rawValue = definition[field.key];
      const bound = Boolean(field.bindable && isBoundValue(rawValue));
      if (field.bindable) {
        const bindToggle = document.createElement("input");
        bindToggle.type = "checkbox";
        bindToggle.className = "ng-window-editor-field-bind-toggle";
        bindToggle.title = t("legacy.8804ed6582cc");
        bindToggle.checked = bound;
        bindToggle.addEventListener("change", () => {
          this.model.updateWindowProps({ [field.key]: bindToggle.checked ? { variable: "" } : "" });
          this.render();
        });
        row.appendChild(bindToggle);
      }
      const input = document.createElement(field.type === "select" ? "select" : "input");
      if (bound) {
        input.type = "text";
        input.placeholder = t("legacy.f6fff4b55164");
        input.value = rawValue.variable || (rawValue.nodeId ? `@${rawValue.nodeId}:${rawValue.port || "value"}` : "");
      } else if (field.type === "checkbox") {
        input.type = "checkbox";
        input.checked = Boolean(field.value);
      } else if (field.type === "select") {
        for (const option of field.options) {
          const opt = document.createElement("option");
          opt.value = option;
          opt.textContent = option;
          input.appendChild(opt);
        }
        input.value = field.value ?? "";
      } else {
        input.type = "text";
        input.value = field.value ?? "";
      }
      input.addEventListener("input", () => {
        const value = bound ? this._parseBinding(input.value) : field.type === "checkbox" ? input.checked : input.value;
        this.model.updateWindowProps({ [field.key]: value });
      });
      row.appendChild(input);
      this.inspectorEl.appendChild(row);
    }
  }

  _fieldsFor(node) {
    const common = [
      { key: "widgetId", label: "widgetId", type: "text", value: node.widgetId },
      { key: "className", label: "className", type: "text", value: node.className || "", bindable: true },
      { key: "visible", label: "visible", type: "checkbox", value: node.visible ?? true, bindable: true },
      { key: "enabled", label: "enabled", type: "checkbox", value: node.enabled ?? true, bindable: true },
    ];
    if (node.type === "container" || node.type === "tabs") {
      return [
        ...common,
        { key: "flow", label: "flow", type: "select", options: ["vertical", "horizontal", "grid", "stack"], value: node.flow || "vertical", bindable: true },
        { key: "gap", label: "gap", type: "number", value: node.gap ?? 0, bindable: true },
        { key: "padding", label: "padding", type: "number", value: node.padding ?? 0, bindable: true },
        { key: "align", label: "align", type: "text", value: node.align || "", bindable: true },
        { key: "justify", label: "justify", type: "text", value: node.justify || "", bindable: true },
      ];
    }
    if (node.type === "label" || node.type === "button") {
      return [...common, { key: "text", label: "text", type: "text", value: node.text || "", bindable: true }];
    }
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
    if (node.type === "progress") {
      return [...common,
        { key: "value", label: "value", type: "number", value: node.value ?? 0, bindable: true },
        { key: "max", label: "max", type: "number", value: node.max ?? 100, bindable: true },
      ];
    }
    if (node.type === "select") {
      return [...common,
        { key: "value", label: "value", type: "text", value: node.value ?? "", bindable: true },
        { key: "options", label: "options", type: "text", value: JSON.stringify(node.options || []), bindable: true },
      ];
    }
    if (node.type === "list") {
      return [...common,
        { key: "items", label: "items", type: "text", value: JSON.stringify(node.items || []), bindable: true },
        { key: "itemLabelField", label: "itemLabelField", type: "text", value: node.itemLabelField || "name", bindable: true },
        { key: "itemType", label: "itemType", type: "select", value: node.itemType || "div", options: [{"value":"div","label":t("legacy.bdd8f1cd734c")},{"value":"button","label":t("legacy.d1bc1cb89952")}] },
        { key: "itemDisabledField", label: "itemDisabledField", type: "text", value: node.itemDisabledField || "", bindable: true },
        { key: "itemLabelTemplate", label: "itemLabelTemplate", type: "text", value: node.itemLabelTemplate || "", bindable: true },
        { key: "itemClassField", label: "itemClassField", type: "text", value: node.itemClassField || "", bindable: true },
        { key: "itemClassName", label: "itemClassName", type: "text", value: node.itemClassName || "", bindable: true },
      ];
    }
    if (node.type === "table") {
      return [...common, { key: "rows", label: "rows", type: "text", value: JSON.stringify(node.rows || []), bindable: true }];
    }
    return [...common, { key: "value", label: "value", type: "text", value: node.value ?? "", bindable: true }];
  }
}

export default WindowEditorView;
// DEV-TOOLS:END
