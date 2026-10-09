// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
/**
 * WindowEditorModel - DOM-independent state for the custom window WYSIWYG
 * editor (plan §7). The only canonical model saved is the window
 * definition itself; a widget's position in the tree (parentId + index) is
 * the sole "layout" record, so export/reload round-trips both structure
 * and (for the widgets that expose them) explicit `x`/`y` fields.
 *
 * Every editor window constructs its own model instance (no module-level
 * singleton), matching ActivityEditorModel's isolation guarantee so two
 * window editor windows never share selection/history/drafts.
 */

let _widgetSeq = 0;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isContainer(node) {
  return ["container", "tabs", "fieldset", "details"].includes(node?.type);
}

function defaultWidget(type, widgetId) {
  const base = { widgetId, type };
  if (isContainer(base)) return { ...base, flow: "vertical", gap: 4, padding: 4, children: [], ...(type === "fieldset" ? { legend: "Group" } : {}), ...(type === "details" ? { summary: "Details" } : {}) };
  if (type === "label") return { ...base, text: t("legacy.f1926e9b3365") };
  if (type === "button") return { ...base, text: t("legacy.a6a6eaa2f18b") };
  if (type === "clock") return { ...base, format: "default" };
  if (type === "textInput" || type === "textarea") return { ...base, value: "", placeholder: "" };
  if (type === "checkbox") return { ...base, value: false };
  if (type === "range") return { ...base, min: 0, max: 100, step: 1, value: 0 };
  if (type === "select") return { ...base, value: "", options: [], placeholder: "" };
  if (type === "image") return { ...base, src: "", alt: "" };
  if (type === "list") return { ...base, items: [], itemLabelField: "name" };
  if (type === "table") return { ...base, rows: [] };
  if (type === "progress") return { ...base, value: 0, max: 100 };
  if (type === "dialogue") return { ...base, displayTo: "dialogue" };
  if (type === "embeddedWindow") return { ...base, windowId: "" };
  if (type === "clueWall" || type === "recordTabs") return { ...base, items: [] };
  if (type === "fileManager") return { ...base, path: "/home/desktop" };
  if (type === "spacer") return base;
  return { ...base, value: "" };
}

function defaultRoot() {
  return { widgetId: "root", type: "container", flow: "stack", gap: 8, padding: 10, children: [] };
}

export function createWindowEditorModel({ definition } = {}) {
  let current = cloneValue(definition) || {
    id: "untitled",
    title: t("legacy.17b0f4225e1f"),
    mode: "window",
    fullscreen: false,
    x: 80,
    y: 60,
    width: 480,
    height: 320,
    root: defaultRoot(),
    events: { onCreate: null, onDestroy: null },
  };
  // A definition may legitimately have no `root` widget tree yet (legacy
  // `body`-only windows like example.json, or a dev-tool window registered
  // before the widget-tree schema). Synthesize an empty root rather than
  // letting every tree-walking helper below crash on `undefined`; this
  // never discards `body` since `toDefinition()` still carries it through.
  if (!current.root) current.root = defaultRoot();
  let selectedId = null;
  const history = [];
  const future = [];

  function pushHistory() {
    history.push(cloneValue(current));
    if (history.length > 50) history.shift();
    future.length = 0;
  }

  /** Depth-first walk; visitor receives (node, parent, index). */
  function walk(node, parent, index, visitor) {
    visitor(node, parent, index);
    if (isContainer(node)) {
      (node.children || []).forEach((child, i) => walk(child, node, i, visitor));
    }
  }

  function findWidget(widgetId) {
    let found = null;
    walk(current.root, null, -1, (node, parent, index) => {
      if (found) return;
      if (node.widgetId === widgetId) found = { node, parent, index };
    });
    return found;
  }

  function listWidgets() {
    const list = [];
    walk(current.root, null, -1, (node) => list.push(node));
    return list;
  }

  function select(widgetId) {
    selectedId = widgetId;
  }

  function getSelected() {
    return selectedId ? findWidget(selectedId)?.node ?? null : null;
  }

  function addWidget(type, parentId = "root", index = null) {
    const parentEntry = findWidget(parentId);
    if (!parentEntry || !isContainer(parentEntry.node)) return null;
    pushHistory();
    let widgetId;
    do { widgetId = `${type}-${++_widgetSeq}`; } while (findWidget(widgetId));
    const widget = defaultWidget(type, widgetId);
    const children = parentEntry.node.children || (parentEntry.node.children = []);
    const at = index == null ? children.length : Math.max(0, Math.min(children.length, index));
    children.splice(at, 0, widget);
    selectedId = widget.widgetId;
    return widget;
  }

  function removeWidget(widgetId) {
    if (widgetId === current.root.widgetId) return false;
    const entry = findWidget(widgetId);
    if (!entry || !entry.parent) return false;
    pushHistory();
    entry.parent.children.splice(entry.index, 1);
    if (selectedId === widgetId) selectedId = null;
    return true;
  }

  function duplicateWidget(widgetId) {
    const entry = findWidget(widgetId);
    if (!entry || !entry.parent) return null;
    pushHistory();
    const copy = cloneValue(entry.node);
    reassignIds(copy);
    entry.parent.children.splice(entry.index + 1, 0, copy);
    selectedId = copy.widgetId;
    return copy;
  }

  function reassignIds(node) {
    do { node.widgetId = `${node.type}-${++_widgetSeq}`; } while (findWidget(node.widgetId));
    if (isContainer(node)) (node.children || []).forEach(reassignIds);
  }

  /** Move a widget to a new parent container at a new index (used for both reorder-within-parent and reparent drag). */
  function moveWidget(widgetId, newParentId, newIndex) {
    if (widgetId === current.root.widgetId) return false;
    const entry = findWidget(widgetId);
    const target = findWidget(newParentId);
    if (!entry || !entry.parent || !isContainer(target.node)) return false;
    if (isDescendant(entry.node, target.node)) return false; // never move a container into its own subtree
    pushHistory();
    entry.parent.children.splice(entry.index, 1);
    const children = target.node.children || (target.node.children = []);
    const at = newIndex == null ? children.length : Math.max(0, Math.min(children.length, newIndex));
    children.splice(at, 0, entry.node);
    return true;
  }

  /** Place a widget freely while preserving every existing child's visible
   * geometry when the destination uses flow/grid layout. One drag is one
   * history transaction, so undo restores both the layout mode and positions. */
  function placeWidget(widgetId, newParentId, { x, y, positions = {}, recordHistory = true } = {}) {
    if (widgetId === current.root.widgetId) return false;
    const entry = findWidget(widgetId);
    const target = findWidget(newParentId);
    if (!entry || !entry.parent || !isContainer(target?.node)) return false;
    if (isDescendant(entry.node, target.node)) return false;

    if (recordHistory) pushHistory();
    const children = target.node.children || (target.node.children = []);
    const alreadyStack = target.node.flow === "stack";
    if (!alreadyStack) target.node.flow = "stack";
    for (const child of children) {
      const position = positions[child.widgetId];
      if (!position) continue;
      if (alreadyStack && Number.isFinite(Number(child.x)) && Number.isFinite(Number(child.y))) continue;
      const nextX = Number(position.x);
      const nextY = Number(position.y);
      if (Number.isFinite(nextX)) child.x = nextX;
      if (Number.isFinite(nextY)) child.y = nextY;
    }

    if (entry.parent !== target.node) {
      entry.parent.children.splice(entry.index, 1);
      children.push(entry.node);
    }
    const nextX = Number(x);
    const nextY = Number(y);
    if (Number.isFinite(nextX)) entry.node.x = nextX;
    if (Number.isFinite(nextY)) entry.node.y = nextY;
    return true;
  }

  function addTab(parentId = "root") {
    const parentEntry = findWidget(parentId);
    if (!parentEntry || !isContainer(parentEntry.node)) return null;
    pushHistory();
    let widgetId;
    do { widgetId = `tab-${++_widgetSeq}`; } while (findWidget(widgetId));
    const tab = {
      widgetId,
      type: "container",
      className: "tab-panel",
      flow: "vertical",
      gap: 4,
      padding: 4,
      tabLabel: `${t("legacy.195ff70cf92a")}${parentEntry.node.children.length + 1}`,
      children: [],
    };
    parentEntry.node.children = parentEntry.node.children || [];
    parentEntry.node.children.push(tab);
    selectedId = tab.widgetId;
    return tab;
  }

  function isDescendant(maybeAncestor, node) {
    if (maybeAncestor === node) return true;
    if (!isContainer(maybeAncestor)) return false;
    return (maybeAncestor.children || []).some((child) => isDescendant(child, node));
  }

  function updateWidgetProps(widgetId, patch, { recordHistory = true } = {}) {
    const entry = findWidget(widgetId);
    if (!entry) return false;
    if (recordHistory) pushHistory();
    Object.assign(entry.node, patch);
    return true;
  }

  function renameWidget(widgetId, nextId) {
    const entry = findWidget(widgetId);
    const normalizedId = String(nextId || "").trim();
    if (!entry || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(normalizedId)) return false;
    if (normalizedId !== widgetId && findWidget(normalizedId)) return false;
    if (normalizedId === widgetId) return true;
    pushHistory();
    entry.node.widgetId = normalizedId;
    if (selectedId === widgetId) selectedId = normalizedId;
    return true;
  }

  function updateWindowProps(patch) {
    pushHistory();
    Object.assign(current, patch);
    return true;
  }

  function undo() {
    if (!history.length) return false;
    future.push(cloneValue(current));
    current = history.pop();
    return true;
  }

  function redo() {
    if (!future.length) return false;
    history.push(cloneValue(current));
    current = future.pop();
    return true;
  }

  function toDefinition() {
    return cloneValue(current);
  }

  return {
    listWidgets,
    findWidget,
    select,
    getSelected,
    getSelectedId: () => selectedId,
    addWidget,
    removeWidget,
    addTab,
    duplicateWidget,
    moveWidget,
    placeWidget,
    updateWidgetProps,
    renameWidget,
    updateWindowProps,
    undo,
    redo,
    toDefinition,
    get definition() {
      return current;
    },
  };
}

export default createWindowEditorModel;
// DEV-TOOLS:END
