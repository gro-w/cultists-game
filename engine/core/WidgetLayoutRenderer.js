import { t } from "./i18n/index.js";
/**
 * WidgetLayoutRenderer - the single DOM renderer for a window's widget
 * tree, shared verbatim between the runtime WindowFrame and the WYSIWYG
 * editor canvas (plan §7.1 "运行时和编辑器必须消费同一个 layout contract.
 * 不能让编辑器用绝对定位预览、运行时再包成 flex/grid，导致 WYSIWYG 虚假一致").
 *
 * Every widget node renders to exactly one element carrying
 * `data-widget-id` and `data-widget-type`, so both the editor (selection,
 * drag, inspector) and the runtime (event binding) can locate widgets by id
 * without maintaining a second parallel tree.
 */

import { resolvePropertyValue } from "./PropertyBinding.js";
import { evaluateCondition } from "./ConditionEvaluator.js";
import { resolveAssetPath } from "./AssetPath.js";

const CONTAINER_FLOWS = new Set(["vertical", "horizontal", "grid", "stack"]);

/** Reads a possibly-bound widget property (plan §7.5-equivalent value binding); falls back to the literal when unbound. */
function prop(node, key, ctx, fallback) {
  return resolvePropertyValue(node[key], {
    valueGraph: ctx.valueGraph,
    variableStore: ctx.variableStore,
    pvGateway: ctx.pvGateway,
    dbGateway: ctx.dbGateway,
    runtimeGateway: ctx.runtimeGateway,
  }, fallback);
}

function setHighlightedText(element, text, terms = []) {
  const source = String(text ?? "");
  const needles = [...new Set(terms.map((term) => String(term ?? "").trim()).filter(Boolean))];
  if (!needles.length) {
    element.textContent = source;
    return;
  }
  const escaped = needles.map((term) => term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const fragment = document.createDocumentFragment();
  source.split(pattern).forEach((part) => {
    if (needles.some((needle) => part.toLocaleLowerCase() === needle.toLocaleLowerCase())) {
      const mark = document.createElement("mark");
      mark.className = "ng-widget-highlight";
      mark.textContent = part;
      fragment.appendChild(mark);
    } else {
      fragment.appendChild(document.createTextNode(part));
    }
  });
  element.appendChild(fragment);
}

function interpolateItemTemplate(template, item) {
  return String(template ?? "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => item?.[key] ?? "");
}

function markTemplatePart(element, part, ctx) {
  element.dataset.templatePart = part.id;
  if (ctx.selectedTemplatePartId === part.id) element.classList.add("ng-list-template-part-selected");
  if (!ctx.onTemplatePartClick) return;
  element.tabIndex = 0;
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    ctx.onTemplatePartClick(part.id, event);
  });
}

function renderListTemplatePart(li, part, node, item, ctx, secret, highlightTerms, itemEventValueField) {
  if (!part || typeof part !== "object") return;
  if (part.type === "spacer") {
    const spacer = document.createElement("span");
    spacer.className = part.className || "ng-widget-list-item-spacer";
    spacer.style.flex = "1 1 auto";
    spacer.setAttribute("aria-hidden", "true");
    markTemplatePart(spacer, part, ctx);
    li.appendChild(spacer);
    return;
  }
  if (part.type === "actions") {
    const actions = document.createElement("span");
    actions.className = part.className || "ng-widget-list-item-actions";
    markTemplatePart(actions, part, ctx);
    if (item && typeof item === "object" && item.id !== undefined) {
      for (const action of node.itemActions || []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = action.className || "win95-btn bevel-out ng-list-item-action";
        button.textContent = action.label || action.id || t("legacy.f3ea6d345e2a");
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const eventValue = itemEventValueField && item[itemEventValueField] !== undefined ? item[itemEventValueField] : item.id;
          ctx.onEvent?.(node, action.eventName || action.id, eventValue);
        });
        actions.appendChild(button);
      }
    }
    li.appendChild(actions);
    return;
  }
  if (part.type === "progress") {
    if (!item || typeof item !== "object" || (part.onlyForTriggered && !item.trigger?.progress)) return;
    const field = prop({ value: part.field }, "value", ctx, "");
    const progress = document.createElement("span");
    progress.className = part.className || "ng-widget-list-item-progress";
    markTemplatePart(progress, part, ctx);
    const fill = document.createElement("span");
    fill.className = "ng-widget-list-item-progress-fill";
    fill.style.width = `${Math.max(0, Math.min(100, Number(item[field]) || 0))}%`;
    progress.appendChild(fill);
    li.appendChild(progress);
    return;
  }
  if (part.type !== "text" && part.type !== "meta") return;
  const text = document.createElement("span");
  text.className = part.className || (part.type === "meta" ? "ng-widget-list-item-meta" : "ng-widget-list-item-label");
  markTemplatePart(text, part, ctx);
  const template = prop({ value: part.template }, "value", ctx, "");
  const value = secret
    ? part.type === "meta" ? (node.itemSecretMeta || t("legacy.e7688c715821")) : part.id === "icon" ? interpolateItemTemplate(template, item) : (node.itemSecretLabel || "？？？？")
    : interpolateItemTemplate(template, item);
  setHighlightedText(text, value, highlightTerms);
  li.appendChild(text);
}

function renderKeywordMarkup(element, text, ctx) {
  const source = String(text ?? "");
  const marker = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let cursor = 0;
  let match;
  while ((match = marker.exec(source))) {
    if (match.index > cursor) element.appendChild(document.createTextNode(source.slice(cursor, match.index)));
    const id = String(match[1]);
    const keyword = document.createElement("button");
    keyword.type = "button";
    keyword.className = "keyword-highlight";
    keyword.dataset.keywordId = id;
    keyword.title = id;
    keyword.textContent = match[2] || ctx.keywordResolver?.(id) || id;
    keyword.addEventListener("click", () => {
      ctx.onKeywordCollect?.(id);
      keyword.classList.add("keyword-highlight-collected");
    });
    element.appendChild(keyword);
    cursor = match.index + match[0].length;
  }
  if (cursor === 0) {
    element.textContent = source;
    return;
  }
  if (cursor < source.length) element.appendChild(document.createTextNode(source.slice(cursor)));
}

function applyContainerStyle(el, node, ctx) {
  const flowValue = prop(node, "flow", ctx, "vertical");
  const flow = CONTAINER_FLOWS.has(flowValue) ? flowValue : "vertical";
  el.dataset.flow = flow;
  if (flow === "grid") {
    el.style.display = "grid";
  } else if (flow === "stack") {
    // "stack" is the one flow whose children have real, editable x/y
    // geometry (plan §7.3 "拖动窗口/组件到哪里就保存到哪里" for free
    // placement, as opposed to vertical/horizontal/grid where "对 flex/
    // grid 容器明确显示哪些 x/y 属性不生效"): children are positioned
    // absolutely within this container, exactly like a blueprint node on
    // its canvas.
    el.style.position = "relative";
  } else {
    el.style.display = "flex";
    el.style.flexDirection = flow === "horizontal" ? "row" : "column";
  }
  if (prop(node, "wrap", ctx, false)) el.style.flexWrap = "wrap";
  const gap = Number(prop(node, "gap", ctx, NaN));
  const padding = Number(prop(node, "padding", ctx, NaN));
  if (Number.isFinite(gap)) el.style.gap = `${gap}px`;
  if (Number.isFinite(padding)) el.style.padding = `${padding}px`;
  const align = prop(node, "align", ctx, "");
  const justify = prop(node, "justify", ctx, "");
  if (align) el.style.alignItems = align;
  if (justify) el.style.justifyContent = justify;
  const minSize = prop(node, "minSize", ctx, null);
  const maxSize = prop(node, "maxSize", ctx, null);
  if (minSize) {
    if (minSize.width != null) el.style.minWidth = `${minSize.width}px`;
    if (minSize.height != null) el.style.minHeight = `${minSize.height}px`;
  }
  if (maxSize) {
    if (maxSize.width != null) el.style.maxWidth = `${maxSize.width}px`;
    if (maxSize.height != null) el.style.maxHeight = `${maxSize.height}px`;
  }
}

/** In a "stack" container, position a child absolutely at its own x/y (each may be a plain literal or blueprint-bound value, per plan §7.5-equivalent binding; defaults to 0,0); a no-op for every other flow. */
function applyStackPosition(childEl, childNode, parentNode, ctx) {
  if (!parentNode || !["container", "tabs", "fieldset", "details"].includes(parentNode.type) || prop(parentNode, "flow", ctx, "vertical") !== "stack") return;
  childEl.style.position = "absolute";
  const x = Number(prop(childNode, "x", ctx, 0));
  const y = Number(prop(childNode, "y", ctx, 0));
  childEl.style.left = `${Number.isFinite(x) ? x : 0}px`;
  childEl.style.top = `${Number.isFinite(y) ? y : 0}px`;
}

/** Resolves the "enabled" property (literal or blueprint-bound) and, for controls with a real DOM `disabled` flag, applies it there too - not just as a decorative aria-disabled on the wrapper. */
function applyEnabled(el, node, ctx, controlEl) {
  // An explicitly bound null/undefined/empty value means the control is not
  // actionable. The old `!== false` check treated null as enabled, which
  // made buttons backed by an optional selection clickable before selection.
  const enabled = Boolean(prop(node, "enabled", ctx, true));
  if (!enabled) el.setAttribute("aria-disabled", "true");
  else el.removeAttribute("aria-disabled");
  const target = controlEl || el;
  if ("disabled" in target) target.disabled = !enabled;
}

function findRunActivityId(events) {
  if (!events || typeof events !== "object") return null;
  const pending = [events];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (value.type === "runActivity") return value.inputs?.activityId || null;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return null;
}

function applyCommonAttrs(el, node, ctx) {
  el.dataset.widgetId = node.widgetId || node.id || "";
  el.dataset.widgetType = node.type;
  const className = prop(node, "className", ctx, "");
  if (className) el.className = `ng-widget ${className}`;
  else el.className = "ng-widget";
  el.classList.add(`ng-widget-${node.type}`);
  for (const key of ["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"]) {
    const size = prop(node, key, ctx, null);
    const numericSize = Number(size);
    if (size != null && size !== "" && Number.isFinite(numericSize) && numericSize >= 0) el.style[key] = `${numericSize}px`;
  }
  if (evaluateCondition(node.activeWhen, ctx.conditionContext || {})) el.classList.add("active");
  // An event blueprint may contain a bound activity id (for example HIS
  // reads the selected patient's dialogueActivityId). That id is an action
  // target, not an implicit visibility condition: the definition store may
  // still be loading when the window renders. Visibility must be explicit in
  // the layout contract, otherwise valid runActivity buttons disappear.
  const emptyItems = node.emptyFor ? prop(node, "emptyFor", ctx, []) : null;
  const visible = (emptyItems === null || (Array.isArray(emptyItems) && emptyItems.length === 0))
    && prop(node, "visible", ctx, true) !== false
    && evaluateCondition(node.visibleWhen, ctx.conditionContext || {});
  if (!visible) {
    el.hidden = true;
    // Container widgets set an inline display value (flex/grid) before this
    // common-attribute pass. That author rule overrides the browser's UA
    // `[hidden] { display: none }`, causing tab panels to stack visibly.
    el.style.setProperty("display", "none", "important");
  } else {
    el.hidden = false;
  }
  applyEnabled(el, node, ctx, ctx.controlEls?.get(node.widgetId || node.id));
}

function bindFocusBlur(el, node, ctx) {
  if (!ctx.onEvent) return;
  el.addEventListener("focus", () => ctx.onEvent(node, "onFocus"));
  el.addEventListener("blur", () => ctx.onEvent(node, "onBlur"));
}

function renderLeaf(node, ctx) {
  const el = document.createElement(node.type === "button" ? "button" : "div");
  switch (node.type) {
    case "label":
      if (node.keywordMarkup) renderKeywordMarkup(el, prop(node, "text", ctx, ""), ctx);
      else el.textContent = prop(node, "text", ctx, "");
      break;
    case "clock": {
      const snapshot = ctx.gameClock?.snapshot?.() || { day: 1, minutes: 0 };
      const hh = String(Math.floor(snapshot.minutes / 60)).padStart(2, "0");
      const mm = String(snapshot.minutes % 60).padStart(2, "0");
      el.textContent = node.format === "his"
        ? `${t("legacy.dae828fe4fb7")}${snapshot.day}${t("legacy.42d8a93c482e")}${snapshot.minutes >= 360 && snapshot.minutes < 1080 ? t("legacy.9dd6c2d4dee4") : t("legacy.640265ca584f")} · ${hh}:${mm}`
        : `Day ${snapshot.day} ${hh}:${mm}`;
      break;
    }
    case "button":
      el.type = "button";
      el.textContent = prop(node, "text", ctx, "");
      if (ctx.onEvent) el.addEventListener("click", () => ctx.onEvent(node, "onClick"));
      break;
    case "textInput": {
      const input = document.createElement("input");
      input.type = "text";
      input.value = prop(node, "value", ctx, "");
      input.placeholder = prop(node, "placeholder", ctx, "") || "";
      if (ctx.onEvent) input.addEventListener("input", () => ctx.onEvent(node, "onChange", input.value));
      bindFocusBlur(input, node, ctx);
      el.appendChild(input);
      ctx.controlEls?.set(node.widgetId || node.id, input);
      break;
    }
    case "textarea": {
      const textarea = document.createElement("textarea");
      textarea.value = prop(node, "value", ctx, "");
      textarea.placeholder = prop(node, "placeholder", ctx, "") || "";
      if (ctx.onEvent) textarea.addEventListener("input", () => ctx.onEvent(node, "onChange", textarea.value));
      bindFocusBlur(textarea, node, ctx);
      el.appendChild(textarea);
      ctx.controlEls?.set(node.widgetId || node.id, textarea);
      break;
    }
    case "select": {
      const select = document.createElement("select");
      // `options` may be a literal `[{value,label}]` array or a bound
      // value (plan-consistent with every other property) pulling a
      // `findRecords`-populated variableStore array of raw database
      // records - e.g. `{ "variable": "diagnosisOptions" }` set by the
      // window's `onCreate` blueprint. Records rarely have literal
      // `value`/`label` fields, so `optionValueField`/`optionLabelField`
      // (default `"id"`/`"name"`) name which record fields to read
      // instead - no mapping/loop node needed in the blueprint system.
      const valueField = prop(node, "optionValueField", ctx, "value") || "value";
      const labelField = prop(node, "optionLabelField", ctx, "label") || "label";
      const placeholderText = prop(node, "placeholder", ctx, "");
      if (placeholderText) {
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = placeholderText;
        select.appendChild(placeholder);
      }
      for (const option of prop(node, "options", ctx, []) || []) {
        const opt = document.createElement("option");
        opt.value = option.value ?? option[valueField] ?? option.id ?? "";
        opt.textContent = option.label ?? option[labelField] ?? option.name ?? opt.value;
        select.appendChild(opt);
      }
      select.value = prop(node, "value", ctx, "");
      if (ctx.onEvent) select.addEventListener("change", () => ctx.onEvent(node, "onChange", select.value));
      bindFocusBlur(select, node, ctx);
      el.appendChild(select);
      ctx.controlEls?.set(node.widgetId || node.id, select);
      break;
    }
    case "checkbox": {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(prop(node, "value", ctx, false));
      if (ctx.onEvent) checkbox.addEventListener("change", () => ctx.onEvent(node, "onChange", checkbox.checked));
      el.appendChild(checkbox);
      ctx.controlEls?.set(node.widgetId || node.id, checkbox);
      break;
    }
    case "range": {
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(prop(node, "min", ctx, 0));
      range.max = String(prop(node, "max", ctx, 100));
      range.step = String(prop(node, "step", ctx, 1));
      range.value = String(prop(node, "value", ctx, prop(node, "min", ctx, 0)));
      if (ctx.onEvent) range.addEventListener("input", () => ctx.onEvent(node, "onChange", range.value));
      bindFocusBlur(range, node, ctx);
      el.appendChild(range);
      ctx.controlEls?.set(node.widgetId || node.id, range);
      break;
    }
    case "image": {
      const img = document.createElement("img");
      img.src = resolveAssetPath(prop(node, "src", ctx, "") || "");
      img.alt = prop(node, "alt", ctx, "") || "";
      el.appendChild(img);
      break;
    }
    case "dialogue": {
      const displayTo = prop(node, "displayTo", ctx, "dialogue");
      const view = ctx.dialogueViews?.[displayTo];
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] render dialogue widget", { widgetId: node.widgetId, displayTo, foundView: Boolean(view), connected: Boolean(view?.el?.isConnected) });
      /* DEV-TOOLS:END */
      if (view?.el) el.appendChild(view.el);
      break;
    }
    case "embeddedWindow": {
      const definition = ctx.windowDefinitionStore?.get?.(node.windowId);
      if (definition?.root) {
        const embeddedCtx = {
          ...ctx,
          valueGraph: definition.valueGraph,
          onEvent: (child, eventName, value) => ctx.onEvent?.({ ...child, widgetId: `${node.widgetId}:${child.widgetId}` }, eventName, value),
        };
        el.appendChild(renderWindowRoot(definition.root, embeddedCtx).el);
      }
      break;
    }
    case "saveLoad": {
      const saveManager = ctx.saveManager;
      const status = document.createElement("p");
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = t("legacy.4a88d2ab0b37");
      save.addEventListener("click", () => {
        try {
          const envelope = saveManager.snapshot();
          const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = `cultists-ng-save-day${envelope.state.gameClock.day}.json`;
          link.hidden = true;
          document.body.appendChild(link);
          link.click();
          status.textContent = t("legacy.bba041846129");
          // Keep the anchor and Blob alive through the browser's download
          // dispatch. Immediate revocation can drop the download silently.
          window.setTimeout(() => {
            link.remove();
            URL.revokeObjectURL(url);
          }, 1000);
        } catch (error) { status.textContent = `${t("legacy.b12163000cd3")}${error.message}`; }
      });
      const load = document.createElement("input");
      load.type = "file";
      load.accept = "application/json";
      load.addEventListener("change", () => {
        const file = load.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try { saveManager.restore(JSON.parse(String(reader.result))); status.textContent = t("legacy.80193fbd3be6"); }
          catch (error) { status.textContent = `${t("legacy.e6d921116cbe")}${error.message}`; }
          load.value = "";
        };
        reader.readAsText(file);
      });
      el.append(save, load, status);
      break;
    }
    case "clueWall": {
      const items = prop(node, "items", ctx, []) || [];
      const board = document.createElement("div");
      board.className = node.className || "ng-clue-wall";
      const width = Number(prop(node, "width", ctx, 620) || 620);
      const columns = Number(node.columns || 3);
      const cellWidth = Number(node.cellWidth || 180);
      const cellHeight = Number(node.cellHeight || 72);
      const height = Math.max(cellHeight, Math.ceil(items.length / columns) * cellHeight);
      board.style.setProperty("--clue-wall-width", `${width}px`);
      board.style.setProperty("--clue-wall-height", `${height}px`);
      const positions = new Map(items.map((item, index) => [String(item.id), { x: 12 + (index % columns) * cellWidth, y: 8 + Math.floor(index / columns) * cellHeight }]));
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.classList.add("ng-clue-wall-lines");
      for (const item of items) {
        for (const relatedId of item?.relatedIds || []) {
          const from = positions.get(String(item.id));
          const to = positions.get(String(relatedId));
          if (!from || !to) continue;
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", String(from.x + 70));
          line.setAttribute("y1", String(from.y + 18));
          line.setAttribute("x2", String(to.x + 70));
          line.setAttribute("y2", String(to.y + 18));
          svg.appendChild(line);
        }
      }
      board.appendChild(svg);
      for (const item of items) {
        const nodeEl = document.createElement("div");
        const pos = positions.get(String(item.id));
        nodeEl.className = node.itemClassName || "ng-clue-wall-node";
        nodeEl.style.left = `${pos.x}px`;
        nodeEl.style.top = `${pos.y}px`;
        nodeEl.textContent = item[node.itemLabelField || "content"] || item.label || item.id || "";
        board.appendChild(nodeEl);
      }
      el.appendChild(board);
      break;
    }
    case "recordTabs": {
      const records = prop(node, "items", ctx, []) || [];
      const tabs = document.createElement("div");
      tabs.className = node.tabsClassName || "ng-record-tabs";
      const panels = document.createElement("div");
      panels.className = node.panelsClassName || "ng-record-tab-panels";
      const show = (index) => {
        [...tabs.children].forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === index));
        [...panels.children].forEach((panel, panelIndex) => { panel.hidden = panelIndex !== index; });
      };
      records.forEach((record, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = node.tabClassName || "win95-btn bevel-out";
        const label = node.tabLabelTemplate
          ? node.tabLabelTemplate.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => record?.[key] ?? "")
          : record?.label ?? record?.name ?? record?.id ?? "";
        button.textContent = node.tabIconField && record?.[node.tabIconField] ? `${record[node.tabIconField]} ${label}` : label;
        button.addEventListener("click", () => show(index));
        tabs.appendChild(button);
        const panel = document.createElement("section");
        panel.className = node.panelClassName || "ng-record-tab-panel";
        panel.hidden = index !== 0;
        if (record?.description) {
          const description = document.createElement("div");
          description.className = node.descriptionClassName || "ng-record-tab-description";
          description.textContent = record.description;
          panel.appendChild(description);
        }
        const itemFields = node.panelItemsFields || [];
        for (const field of itemFields) {
          for (const item of record?.[field] || []) {
            const card = document.createElement("article");
            card.className = node.itemClassName || "ng-record-tab-card panel-inset";
            const title = (node.itemTitleFields || []).map((field) => item?.[field]).find((value) => value != null && value !== "") || "";
            if (title) { const heading = document.createElement("strong"); heading.textContent = title; card.appendChild(heading); }
            const meta = (node.itemMetaFields || []).map((field) => item?.[field]).filter((value) => value != null && value !== "").join(node.itemMetaSeparator || "  ·  ");
            if (meta) { const metaEl = document.createElement("small"); metaEl.textContent = meta; card.appendChild(metaEl); }
            const body = (node.itemBodyFields || []).map((field) => item?.[field]).find((value) => value != null && value !== "");
            if (body != null) { const bodyEl = document.createElement("p"); bodyEl.textContent = body; card.appendChild(bodyEl); }
            for (const listField of node.itemListFields || []) {
              if (!Array.isArray(item?.[listField])) continue;
              const list = document.createElement("div");
              list.className = `${node.itemListClassPrefix || "ng-record-tab-list"}-${listField}`;
              item[listField].forEach((value) => { const line = document.createElement("p"); line.textContent = typeof value === "string" ? value : (value?.label ?? value?.text ?? value?.value ?? ""); list.appendChild(line); });
              card.appendChild(list);
            }
            panel.appendChild(card);
          }
        }
        panels.appendChild(panel);
      });
      el.append(tabs, panels);
      break;
    }
    case "list": {
      // `items` may likewise be a bound array of raw database records
      // (e.g. a `findRecords` result written to variableStore by the
      // window's onCreate blueprint), so a list can render real rows with
      // no window-specific engine code. `itemLabelField` (default `"name"`)
      // names which record field to display when an item isn't already a
      // plain string or `{label}` literal. Clicking an item with an `id`
      // forwards `onItemClick` with that id as the widget event's
      // `event:value` (same convention every other widget event already
      // uses), so a blueprint can read which row was clicked without any
      // new node type.
      const itemLabelField = prop(node, "itemLabelField", ctx, "name") || "name";
      const itemLabelTemplate = prop(node, "itemLabelTemplate", ctx, "") || null;
      const itemMetaTemplate = prop(node, "itemMetaTemplate", ctx, "") || null;
      const itemProgressField = prop(node, "itemProgressField", ctx, "") || null;
      const itemClassField = prop(node, "itemClassField", ctx, "") || null;
      const itemDisabledField = prop(node, "itemDisabledField", ctx, "") || null;
      const itemClassName = prop(node, "itemClassName", ctx, "") || "";
      const itemEventValueField = prop(node, "itemEventValueField", ctx, "") || "";
      const itemSecretField = node.itemSecretField || null;
      const itemSecretUnlockedField = node.itemSecretUnlockedField || "unlocked";
      const itemIconField = node.itemIconField || null;
      const itemGroupField = node.itemGroupField || null;
      const itemProgressOnlyForTriggered = Boolean(node.itemProgressOnlyForTriggered);
      const highlightBindings = [node.itemHighlightVariable, node.itemHighlightVariable2].filter(Boolean);
      const itemTemplate = prop(node, "itemTemplate", ctx, null);
      if (itemTemplate && Array.isArray(itemTemplate.parts)) {
        let previousGroup;
        for (const item of prop(node, "items", ctx, []) || []) {
          if (itemGroupField && item && typeof item === "object" && item[itemGroupField] !== previousGroup) {
            const group = document.createElement("div");
            group.className = node.itemGroupClassName || "ng-widget-list-group";
            group.textContent = item[itemGroupField];
            el.appendChild(group);
            previousGroup = item[itemGroupField];
          }
          const li = document.createElement(node.itemType === "button" ? "button" : "div");
          if (li.tagName === "BUTTON") li.type = "button";
          const itemClass = item && typeof item === "object" && item.className ? ` ${item.className}` : "";
          const dataClass = itemClassField && item && typeof item === "object" && item[itemClassField] ? ` ${item[itemClassField]}` : "";
          li.className = itemClassName ? `ng-widget-list-item ${itemClassName}${dataClass}${itemClass}` : `ng-widget-list-item${dataClass}${itemClass}`;
          if (itemDisabledField && item && typeof item === "object") li.disabled = Boolean(item[itemDisabledField]);
          if (["horizontal", "vertical"].includes(itemTemplate.layout)) {
            li.style.display = "flex";
            li.style.flexDirection = itemTemplate.layout === "vertical" ? "column" : "row";
          }
          const secret = item && typeof item === "object" && itemSecretField
            && Boolean(item[itemSecretField]) && !Boolean(item[itemSecretUnlockedField]);
          const highlightTerms = highlightBindings.map((binding) => prop({ text: binding }, "text", ctx, ""));
          for (const part of itemTemplate.parts) {
            renderListTemplatePart(li, part, node, item, ctx, secret, highlightTerms, itemEventValueField);
          }
          if (item && typeof item === "object" && item.id !== undefined) {
            li.dataset.itemId = item.id;
            if (ctx.onEvent) {
              const eventValue = itemEventValueField && item[itemEventValueField] !== undefined ? item[itemEventValueField] : item.id;
              li.addEventListener("click", () => ctx.onEvent(node, "onItemClick", eventValue));
            }
          }
          el.appendChild(li);
        }
      } else {
      let previousGroup;
      for (const item of prop(node, "items", ctx, []) || []) {
        if (itemGroupField && item && typeof item === "object" && item[itemGroupField] !== previousGroup) {
          const group = document.createElement("div");
          group.className = node.itemGroupClassName || "ng-widget-list-group";
          group.textContent = item[itemGroupField];
          el.appendChild(group);
          previousGroup = item[itemGroupField];
        }
        const li = document.createElement(node.itemType === "button" ? "button" : "div");
        if (li.tagName === "BUTTON") li.type = "button";
        const itemClass = item && typeof item === "object" && item.className ? ` ${item.className}` : "";
        const dataClass = itemClassField && item && typeof item === "object" && item[itemClassField] ? ` ${item[itemClassField]}` : "";
        li.className = itemClassName ? `ng-widget-list-item ${itemClassName}${dataClass}${itemClass}` : `ng-widget-list-item${dataClass}${itemClass}`;
        if (itemDisabledField && item && typeof item === "object") li.disabled = Boolean(item[itemDisabledField]);
        const secret = item && typeof item === "object" && itemSecretField
          && Boolean(item[itemSecretField]) && !Boolean(item[itemSecretUnlockedField]);
        const label = secret ? (node.itemSecretLabel || "？？？？") : typeof item === "string" ? item : itemLabelTemplate
          ? itemLabelTemplate.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => item?.[key] ?? "")
          : item.label ?? item[itemLabelField] ?? "";
        const displayLabel = itemIconField && item && typeof item === "object" && item[itemIconField]
          ? `${item[itemIconField]} ${label}`
          : label;
        const highlightTerms = highlightBindings.map((binding) => prop({ text: binding }, "text", ctx, ""));
        setHighlightedText(li, displayLabel, highlightTerms);
        if (item && typeof item === "object" && itemMetaTemplate) {
          const meta = document.createElement("span");
          meta.className = "ng-widget-list-item-meta";
          meta.textContent = secret ? (node.itemSecretMeta || t("legacy.e7688c715821")) : itemMetaTemplate.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => item?.[key] ?? "");
          li.appendChild(meta);
        }
        if (item && typeof item === "object" && itemProgressField && (!itemProgressOnlyForTriggered || item.trigger?.progress)) {
          const progress = document.createElement("span");
          progress.className = "ng-widget-list-item-progress";
          const fill = document.createElement("span");
          fill.className = "ng-widget-list-item-progress-fill";
          fill.style.width = `${Math.max(0, Math.min(100, Number(item[itemProgressField]) || 0))}%`;
          progress.appendChild(fill);
          li.appendChild(progress);
        }
        if (item && typeof item === "object" && item.id !== undefined) {
          li.dataset.itemId = item.id;
          if (ctx.onEvent) {
            const eventValue = itemEventValueField && item[itemEventValueField] !== undefined
              ? item[itemEventValueField]
              : item.id;
            li.addEventListener("click", () => ctx.onEvent(node, "onItemClick", eventValue));
          }
          for (const action of node.itemActions || []) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = action.className || "win95-btn bevel-out ng-list-item-action";
            button.textContent = action.label || action.id || t("legacy.f3ea6d345e2a");
            button.addEventListener("click", (event) => {
              event.stopPropagation();
              const eventValue = itemEventValueField && item[itemEventValueField] !== undefined
                ? item[itemEventValueField]
                : item.id;
              ctx.onEvent?.(node, action.eventName || action.id, eventValue);
            });
            li.appendChild(button);
          }
        }
        el.appendChild(li);
      }
      }
      break;
    }
    case "table": {
      const table = document.createElement("table");
      for (const row of prop(node, "rows", ctx, []) || []) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      el.appendChild(table);
      break;
    }
    case "progress": {
      const bar = document.createElement("div");
      bar.className = "ng-widget-progress-bar";
      bar.style.width = `${Math.max(0, Math.min(100, Number(prop(node, "value", ctx, 0)) || 0))}%`;
      el.appendChild(bar);
      break;
    }
    case "spacer":
      break;
    default:
      throw new Error(`Unknown widget type: ${node.type}`);
  }
  return el;
}

/**
 * Render a widget tree node (and its descendants) into a real DOM element.
 * Returns the root element; populates `ctx.widgetEls` (Map widgetId->el) as
 * a side effect so callers can look up any node's rendered element.
 */
export function renderWidgetNode(node, ctx = {}) {
  if (!node) throw new Error(t("error.068ffe82d88e"));
  ctx.widgetEls = ctx.widgetEls || new Map();
  ctx.controlEls = ctx.controlEls || new Map();
  let el;
  const customFactory = ctx.customWidgetFactories?.[node.type];
  if (customFactory) {
    el = customFactory(node, ctx);
    if (!(el instanceof HTMLElement)) throw new Error(`Custom widget factory "${node.type}" must return an HTMLElement`);
  } else if (["fileManager", "documentEditor", "filePicker", "terminal"].includes(node.type)) {
    el = document.createElement("div");
    el.textContent = t("widget.customRuntimeOnly", { type: node.type });
  } else if (node.type === "tabs") {
    el = document.createElement("div");
    el.className = "ng-widget-tabs";
    applyContainerStyle(el, node, ctx);
    const navigation = document.createElement("div");
    navigation.className = "ng-widget-tabs-navigation";
    navigation.setAttribute("role", "tablist");
    const panels = document.createElement("div");
    panels.className = "ng-widget-tabs-panels";
    let activeIndex = 0;
    const entries = [];
    const show = (selectedIndex) => {
      activeIndex = selectedIndex;
      entries.forEach(({ button, panel }, index) => {
        button.classList.toggle("active", index === activeIndex);
        button.setAttribute("aria-selected", String(index === activeIndex));
        panel.hidden = index !== activeIndex;
      });
    };
    (node.children || []).forEach((child, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = node.tabClassName || "win95-btn bevel-out";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(index === 0));
      button.textContent = child.tabLabel || `${t("windowEditor.subeditor.tabLabel", "标签")} ${index + 1}`;
      button.addEventListener("click", () => show(index));
      navigation.appendChild(button);
      const panel = document.createElement("section");
      panel.className = node.panelClassName || "ng-widget-tabs-panel";
      panel.setAttribute("role", "tabpanel");
      panel.hidden = index !== 0;
      panel.appendChild(renderWidgetNode(child, { ...ctx, componentParent: node }));
      panels.appendChild(panel);
      entries.push({ button, panel });
    });
    el.append(navigation, panels);
  } else if (node.type === "container" || node.type === "fieldset" || node.type === "details") {
    el = document.createElement(node.type === "fieldset" ? "fieldset" : node.type === "details" ? "details" : "div");
    applyContainerStyle(el, node, ctx);
    if (node.type === "fieldset" && prop(node, "legend", ctx, node.legend)) {
      const legend = document.createElement("legend");
      legend.textContent = prop(node, "legend", ctx, node.legend || "");
      el.appendChild(legend);
    }
    if (node.type === "details" && prop(node, "summary", ctx, node.summary)) {
      const summary = document.createElement("summary");
      summary.textContent = prop(node, "summary", ctx, node.summary || "");
      el.appendChild(summary);
    }
    for (const child of node.children || []) {
      const childEl = renderWidgetNode(child, { ...ctx, componentParent: node });
      applyStackPosition(childEl, child, node, ctx);
      el.appendChild(childEl);
    }
    if (Array.isArray(node.componentActions) && node.componentActions.length) {
      const actions = new Set(node.componentActions);
      if (actions.has("add")) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "win95-btn bevel-out his-prescription-copy";
      add.textContent = "+";
      add.title = t("legacy.ca5fdcf1e498");
      add.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ctx.onEvent?.(node, "onAdd");
      });
        el.append(add);
      }
      if (actions.has("remove")) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "win95-btn bevel-out his-prescription-delete";
      remove.textContent = "−";
      remove.title = t("legacy.fcd6a3765d0c");
      const siblings = ctx.componentParent?.children || [];
      const siblingCount = siblings.filter((sibling) => sibling.className === node.className).length;
      remove.disabled = siblingCount <= 1;
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ctx.onEvent?.(node, "onRemove");
      });
        el.append(remove);
      }
    }
  } else {
    el = renderLeaf(node, ctx);
  }
  applyCommonAttrs(el, node, ctx);
  ctx.widgetEls.set(node.widgetId || node.id, el);
  return el;
}

/** Render a whole window's `root` widget tree; returns { el, widgetEls }. */
export function renderWindowRoot(root, ctx = {}) {
  /* DEV-TOOLS:START */
  const renderStartedAt = globalThis.performance?.now?.();
  /* DEV-TOOLS:END */
  ctx.widgetEls = new Map();
  ctx.controlEls = new Map();
  const el = renderWidgetNode(root, ctx);
  /* DEV-TOOLS:START */
  const samples = globalThis.__cultistsPerformanceSamples;
  if (Array.isArray(samples) && Number.isFinite(renderStartedAt)) {
    samples.push({
      name: "widget-root-render",
      durationMs: globalThis.performance.now() - renderStartedAt,
      widgetCount: ctx.widgetEls.size,
      rootType: root?.type || null,
    });
  }
  /* DEV-TOOLS:END */
  return { el, widgetEls: ctx.widgetEls };
}

export default renderWindowRoot;
