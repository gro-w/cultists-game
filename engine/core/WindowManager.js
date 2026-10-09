import { t } from "./i18n/index.js";
/**
 * WindowManager - sole owner of "打开的窗口及几何信息" (open windows and their
 * geometry), per the Phase 1 state-ownership table in
 * .hermes/plans/cultists-ng-engine-rebuild.md §2.3.
 *
 * This class is intentionally DOM-independent: it only tracks window state
 * (position, size, focus/z-order, minimized/maximized) and persists geometry
 * keyed by windowId. DOM creation, dragging and resize *gestures* live in
 * desktop/WindowFrame.js and desktop/PointerInteraction.js, which call back
 * into this manager. Keeping the two separated lets the state machine be
 * probed deterministically without a browser (see probes/window-manager-probe.mjs).
 */

const MIN_WIDTH = 220;
const MIN_HEIGHT = 140;
const GEOMETRY_STORAGE_KEY = "cultists-ng-window-geometry";
const TITLEBAR_HEIGHT = 20;
const MIN_VISIBLE_MARGIN = 48;
const TASKBAR_HEIGHT = 30;

function defaultViewport() {
  if (typeof window === "undefined") return { width: Infinity, height: Infinity };
  return { width: window.innerWidth, height: Math.max(0, window.innerHeight - TASKBAR_HEIGHT) };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  };
}

let _instanceIdCounter = 0;
let _openOrderCounter = 0;

export class WindowManager {
  /**
   * @param {import('./EventBus.js').default} eventBus
   * @param {{ storage?: { getItem(key:string):string|null, setItem(key:string,value:string):void }, getViewport?: () => {width:number,height:number} }} [options]
   */
  constructor(eventBus, options = {}) {
    this.eventBus = eventBus;
    this.storage = options.storage || (typeof localStorage !== "undefined" ? localStorage : memoryStorage());
    this.getViewport = options.getViewport || defaultViewport;
    this.windows = new Map(); // instanceId -> window state
    this.geometry = new Map(); // windowId -> saved geometry
    this.zCounter = 10;
    this._loadGeometry();
  }

  _loadGeometry() {
    try {
      const raw = this.storage.getItem(GEOMETRY_STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      for (const [windowId, geometry] of Object.entries(saved)) {
        this.geometry.set(windowId, geometry);
      }
    } catch {
      // A corrupt optional layout cache should never block startup.
    }
  }

  getSavedGeometry(windowId) {
    const geometry = this.geometry.get(windowId);
    return geometry ? { ...geometry } : null;
  }

  /**
   * Open a window instance for a given definition. If `singleInstance` is set
   * (default true) and a window with the same `windowId` is already open, it
   * is focused and restored instead of creating a duplicate.
   */
  open(definition, { parameters = [] } = {}) {
    const { windowId: explicitWindowId, id, title, icon, resizable = true, singleInstance = true, fullscreen = false, alwaysOnTop = false } = definition;
    const windowId = explicitWindowId || id;
    if (singleInstance) {
      const existing = this.getByWindowId(windowId);
      if (existing) {
        existing.parameters = structuredClone(Array.isArray(parameters) ? parameters : []);
        if (existing.minimized) this.restore(existing.instanceId);
        this.focus(existing.instanceId);
        this.eventBus.emit("window:parameters", { instanceId: existing.instanceId, windowId, parameters: structuredClone(existing.parameters) });
        return existing;
      }
    }

    const viewport = this.getViewport();
    const saved = this.getSavedGeometry(windowId);
    const geometry = fullscreen
      // Fullscreen only changes runtime geometry/z-index policy (plan §7.4);
      // it is still a perfectly normal window state otherwise.
      ? this._clampSize({
          x: 0,
          y: 0,
          width: Number.isFinite(viewport.width) ? viewport.width : (definition.width ?? 480),
          height: Number.isFinite(viewport.height) ? viewport.height : (definition.height ?? 360),
        })
      : this._clampSize({
          x: saved?.x ?? definition.x ?? 60,
          y: saved?.y ?? definition.y ?? 40,
          width: saved?.width ?? definition.width ?? 480,
          height: saved?.height ?? definition.height ?? 360,
        });
    const clampedPosition = fullscreen ? { x: 0, y: 0 } : this._clampPosition(geometry.x, geometry.y, geometry.width);

    const instanceId = `win-${++_instanceIdCounter}`;
    const state = {
      instanceId,
      windowId,
      title: title || "Untitled",
      icon: icon || null,
      resizable: fullscreen ? false : resizable,
      fullscreen: Boolean(fullscreen),
      alwaysOnTop: Boolean(alwaysOnTop),
      minimized: false,
      maximized: false,
      normalBounds: null,
      openOrder: ++_openOrderCounter,
      zIndex: 0,
      ...geometry,
      ...clampedPosition,
      parameters: structuredClone(Array.isArray(parameters) ? parameters : []),
    };
    this.windows.set(instanceId, state);
    this.focus(instanceId);
    this.eventBus.emit("window:opened", { instanceId, windowId, title: state.title });
    return state;
  }

  getByWindowId(windowId) {
    for (const state of this.windows.values()) {
      if (state.windowId === windowId) return state;
    }
    return null;
  }

  get(instanceId) {
    return this.windows.get(instanceId) || null;
  }

  /** Return snapshots for developer tools without exposing the internal Map. */
  list() {
    return [...this.windows.values()].map((state) => ({ ...state }));
  }

  close(instanceId) {
    const state = this.windows.get(instanceId);
    if (!state) return;
    this.persistGeometry(instanceId);
    this.windows.delete(instanceId);
    this.eventBus.emit("window:closed", { instanceId, windowId: state.windowId });
  }

  focus(instanceId) {
    const state = this.windows.get(instanceId);
    if (!state) return;
    this.zCounter += 1;
    // Fullscreen is a visual mode, not an ordering policy. It is placed above
    // windows that existed when it opened, but later focused windows may appear
    // above it. Only developer windows are always-on-top.
    state.zIndex = state.alwaysOnTop ? 100000 + this.zCounter : this.zCounter;
    this.eventBus.emit("window:focused", { instanceId, windowId: state.windowId });
  }

  /** instanceId of the currently topmost (focused) window, if any. */
  focusedInstanceId() {
    let topId = null;
    let topZ = -Infinity;
    for (const state of this.windows.values()) {
      if (!state.minimized && state.zIndex > topZ) {
        topZ = state.zIndex;
        topId = state.instanceId;
      }
    }
    return topId;
  }

  moveTo(instanceId, x, y) {
    const state = this.windows.get(instanceId);
    if (!state) return;
    const clamped = this._clampPosition(x, y, state.width);
    state.x = clamped.x;
    state.y = clamped.y;
    this.eventBus.emit("window:moved", { instanceId, x: state.x, y: state.y });
  }

  resize(instanceId, width, height) {
    const state = this.windows.get(instanceId);
    if (!state) return;
    const clamped = this._clampSize({ x: state.x, y: state.y, width, height });
    state.width = clamped.width;
    state.height = clamped.height;
    this.eventBus.emit("window:resized", { instanceId, width: state.width, height: state.height });
  }

  minimize(instanceId) {
    const state = this.windows.get(instanceId);
    if (!state) return;
    state.minimized = true;
    this.eventBus.emit("window:minimized", { instanceId });
  }

  restore(instanceId) {
    const state = this.windows.get(instanceId);
    if (!state) return;
    state.minimized = false;
    this.eventBus.emit("window:restored", { instanceId });
  }

  toggleMinimize(instanceId) {
    const state = this.windows.get(instanceId);
    if (!state) return;
    if (state.minimized) this.restore(instanceId);
    else this.minimize(instanceId);
  }

  maximize(instanceId) {
    const state = this.windows.get(instanceId);
    if (!state || state.maximized) return;
    state.normalBounds = { x: state.x, y: state.y, width: state.width, height: state.height };
    state.maximized = true;
    this.eventBus.emit("window:maximized", { instanceId });
  }

  unmaximize(instanceId) {
    const state = this.windows.get(instanceId);
    if (!state || !state.maximized || !state.normalBounds) return;
    Object.assign(state, state.normalBounds);
    const clamped = this._clampPosition(state.x, state.y, state.width);
    state.x = clamped.x;
    state.y = clamped.y;
    state.maximized = false;
    state.normalBounds = null;
    this.eventBus.emit("window:unmaximized", { instanceId });
  }

  toggleMaximize(instanceId) {
    const state = this.windows.get(instanceId);
    if (!state) return;
    if (state.maximized) this.unmaximize(instanceId);
    else this.maximize(instanceId);
  }

  /** Persist an open instance's current geometry, keyed by its windowId. */
  persistGeometry(instanceId) {
    const state = this.windows.get(instanceId);
    if (!state) return;
    const geometry = { x: state.x, y: state.y, width: state.width, height: state.height };
    this.geometry.set(state.windowId, geometry);
    try {
      this.storage.setItem(GEOMETRY_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.geometry)));
    } catch {
      // Layout persistence is best-effort; never let it break the session.
    }
    this.eventBus.emit("window:geometry-changed", { windowId: state.windowId, geometry });
  }

  _clampSize({ x, y, width, height }) {
    return {
      x,
      y,
      width: Math.max(MIN_WIDTH, Math.round(Number(width) || MIN_WIDTH)),
      height: Math.max(MIN_HEIGHT, Math.round(Number(height) || MIN_HEIGHT)),
    };
  }

  /**
   * Keep at least MIN_VISIBLE_MARGIN px of the titlebar reachable on every
   * edge, and never let the taskbar fully cover it vertically (mirrors the
   * old engine's Win95Window._clampLeft/_clampTop/_ensureVisible behaviour).
   */
  _clampPosition(x, y, width) {
    const viewport = this.getViewport();
    const minX = Number.isFinite(viewport.width) ? -(width - MIN_VISIBLE_MARGIN) : -Infinity;
    const maxX = Number.isFinite(viewport.width) ? viewport.width - MIN_VISIBLE_MARGIN : Infinity;
    const maxY = Number.isFinite(viewport.height) ? Math.max(0, viewport.height - TITLEBAR_HEIGHT) : Infinity;
    return {
      x: Math.round(Math.min(Math.max(x, minX), maxX)),
      y: Math.round(Math.min(Math.max(y, 0), maxY)),
    };
  }

  /** Every open window ordered by creation time (the taskbar ignores focus). */
  list() {
    return [...this.windows.values()].sort((a, b) => (a.openOrder ?? 0) - (b.openOrder ?? 0));
  }

  /** Deep-cloned snapshot of every open window instance (plan §12.2 "窗口实例、几何、最大化/最小化、打开的定义 ID") - a pure save boundary, no DOM/live references. */
  snapshotInstances() {
    return [...this.windows.values()].map((state) => ({
      ...state,
      parameters: structuredClone(Array.isArray(state.parameters) ? state.parameters : []),
    }));
  }

  /**
   * Replaces every open window instance from a save snapshot. Bypasses
   * `open()`'s definition-driven geometry defaults entirely, since each
   * snapshot entry already carries its own fully-resolved state; only
   * `SaveManager.restore()` should call this (plan §12.3 "恢复前停止当前
   * Runner...替换队列与实例 snapshot 后再恢复 Runner").
   */
  restoreInstances(instances = []) {
    if (!Array.isArray(instances)) throw new Error(t("error.59f7ad31a924"));
    const next = new Map();
    let maxSeq = _instanceIdCounter;
    for (const raw of instances) {
      if (!raw || typeof raw.instanceId !== "string" || typeof raw.windowId !== "string" || next.has(raw.instanceId)) {
        throw new Error(t("error.dd0667e62363"));
      }
      next.set(raw.instanceId, { ...raw, parameters: structuredClone(Array.isArray(raw.parameters) ? raw.parameters : []), openOrder: raw.openOrder ?? ++_openOrderCounter });
      _openOrderCounter = Math.max(_openOrderCounter, next.get(raw.instanceId).openOrder);
      const match = raw.instanceId.match(/^win-(\d+)$/);
      if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
    }
    this.windows = next;
    _instanceIdCounter = maxSeq;
  }
}

WindowManager.MIN_WIDTH = MIN_WIDTH;
WindowManager.MIN_HEIGHT = MIN_HEIGHT;

export default WindowManager;
