// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { isBoundValue } from "../core/PropertyBinding.js";
import { renderWidgetNode } from "../core/WidgetLayoutRenderer.js";

const RECORD_TAB_KEYS = [
  "items", "tabLabelTemplate", "tabIconField", "panelItemsFields", "itemTitleFields",
  "itemMetaFields", "itemBodyFields", "itemListFields", "itemMetaSeparator", "tabsClassName",
  "panelsClassName", "tabClassName", "panelClassName", "descriptionClassName", "itemClassName",
  "itemListClassPrefix",
];
const RECORD_TAB_FIELD_LISTS = [
  "panelItemsFields", "itemTitleFields", "itemMetaFields", "itemBodyFields", "itemListFields",
];
const RECORD_TAB_TEXT_FIELDS = [
  "tabLabelTemplate", "tabIconField", "itemMetaSeparator", "tabsClassName", "panelsClassName",
  "tabClassName", "panelClassName", "descriptionClassName", "itemClassName", "itemListClassPrefix",
];
const RECORD_FIELDS = ["id", "label", "name", "icon", "description"];

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function bindingText(value) {
  if (value?.nodeId) return `@${value.nodeId}:${value.port || "value"}`;
  return value?.variable || "";
}

function parseBinding(value) {
  const text = String(value || "").trim();
  if (text.startsWith("@")) {
    const [nodeId, port = "value"] = text.slice(1).split(":");
    return { nodeId, port };
  }
  return { variable: text };
}

function nextStableId(records, prefix) {
  const ids = new Set(records.map((record) => String(record?.id || "")));
  for (let index = 1; ; index += 1) {
    const id = `${prefix}-${index}`;
    if (!ids.has(id)) return id;
  }
}

function legacyListTemplate(widget) {
  if (Array.isArray(widget.itemTemplate?.parts)) {
    const template = clone(widget.itemTemplate);
    const used = new Set();
    template.layout = ["auto", "horizontal", "vertical"].includes(template.layout) ? template.layout : "auto";
    template.parts = template.parts.map((entry, index) => {
      const part = entry && typeof entry === "object" ? entry : { template: String(entry ?? "") };
      let id = String(part.id || `part-${index + 1}`);
      while (used.has(id)) id = `${id}-${index + 1}`;
      used.add(id);
      return { ...part, id, type: ["text", "meta", "progress", "actions", "spacer"].includes(part.type) ? part.type : "text" };
    });
    return template;
  }
  const parts = [];
  if (widget.itemIconField) parts.push({ id: "icon", type: "text", template: `{{${widget.itemIconField}}}`, className: "ng-widget-list-item-icon" });
  const labelTemplate = widget.itemLabelTemplate ?? `{{${widget.itemLabelField || "name"}}}`;
  parts.push({ id: "label", type: "text", template: clone(labelTemplate), className: "ng-widget-list-item-label" });
  if (widget.itemMetaTemplate) parts.push({ id: "meta", type: "meta", template: clone(widget.itemMetaTemplate), className: "ng-widget-list-item-meta" });
  if (widget.itemProgressField) parts.push({ id: "progress", type: "progress", field: clone(widget.itemProgressField), onlyForTriggered: Boolean(widget.itemProgressOnlyForTriggered), className: "ng-widget-list-item-progress" });
  if (Array.isArray(widget.itemActions) && widget.itemActions.length) parts.push({ id: "actions", type: "actions", className: "ng-widget-list-item-actions" });
  return { layout: "auto", parts };
}

function fieldLabel(key) {
  return t(`windowEditor.subeditor.field.${key}`, key);
}

/** Schema-aware child-window editors for list item templates and tabs. */
export class WindowWidgetSubEditorView {
  constructor({ kind, widget = {}, onSave = () => {} } = {}) {
    this.kind = kind;
    this.draft = clone(widget) || {};
    this.onSave = onSave;
    this.templateDraft = this.kind === "list-template" ? legacyListTemplate(this.draft) : null;
    this.selectedTemplatePartId = this.templateDraft?.parts[0]?.id || null;
    this._buildDom();
    this._renderForm();
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-window-widget-subeditor";
    const title = document.createElement("h3");
    title.textContent = this._title();
    const help = document.createElement("p");
    help.className = "ng-window-widget-subeditor-help";
    help.textContent = this._help();
    this.formEl = document.createElement("div");
    this.formEl.className = "ng-window-widget-subeditor-form";
    const footer = document.createElement("div");
    footer.className = "ng-window-widget-subeditor-footer";
    this.statusEl = document.createElement("span");
    this.statusEl.setAttribute("aria-live", "polite");
    const save = document.createElement("button");
    save.type = "button";
    save.dataset.action = "save";
    save.textContent = t("windowEditor.subeditor.apply", "应用到窗口草稿");
    save.addEventListener("click", () => this._save());
    footer.append(save, this.statusEl);
    this.el.append(title, help, this.formEl, footer);
  }

  _title() {
    if (this.kind === "list-template") return t("windowEditor.subeditor.listTitle", "列表项目模板");
    if (this.kind === "tabs") return t("windowEditor.subeditor.tabsTitle", "选项卡");
    return t("windowEditor.subeditor.recordTabsTitle", "数据选项卡");
  }

  _help() {
    if (this.kind === "list-template") return t("windowEditor.subeditor.listHelp", "在此编辑每个列表项目的显示模板；列表记录可在窗口检查器中绑定到蓝图输出。");
    if (this.kind === "tabs") return t("windowEditor.subeditor.tabsHelp", "管理此选项卡容器的面板、标签和顺序；面板内容仍可在主窗口编辑器中选择和编辑。");
    return t("windowEditor.subeditor.recordTabsHelp", "编辑选项卡记录和字段映射。记录数组可以绑定到蓝图输出，以便由蓝图决定填充内容。");
  }

  _save() {
    let patch;
    if (this.kind === "list-template") {
      patch = { itemTemplate: clone(this.templateDraft) };
    } else if (this.kind === "tabs") {
      patch = { children: clone(this.draft.children || []) };
    } else {
      patch = Object.fromEntries(RECORD_TAB_KEYS.map((key) => [key, clone(this.draft[key] ?? (key.endsWith("Fields") ? [] : key === "items" ? [] : ""))]));
    }
    try {
      if (this.onSave(patch) === false) {
        this.statusEl.textContent = t("windowEditor.subeditor.applyFailed", "无法应用到窗口草稿");
        return false;
      }
      this.statusEl.textContent = t("windowEditor.subeditor.applied", "已应用到窗口草稿");
      return true;
    } catch (error) {
      this.statusEl.textContent = `${t("windowEditor.subeditor.applyFailed", "无法应用到窗口草稿")}: ${error.message}`;
      return false;
    }
  }

  _renderForm() {
    this.formEl.replaceChildren();
    if (this.kind === "list-template") this._renderListTemplate();
    else if (this.kind === "tabs") this._renderTabs();
    else this._renderRecordTabs();
  }

  _appendSection(titleText) {
    const section = document.createElement("section");
    section.className = "ng-window-widget-subeditor-section";
    const heading = document.createElement("h4");
    heading.textContent = titleText;
    section.appendChild(heading);
    this.formEl.appendChild(section);
    return section;
  }

  _appendField(parent, { key, type = "text", bindable = false, defaultValue = "" }, onChange = null) {
    const row = document.createElement("label");
    row.className = "ng-window-editor-field";
    const caption = document.createElement("span");
    caption.textContent = fieldLabel(key);
    row.appendChild(caption);
    const initial = this.draft[key] ?? defaultValue;
    const bound = Boolean(bindable && isBoundValue(initial));
    if (bindable) {
      const bindingToggle = document.createElement("input");
      bindingToggle.type = "checkbox";
      bindingToggle.className = "ng-window-editor-field-bind-toggle";
      bindingToggle.dataset.bindField = key;
      bindingToggle.checked = bound;
      bindingToggle.title = t("windowEditor.subeditor.bindToBlueprint", "绑定变量或蓝图输出");
      bindingToggle.setAttribute("aria-label", `${fieldLabel(key)} — ${t("windowEditor.subeditor.bindToBlueprint", "绑定变量或蓝图输出")}`);
      bindingToggle.addEventListener("change", () => {
        this.draft[key] = bindingToggle.checked ? { variable: "" } : defaultValue ?? "";
        onChange?.(this.draft[key]);
        this._renderForm();
      });
      row.appendChild(bindingToggle);
    }
    let input;
    if (type === "checkbox") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(initial);
    } else if (type === "multiline" && !bound) {
      input = document.createElement("textarea");
      input.rows = 4;
      input.value = initial == null ? "" : String(initial);
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = bound ? bindingText(initial) : initial == null ? "" : String(initial);
      if (bound) input.placeholder = t("windowEditor.subeditor.bindingPlaceholder", "@蓝图节点ID:输出端口 或 变量名");
    }
    input.dataset.editorField = key;
    const update = () => {
      this.draft[key] = bound ? parseBinding(input.value) : type === "checkbox" ? input.checked : input.value;
      onChange?.(this.draft[key]);
    };
    input.addEventListener(type === "checkbox" ? "change" : "input", update);
    row.appendChild(input);
    parent.appendChild(row);
    return input;
  }

  _renderListTemplate() {
    const section = this._appendSection(t("windowEditor.subeditor.listTemplateSection", "项目显示与模板"));
    const workspace = document.createElement("div");
    workspace.className = "ng-list-template-workspace";
    this.previewEl = document.createElement("div");
    this.previewEl.className = "ng-list-template-canvas";
    this.inspectorEl = document.createElement("div");
    this.inspectorEl.className = "ng-list-template-inspector";
    workspace.append(this.previewEl, this.inspectorEl);
    section.appendChild(workspace);
    this._renderListTemplateCanvas();
    this._renderListTemplateInspector();
  }

  _renderListTemplateCanvas() {
    this.previewEl.replaceChildren();
    const title = document.createElement("h5");
    title.textContent = t("windowEditor.subeditor.listPreview", "列表项预览（点击组件以编辑）");
    const previewTemplate = clone(this.templateDraft);
    previewTemplate.parts = previewTemplate.parts.map((part) => ({
      ...part,
      template: isBoundValue(part.template) ? "{{name}}" : part.template,
    }));
    const sampleName = t("windowEditor.subeditor.sampleName", "示例物品");
    const previewWidget = {
      ...this.draft,
      type: "list",
      items: [{
        id: "preview-item",
        name: sampleName,
        label: sampleName,
        icon: "🧪",
        quantity: 2,
        category: t("windowEditor.subeditor.sampleCategory", "示例分类"),
        useMinutes: 20,
        moneyReward: 5,
        value: 1,
        progressPercent: 45,
        unlocked: true,
      }],
      itemTemplate: previewTemplate,
    };
    this.previewEl.appendChild(title);
    this.previewEl.appendChild(renderWidgetNode(previewWidget, {
      selectedTemplatePartId: this.selectedTemplatePartId,
      onTemplatePartClick: (partId) => {
        this.selectedTemplatePartId = partId;
        this._renderListTemplateCanvas();
        this._renderListTemplateInspector();
      },
    }));
  }

  _renderListTemplateInspector() {
    this.inspectorEl.replaceChildren();
    const layoutSection = this._appendInspectorSection(t("windowEditor.subeditor.listLayout", "布局"));
    const layoutLabel = document.createElement("label");
    layoutLabel.className = "ng-window-editor-field";
    const layoutCaption = document.createElement("span");
    layoutCaption.textContent = t("windowEditor.subeditor.listLayout", "布局");
    const layout = document.createElement("select");
    layout.dataset.editorField = "item-template-layout";
    for (const value of ["auto", "horizontal", "vertical"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = t(`windowEditor.subeditor.layout.${value}`, value);
      layout.appendChild(option);
    }
    layout.value = this.templateDraft.layout || "auto";
    layout.addEventListener("change", () => {
      this.templateDraft.layout = layout.value;
      this._renderListTemplateCanvas();
    });
    layoutLabel.append(layoutCaption, layout);
    layoutSection.appendChild(layoutLabel);

    const addSection = this._appendInspectorSection(t("windowEditor.subeditor.addComponent", "添加组件"));
    for (const type of ["text", "meta", "progress", "actions", "spacer"]) {
      const add = document.createElement("button");
      add.type = "button";
      add.dataset.action = "add-template-part";
      add.dataset.partType = type;
      add.textContent = t(`windowEditor.subeditor.component.${type}`, type);
      add.addEventListener("click", () => {
        const id = nextStableId(this.templateDraft.parts, type);
        const part = { id, type, className: type === "text" ? "ng-widget-list-item-label" : type === "meta" ? "ng-widget-list-item-meta" : "" };
        if (type === "text") part.template = "{{name}}";
        if (type === "meta") part.template = "{{category}}";
        if (type === "progress") { part.field = "progressPercent"; part.className = "ng-widget-list-item-progress"; }
        if (type === "actions") part.className = "ng-widget-list-item-actions";
        this.templateDraft.parts.push(part);
        this.selectedTemplatePartId = id;
        this._renderListTemplateCanvas();
        this._renderListTemplateInspector();
      });
      addSection.appendChild(add);
    }

    const part = this.templateDraft.parts.find((entry) => entry.id === this.selectedTemplatePartId);
    if (!part) return;
    const componentKey = part.id === "icon" ? "icon" : part.type;
    const partSection = this._appendInspectorSection(`${t("windowEditor.subeditor.selectedComponent", "选中组件")}: ${t(`windowEditor.subeditor.component.${componentKey}`, componentKey)}`);
    if (part.type === "text" || part.type === "meta") {
      const bound = isBoundValue(part.template);
      const binding = document.createElement("input");
      binding.type = "checkbox";
      binding.dataset.bindField = "part-template";
      binding.checked = bound;
      binding.title = t("windowEditor.subeditor.bindToBlueprint", "绑定变量或蓝图输出");
      binding.addEventListener("change", () => {
        part.template = binding.checked ? { variable: "" } : (part.type === "meta" ? "{{category}}" : "{{name}}");
        this._renderListTemplateCanvas();
        this._renderListTemplateInspector();
      });
      partSection.appendChild(binding);
      const template = document.createElement(bound ? "input" : "textarea");
      template.dataset.editorField = "part-template";
      template.value = bound ? bindingText(part.template) : String(part.template ?? "");
      if (bound) template.placeholder = t("windowEditor.subeditor.bindingPlaceholder", "@蓝图节点ID:输出端口 或 变量名");
      template.addEventListener("input", () => {
        part.template = bound ? parseBinding(template.value) : template.value;
        this._renderListTemplateCanvas();
      });
      partSection.appendChild(template);
    }
    if (part.type === "progress") {
      this._appendBoundPartField(partSection, part, "field", "progressPercent");
    }
    this._appendInspectorField(partSection, "className", part.className || "", (value) => { part.className = value; this._renderListTemplateCanvas(); });
    const controls = document.createElement("div");
    controls.className = "ng-window-widget-subeditor-inline-row";
    const index = this.templateDraft.parts.indexOf(part);
    for (const [action, label] of [["move-up", "↑"], ["move-down", "↓"], ["remove-template-part", t("windowEditor.subeditor.removeComponent", "删除组件")]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.textContent = label;
      button.disabled = action === "move-up" ? index === 0 : action === "move-down" ? index === this.templateDraft.parts.length - 1 : false;
      button.addEventListener("click", () => {
        if (action === "remove-template-part") {
          this.templateDraft.parts.splice(index, 1);
          this.selectedTemplatePartId = this.templateDraft.parts[Math.min(index, this.templateDraft.parts.length - 1)]?.id || null;
        } else {
          const target = action === "move-up" ? index - 1 : index + 1;
          [this.templateDraft.parts[index], this.templateDraft.parts[target]] = [this.templateDraft.parts[target], this.templateDraft.parts[index]];
          this.selectedTemplatePartId = part.id;
        }
        this._renderListTemplateCanvas();
        this._renderListTemplateInspector();
      });
      controls.appendChild(button);
    }
    partSection.appendChild(controls);
  }

  _appendInspectorSection(titleText) {
    const section = document.createElement("section");
    section.className = "ng-window-widget-subeditor-section";
    const heading = document.createElement("h4");
    heading.textContent = titleText;
    section.appendChild(heading);
    this.inspectorEl.appendChild(section);
    return section;
  }

  _appendBoundPartField(parent, part, key, fallback) {
    const row = document.createElement("label");
    row.className = "ng-window-editor-field";
    const caption = document.createElement("span");
    caption.textContent = t(`windowEditor.subeditor.field.${key}`, key);
    const bound = isBoundValue(part[key]);
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.dataset.bindField = key;
    toggle.checked = bound;
    toggle.title = t("windowEditor.subeditor.bindToBlueprint", "绑定变量或蓝图输出");
    toggle.addEventListener("change", () => {
      part[key] = toggle.checked ? { variable: "" } : fallback;
      this._renderListTemplateCanvas();
      this._renderListTemplateInspector();
    });
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.editorField = key;
    input.value = bound ? bindingText(part[key]) : part[key] || fallback;
    if (bound) input.placeholder = t("windowEditor.subeditor.bindingPlaceholder", "@蓝图节点ID:输出端口 或 变量名");
    input.addEventListener("input", () => {
      part[key] = bound ? parseBinding(input.value) : input.value;
      this._renderListTemplateCanvas();
    });
    row.append(caption, toggle, input);
    parent.appendChild(row);
  }

  _appendInspectorField(parent, key, value, onChange) {
    const row = document.createElement("label");
    row.className = "ng-window-editor-field";
    const caption = document.createElement("span");
    caption.textContent = t(`windowEditor.subeditor.field.${key}`, key);
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.editorField = key;
    input.value = value;
    input.addEventListener("input", () => onChange(input.value));
    row.append(caption, input);
    parent.appendChild(row);
    return input;
  }

  _renderTabs() {
    const section = this._appendSection(t("windowEditor.subeditor.tabsSection", "选项卡面板"));
    this.draft.children = Array.isArray(this.draft.children) ? this.draft.children : [];
    this.draft.children.forEach((tab, index) => {
      const card = document.createElement("article");
      card.className = "ng-window-widget-subeditor-card";
      const label = document.createElement("label");
      label.className = "ng-window-editor-field";
      const caption = document.createElement("span");
      caption.textContent = `${t("windowEditor.subeditor.tabLabel", "标签")} ${index + 1}`;
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.tabLabelIndex = String(index);
      input.value = tab.tabLabel || "";
      input.addEventListener("input", () => { tab.tabLabel = input.value; });
      label.append(caption, input);
      const id = document.createElement("small");
      id.textContent = `${t("windowEditor.subeditor.panelId", "面板 ID")}: ${tab.widgetId || ""}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.action = "remove-tab";
      remove.dataset.index = String(index);
      remove.textContent = t("windowEditor.subeditor.removeTab", "删除选项卡");
      remove.addEventListener("click", () => {
        this.draft.children.splice(index, 1);
        this._renderForm();
      });
      card.append(label, id, remove);
      section.appendChild(card);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.dataset.action = "add-tab";
    add.textContent = t("windowEditor.subeditor.addTab", "添加选项卡");
    add.addEventListener("click", () => {
      const used = new Set();
      const collect = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.widgetId) used.add(node.widgetId);
        (node.children || []).forEach(collect);
      };
      collect(this.draft);
      let sequence = 1;
      while (used.has(`tab-${sequence}`)) sequence += 1;
      const index = this.draft.children.length + 1;
      this.draft.children.push({
        widgetId: `tab-${sequence}`,
        type: "container",
        className: "tab-panel",
        flow: "vertical",
        gap: 4,
        padding: 4,
        tabLabel: `${t("windowEditor.subeditor.tabLabel", "标签")} ${index}`,
        children: [],
      });
      this._renderForm();
    });
    section.appendChild(add);
  }

  _renderRecordTabs() {
    const itemsSection = this._appendSection(t("windowEditor.subeditor.recordTabsSection", "选项卡记录"));
    const items = this.draft.items;
    const bindingRow = document.createElement("label");
    bindingRow.className = "ng-window-editor-field";
    const bindingLabel = document.createElement("span");
    bindingLabel.textContent = t("windowEditor.subeditor.itemsSource", "选项卡数据来源");
    const bindingToggle = document.createElement("input");
    bindingToggle.type = "checkbox";
    bindingToggle.checked = isBoundValue(items);
    bindingToggle.dataset.editorField = "items-binding";
    bindingToggle.title = t("windowEditor.subeditor.bindToBlueprint", "绑定变量或蓝图输出");
    bindingToggle.addEventListener("change", () => {
      this.draft.items = bindingToggle.checked ? { variable: "" } : [];
      this._renderForm();
    });
    bindingRow.append(bindingLabel, bindingToggle);
    itemsSection.appendChild(bindingRow);
    if (isBoundValue(items)) {
      const bindingInput = document.createElement("input");
      bindingInput.type = "text";
      bindingInput.dataset.editorField = "items";
      bindingInput.value = bindingText(items);
      bindingInput.placeholder = t("windowEditor.subeditor.bindingPlaceholder", "@蓝图节点ID:输出端口 或 变量名");
      bindingInput.addEventListener("input", () => { this.draft.items = parseBinding(bindingInput.value); });
      itemsSection.appendChild(bindingInput);
    } else {
      this.draft.items = Array.isArray(items) ? items : [];
      this.draft.items.forEach((record, index) => {
        const card = document.createElement("article");
        card.className = "ng-window-widget-subeditor-card";
        const item = record && typeof record === "object" ? record : { label: String(record ?? "") };
        this.draft.items[index] = item;
        for (const key of RECORD_FIELDS) {
          const input = document.createElement("input");
          input.type = "text";
          input.dataset.recordField = key;
          input.dataset.index = String(index);
          input.value = item[key] == null ? "" : String(item[key]);
          input.setAttribute("aria-label", `${t("windowEditor.subeditor.tabLabel", "标签")} ${index + 1}: ${fieldLabel(key)}`);
          input.addEventListener("input", () => { item[key] = input.value; });
          const row = document.createElement("label");
          row.className = "ng-window-editor-field";
          const caption = document.createElement("span");
          caption.textContent = fieldLabel(key);
          row.append(caption, input);
          card.appendChild(row);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "remove-record-tab";
        remove.dataset.index = String(index);
        remove.textContent = t("windowEditor.subeditor.removeTab", "删除选项卡");
        remove.addEventListener("click", () => {
          this.draft.items.splice(index, 1);
          this._renderForm();
        });
        card.appendChild(remove);
        itemsSection.appendChild(card);
      });
      const add = document.createElement("button");
      add.type = "button";
      add.dataset.action = "add-record-tab";
      add.textContent = t("windowEditor.subeditor.addTab", "添加选项卡");
      add.addEventListener("click", () => {
        this.draft.items.push({ id: nextStableId(this.draft.items, "tab"), label: `${t("windowEditor.subeditor.tabLabel", "标签")} ${this.draft.items.length + 1}` });
        this._renderForm();
      });
      itemsSection.appendChild(add);
    }

    const displaySection = this._appendSection(t("windowEditor.subeditor.tabDisplaySection", "标签显示和样式"));
    for (const key of RECORD_TAB_TEXT_FIELDS) this._appendField(displaySection, { key, type: "text" });
    const mappings = this._appendSection(t("windowEditor.subeditor.fieldMappingsSection", "内容字段映射"));
    for (const key of RECORD_TAB_FIELD_LISTS) {
      const group = document.createElement("div");
      group.className = "ng-window-widget-subeditor-field-list";
      const heading = document.createElement("h5");
      heading.textContent = fieldLabel(key);
      group.appendChild(heading);
      this.draft[key] = Array.isArray(this.draft[key]) ? this.draft[key] : [];
      this.draft[key].forEach((value, index) => {
        const row = document.createElement("div");
        row.className = "ng-window-widget-subeditor-inline-row";
        const input = document.createElement("input");
        input.type = "text";
        input.dataset.mappingField = key;
        input.dataset.index = String(index);
        input.value = String(value ?? "");
        input.addEventListener("input", () => { this.draft[key][index] = input.value; });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "remove-mapping";
        remove.textContent = "−";
        remove.addEventListener("click", () => {
          this.draft[key].splice(index, 1);
          this._renderForm();
        });
        row.append(input, remove);
        group.appendChild(row);
      });
      const add = document.createElement("button");
      add.type = "button";
      add.dataset.action = "add-mapping";
      add.dataset.mappingField = key;
      add.textContent = t("windowEditor.subeditor.addField", "添加字段");
      add.addEventListener("click", () => {
        this.draft[key].push("");
        this._renderForm();
      });
      group.appendChild(add);
      mappings.appendChild(group);
    }
  }
}

export default WindowWidgetSubEditorView;
// DEV-TOOLS:END
