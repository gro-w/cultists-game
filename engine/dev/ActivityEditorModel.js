// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { normalizeBlueprint, validateBlueprint } from "../core/ActivityValidator.js";
import { getActivityNodeDefinition, getActivityNodePort, arePortsCompatible, classifyActivityNodePorts } from "../core/ActivityNodeRegistry.js";
import { serializeCl2 } from "../core/Cl2Serializer.js";

/**
 * ActivityEditorModel - DOM-independent state for one Activity editor
 * window (plan §6.2). Every window constructs its own model instance (no
 * module-level singleton), so two editor windows never share selection,
 * history or draft mutations even if they happen to be editing the same
 * source activity id (probe: "两个 Activity 编辑器窗口互不串状态").
 *
 * The only canonical model this editor saves is the Blueprint itself
 * (plan §6.2 "编辑器保存的唯一 canonical model 是 blueprint"): node
 * positions (`x`/`y`) are stored directly on each node record so
 * export/reload round-trips positions without a parallel "layout" object.
 *
 * Connection schema: there is no flat `connections` array. A flow output
 * port can only ever point at one downstream node/port (`node.next[port] =
 * { nodeId, port }` - a linked list of "next" pointers, so a flow output
 * has exactly one downstream, while nothing stops several nodes' `next`
 * from pointing at the same flow input). A value input can only ever read
 * from one upstream source (`node.inputs[port] = { nodeId, port }` - a
 * linked list of "source" pointers, so a value input has exactly one
 * upstream, while nothing stops several nodes' inputs from reading the same
 * value output). `listConnections()` derives a flat view of both for the
 * editor view/probes to consume without caring about the storage split.
 */

const HISTORY_LIMIT = 50;

let _nodeSeq = 0;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isWireRef(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "nodeId" in value);
}

function assignMissingNodePositions(blueprint) {
  Object.values(blueprint.nodes || {}).forEach((node, index) => {
    if (!Number.isFinite(Number(node.x))) node.x = 80 + (index % 4) * 220;
    if (!Number.isFinite(Number(node.y))) node.y = 80 + Math.floor(index / 4) * 140;
  });
  return blueprint;
}

export function createActivityEditorModel({ activityId, blueprint, displayName, valueOnly = false } = {}) {
  let current = assignMissingNodePositions(normalizeBlueprint(blueprint || {}));
  let name = displayName || activityId || "untitled";
  const selection = new Set();
  const history = [];
  const future = [];

  function pushHistory() {
    history.push(cloneValue(current));
    if (history.length > HISTORY_LIMIT) history.shift();
    future.length = 0;
  }

  function nodeDefinitions(id) {
    const node = current.nodes[id];
    return node ? getActivityNodeDefinition(node.type) : null;
  }

  function addNode(type, x = 0, y = 0, inputs = {}) {
    const definition = getActivityNodeDefinition(type);
    if (!definition) throw new Error(`Unknown node type: ${type}`);
    pushHistory();
    const id = `${type}-${++_nodeSeq}`;
    const node = { id, type, x, y, inputs: { ...inputs }, next: {} };
    current.nodes[id] = node;
    if (type === "flowStart" && !current.startNodeId) current.startNodeId = id;
    return node;
  }

  function moveNode(id, x, y) {
    const node = current.nodes[id];
    if (!node) return false;
    node.x = x;
    node.y = y;
    return true;
  }

  /** Move every currently selected node by the same delta (multi-drag, §6.2). */
  function moveSelected(dx, dy) {
    let moved = false;
    for (const id of selection) {
      const node = current.nodes[id];
      if (!node) continue;
      node.x += dx;
      node.y += dy;
      moved = true;
    }
    return moved;
  }

  function beginDrag() {
    pushHistory();
  }

  /** Clear every `next`/`inputs` reference (from any node) that targets `id`, used before/while removing a node so the graph never keeps a dangling pointer. */
  function unlinkReferencesTo(id) {
    for (const node of Object.values(current.nodes)) {
      for (const port of Object.keys(node.next || {})) {
        if (node.next[port]?.nodeId === id) delete node.next[port];
      }
      for (const [port, value] of Object.entries(node.inputs || {})) {
        if (isWireRef(value) && value.nodeId === id) delete node.inputs[port];
      }
    }
  }

  function deleteNode(id) {
    if (!current.nodes[id]) return false;
    pushHistory();
    delete current.nodes[id];
    unlinkReferencesTo(id);
    selection.delete(id);
    if (current.startNodeId === id) current.startNodeId = null;
    return true;
  }

  /** Delete every currently selected node as a single history step (plan item "复制粘贴删除选中"). */
  function deleteSelected() {
    const ids = [...selection];
    if (!ids.length) return false;
    pushHistory();
    for (const id of ids) {
      delete current.nodes[id];
      if (current.startNodeId === id) current.startNodeId = null;
    }
    ids.forEach(unlinkReferencesTo);
    selection.clear();
    return true;
  }

  function selectOnly(id) {
    selection.clear();
    if (id) selection.add(id);
  }

  function toggleSelect(id) {
    if (!id) return;
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
  }

  function clearSelection() {
    selection.clear();
  }

  /** Box-select every node whose position falls within `rect` ({x,y,width,height} in logical/unscaled canvas coordinates). */
  function selectInBox(rect, { additive = false } = {}) {
    if (!additive) selection.clear();
    const x2 = rect.x + rect.width;
    const y2 = rect.y + rect.height;
    for (const node of Object.values(current.nodes)) {
      if (node.x >= rect.x && node.x <= x2 && node.y >= rect.y && node.y <= y2) selection.add(node.id);
    }
    return [...selection];
  }

  function getSelection() {
    return [...selection];
  }

  function isSelected(id) {
    return selection.has(id);
  }

  /**
   * Attempt a connection (flow or value); rejects incompatible/unknown
   * ports instead of throwing, per §6.3. A flow output only ever keeps its
   * latest `next` link (one downstream); a value input only ever keeps its
   * latest wired source (one upstream) and any prior literal on that port
   * is cleared.
   */
  function connect(fromNodeId, fromPort, toNodeId, toPort) {
    const fromNode = current.nodes[fromNodeId];
    const toNode = current.nodes[toNodeId];
    if (!fromNode || !toNode) return { ok: false, error: t("legacy.e27f1d70eab1") };
    if (fromNode.cl2Class === "valueReceiver") {
      return { ok: false, error: "A value receiver cannot be used as a value source" };
    }
    const sourcePort = getActivityNodePort(fromNode.type, "output", fromPort);
    const targetPort = getActivityNodePort(toNode.type, "input", toPort);
    if (!sourcePort) return { ok: false, error: `${t("legacy.fa002d2c545a")}${fromNodeId} ${t("legacy.1a053b86935d")}${fromPort}` };
    if (!targetPort) return { ok: false, error: `${t("legacy.fa002d2c545a")}${toNodeId} ${t("legacy.7d5b5439d87a")}${toPort}` };
    if (!arePortsCompatible(sourcePort, targetPort)) return { ok: false, error: t("legacy.612b75fb27de") };
    pushHistory();
    if (sourcePort.kind === "flow") {
      fromNode.next[fromPort] = { nodeId: toNodeId, port: toPort };
    } else {
      toNode.inputs[toPort] = { nodeId: fromNodeId, port: fromPort };
    }
    return { ok: true, id: connectionId(sourcePort.kind, fromNodeId, fromPort, toNodeId, toPort) };
  }

  function connectionId(kind, fromNodeId, fromPort, toNodeId, toPort) {
    return kind === "flow" ? `flow:${fromNodeId}:${fromPort}` : `value:${toNodeId}:${toPort}`;
  }

  /** Clear a flow output's `next` link, leaving it unconnected (editor-only "编辑流程输出的下家" UI - selecting the empty option). */
  function disconnectFlowOutput(nodeId, fromPort) {
    const node = current.nodes[nodeId];
    if (!node?.next?.[fromPort]) return false;
    pushHistory();
    delete node.next[fromPort];
    return true;
  }

  /** Clear a value input's wired source, reverting it to constant-editing mode ("编辑数值输入的上家" UI - selecting "常量"). */
  function clearValueInput(nodeId, portName) {
    const node = current.nodes[nodeId];
    if (!node || !isWireRef(node.inputs?.[portName])) return false;
    pushHistory();
    delete node.inputs[portName];
    return true;
  }

  function disconnect(connectionId_) {
    const [kind, nodeId, port] = String(connectionId_).split(":");
    const node = current.nodes[nodeId];
    if (!node) return false;
    if (kind === "flow") return disconnectFlowOutput(nodeId, port);
    if (kind === "value") return clearValueInput(nodeId, port);
    return false;
  }

  /**
   * Layered/barycenter auto-layout ("自动排布"), ported from the legacy
   * engine's DevDialogueEditorTab._autoLayout(). Purely graph-generic: it
   * only reads each node's `next` flow links and writes `x`/`y`, so it
   * carries no domain-specific logic and works for any node types.
   */
  function autoLayout() {
    const ids = Object.keys(current.nodes);
    if (!ids.length) return false;
    pushHistory();
    const W = 200, H = 120, GAPX = 100, GAPY = 45, PAD = 40;
    const orderIndex = new Map(ids.map((id, index) => [id, index]));
    const outgoing = new Map(ids.map((id) => [id, new Set()]));
    const incoming = new Map(ids.map((id) => [id, new Set()]));
    for (const id of ids) {
      for (const target of Object.values(current.nodes[id].next || {})) {
        if (!target?.nodeId || !outgoing.has(id) || !incoming.has(target.nodeId) || target.nodeId === id) continue;
        outgoing.get(id).add(target.nodeId);
        incoming.get(target.nodeId).add(id);
      }
      // Value dependencies are graph edges too. Include them in the same
      // ranking pass so reusable arithmetic/query nodes are placed upstream
      // of the flow node that consumes them instead of collapsing into one
      // disconnected vertical column.
      for (const value of Object.values(current.nodes[id].inputs || {})) {
        if (!isWireRef(value) || !outgoing.has(value.nodeId) || value.nodeId === id) continue;
        outgoing.get(value.nodeId).add(id);
        incoming.get(id).add(value.nodeId);
      }
    }

    // Topological ranking (Kahn's algorithm): rank = longest path from any root.
    const indegree = new Map(ids.map((id) => [id, incoming.get(id).size]));
    const ranks = new Map(ids.map((id) => [id, 0]));
    const queue = ids.filter((id) => indegree.get(id) === 0);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor];
      for (const target of outgoing.get(id)) {
        ranks.set(target, Math.max(ranks.get(target), ranks.get(id) + 1));
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) queue.push(target);
      }
    }
    // Any nodes left with indegree > 0 (a cycle) still have a rank from the
    // relaxation above; they just never got pushed onto `queue`, which is
    // fine since we only need `ranks` from here on.
    const maxRank = Math.max(0, ...ranks.values());
    const layers = Array.from({ length: maxRank + 1 }, () => []);
    for (const id of ids) layers[ranks.get(id)].push(id);

    // 4-pass median/barycenter crossing-reduction sweep.
    const positionMap = () => {
      const map = new Map();
      layers.forEach((layer) => layer.forEach((id, index) => map.set(id, index)));
      return map;
    };
    const median = (values) => (values.length ? values[Math.floor((values.length - 1) / 2)] : Number.POSITIVE_INFINITY);
    const reorder = (layerIndex, useParents) => {
      const layer = layers[layerIndex];
      const positions = positionMap();
      const neighborRank = useParents ? layerIndex - 1 : layerIndex + 1;
      const neighborsOf = useParents ? incoming : outgoing;
      layer.sort((left, right) => {
        const leftMedian = median([...neighborsOf.get(left)].filter((id) => ranks.get(id) === neighborRank).map((id) => positions.get(id)).sort((a, b) => a - b));
        const rightMedian = median([...neighborsOf.get(right)].filter((id) => ranks.get(id) === neighborRank).map((id) => positions.get(id)).sort((a, b) => a - b));
        return leftMedian - rightMedian || orderIndex.get(left) - orderIndex.get(right);
      });
    };
    for (let pass = 0; pass < 4; pass += 1) {
      for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) reorder(layerIndex, true);
      for (let layerIndex = layers.length - 2; layerIndex >= 0; layerIndex -= 1) reorder(layerIndex, false);
    }

    const MAX_ROWS_PER_COLUMN = 6;
    layers.forEach((layer, rank) => {
      layer.forEach((id, row) => {
        const columnOffset = Math.floor(row / MAX_ROWS_PER_COLUMN);
        const rowOffset = row % MAX_ROWS_PER_COLUMN;
        current.nodes[id].x = PAD + (rank + columnOffset) * (W + GAPX);
        current.nodes[id].y = PAD + rowOffset * (H + GAPY);
      });
    });
    return true;
  }

  /** A flat, storage-agnostic view of every flow `next` link and value wire, in the {id,fromNodeId,fromPort,toNodeId,toPort} shape the editor view/probes already expect. */
  function listConnections() {
    const result = [];
    for (const node of Object.values(current.nodes)) {
      for (const [port, target] of Object.entries(node.next || {})) {
        if (target?.nodeId) result.push({ id: connectionId("flow", node.id, port, target.nodeId, target.port), fromNodeId: node.id, fromPort: port, toNodeId: target.nodeId, toPort: target.port });
      }
      for (const [port, value] of Object.entries(node.inputs || {})) {
        if (isWireRef(value)) result.push({ id: connectionId("value", value.nodeId, value.port, node.id, port), fromNodeId: value.nodeId, fromPort: value.port, toNodeId: node.id, toPort: port });
      }
    }
    return result;
  }

  /** Copy the currently selected nodes into a plain, detached clipboard payload. Any `next`/value-wire reference pointing outside the copied set is stripped, so pasting never silently rewires into the original graph. */
  function copySelected() {
    const ids = [...selection];
    if (!ids.length) return null;
    const idSet = new Set(ids);
    const nodes = ids.map((id) => cloneValue(current.nodes[id]));
    for (const node of nodes) {
      for (const port of Object.keys(node.next || {})) {
        if (!idSet.has(node.next[port]?.nodeId)) delete node.next[port];
      }
      for (const [port, value] of Object.entries(node.inputs || {})) {
        if (isWireRef(value) && !idSet.has(value.nodeId)) delete node.inputs[port];
      }
    }
    return { nodes };
  }

  /** Paste a clipboard payload from copySelected(), remapping ids so pasted nodes are brand new and internal wiring between them is preserved. Pasted nodes become the new selection. */
  function pasteNodes(clipboard, offset = { x: 40, y: 40 }) {
    if (!clipboard?.nodes?.length) return [];
    pushHistory();
    const idMap = new Map();
    const pasted = clipboard.nodes.map((node) => {
      const newId = `${node.type}-${++_nodeSeq}`;
      idMap.set(node.id, newId);
      return { ...cloneValue(node), id: newId };
    });
    for (const node of pasted) {
      node.x += offset.x;
      node.y += offset.y;
      const remappedNext = {};
      for (const [port, target] of Object.entries(node.next || {})) {
        if (target?.nodeId && idMap.has(target.nodeId)) remappedNext[port] = { nodeId: idMap.get(target.nodeId), port: target.port };
      }
      node.next = remappedNext;
      for (const [port, value] of Object.entries(node.inputs || {})) {
        if (!isWireRef(value)) continue;
        if (idMap.has(value.nodeId)) node.inputs[port] = { nodeId: idMap.get(value.nodeId), port: value.port };
        else delete node.inputs[port];
      }
      current.nodes[node.id] = node;
    }
    selection.clear();
    pasted.forEach((node) => selection.add(node.id));
    return pasted;
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

  /** Structural + port-compatibility validation (§6.3), independent of the runtime's own validateBlueprint. */
  function validateForSave() {
    if (!valueOnly) return validateBlueprint(current);
    const errors = [];
    for (const node of Object.values(current.nodes || {})) {
      const definition = getActivityNodeDefinition(node.type);
      const nodeClass = node.cl2Class || classifyActivityNodePorts(definition);
      if (!definition) {
        errors.push(`Unknown value node ${node.id}: ${node.type}`);
      } else if (nodeClass !== "value" && nodeClass !== "valueReceiver") {
        errors.push(`Value blueprint node ${node.id} is not a value node or value receiver`);
      }
      if (nodeClass === "valueReceiver") {
        for (const port of definition?.valueInputs || []) {
          if (!Object.prototype.hasOwnProperty.call(node.inputs || {}, port.name)) {
            errors.push(`${node.id} is missing receiver input ${port.name}`);
          }
        }
      }
      for (const [port, value] of Object.entries(node.inputs || {})) {
        if (!isWireRef(value)) continue;
        const source = current.nodes[value.nodeId];
        if (!source) errors.push(`${node.id}.${port} references missing node ${value.nodeId}`);
        else if (source.cl2Class === "valueReceiver") errors.push(`${node.id}.${port} references value receiver ${value.nodeId}, which has no output`);
        else if (!getActivityNodePort(source.type, "output", value.port || "value")) errors.push(`${node.id}.${port} references missing value output ${value.nodeId}.${value.port || "value"}`);
      }
    }
    return { ok: errors.length === 0, errors, blueprint: exportBlueprint() };
  }

  /** The one canonical export: a plain blueprint object, including each node's presentation position. */
  function exportBlueprint() {
    return cloneValue(current);
  }

  function loadBlueprint(nextBlueprint) {
    pushHistory();
    current = assignMissingNodePositions(normalizeBlueprint(nextBlueprint));
    selection.clear();
  }

  function toDefinition() {
    return { id: activityId, displayName: name, blueprint: exportBlueprint() };
  }

  function toDownloadPayload() {
    return serializeCl2(current, { activityId });
  }

  function setDisplayName(nextName) {
    name = nextName;
  }

  /** Renames the activity's own stable id (plan follow-up: "蓝图id可以编辑"). Only mutates the editor's in-memory model; the caller is responsible for reconciling any external registry (list membership, file name, window title) that indexes by the old id. */
  function setActivityId(nextId) {
    if (!nextId) throw new Error(t("legacy.39333cde4964"));
    activityId = nextId;
  }

  return {
    get activityId() { return activityId; },
    setActivityId,
    get displayName() { return name; },
    setDisplayName,
    addNode,
    moveNode,
    moveSelected,
    beginDrag,
    deleteNode,
    deleteSelected,
    selectOnly,
    toggleSelect,
    clearSelection,
    selectInBox,
    getSelection,
    isSelected,
    connect,
    disconnect,
    disconnectFlowOutput,
    clearValueInput,
    autoLayout,
    copySelected,
    pasteNodes,
    undo,
    redo,
    canUndo: () => history.length > 0,
    canRedo: () => future.length > 0,
    validateForSave,
    exportBlueprint,
    loadBlueprint,
    toDefinition,
    toDownloadPayload,
    nodeDefinitions,
    getNode: (id) => current.nodes[id] || null,
    listNodes: () => Object.values(current.nodes),
    listConnections,
    get startNodeId() { return current.startNodeId; },
    get nodeCount() { return Object.keys(current.nodes).length; },
  };
}

export default createActivityEditorModel;
// DEV-TOOLS:END
