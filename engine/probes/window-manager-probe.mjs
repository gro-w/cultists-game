import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { WindowManager } from "../core/WindowManager.js";
import { PointerInteraction } from "../core/desktopPointerInteraction.js";

/** Minimal fake `window`-like target so PointerInteraction can be probed headlessly. */
class FakeTarget {
  constructor() {
    this._listeners = new Map();
  }
  addEventListener(name, handler) {
    if (!this._listeners.has(name)) this._listeners.set(name, new Set());
    this._listeners.get(name).add(handler);
  }
  removeEventListener(name, handler) {
    this._listeners.get(name)?.delete(handler);
  }
  listenerCount() {
    let count = 0;
    for (const set of this._listeners.values()) count += set.size;
    return count;
  }
  fire(name, payload) {
    for (const handler of [...(this._listeners.get(name) || [])]) handler(payload);
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  };
}

// --- Two windows: focus and z-index -----------------------------------------
{
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage: memoryStorage() });
  const a = wm.open({ windowId: "a", title: "A", x: 10, y: 10, width: 300, height: 200 });
  const b = wm.open({ windowId: "b", title: "B", x: 40, y: 40, width: 300, height: 200 });
  assert.ok(b.zIndex > a.zIndex, "second window opened is on top");
  assert.equal(wm.focusedInstanceId(), b.instanceId);
  wm.focus(a.instanceId);
  const refreshedA = wm.get(a.instanceId);
  assert.ok(refreshedA.zIndex > wm.get(b.instanceId).zIndex, "focusing A raises it above B");
  assert.equal(wm.focusedInstanceId(), a.instanceId);
}

// --- Window launch parameters update singletons and survive snapshots --------
{
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage: memoryStorage() });
  const definition = { windowId: "document", title: "Document", x: 0, y: 0, width: 300, height: 200 };
  const opened = wm.open(definition, { parameters: ["/home/desktop/first.txt"] });
  let parameterEvent = null;
  bus.on("window:parameters", (event) => { parameterEvent = event; });
  const reopened = wm.open(definition, { parameters: ["/home/desktop/second.txt"] });
  assert.equal(reopened.instanceId, opened.instanceId, "single-instance window reuse keeps the same instance");
  assert.deepEqual(reopened.parameters, ["/home/desktop/second.txt"]);
  assert.deepEqual(parameterEvent?.parameters, ["/home/desktop/second.txt"], "existing widget instances receive updated arguments");
  const restored = new WindowManager(new EventBus(), { storage: memoryStorage() });
  restored.restoreInstances(wm.snapshotInstances());
  assert.deepEqual(restored.get(opened.instanceId)?.parameters, ["/home/desktop/second.txt"], "window parameters survive save snapshots");
}

// --- Drag ends exactly at the pointer end position --------------------------
{
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage: memoryStorage() });
  const state = wm.open({ windowId: "drag-test", x: 100, y: 80, width: 300, height: 200 });
  const originX = state.x;
  const originY = state.y;
  const startX = 500;
  const startY = 300;
  const drag = new PointerInteraction(new FakeTarget());
  drag.start({
    onMove: (event) => {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      wm.moveTo(state.instanceId, originX + dx, originY + dy);
    },
  });
  drag.target.fire("pointermove", { clientX: 560, clientY: 340 });
  const moved = wm.get(state.instanceId);
  assert.equal(moved.x, originX + 60, "x equals pointer end position");
  assert.equal(moved.y, originY + 40, "y equals pointer end position");
  drag.cancel();
}

// --- Resize clamps to the documented minimums --------------------------------
{
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage: memoryStorage() });
  const state = wm.open({ windowId: "resize-test", width: 300, height: 200 });
  wm.resize(state.instanceId, 10, 10);
  const resized = wm.get(state.instanceId);
  assert.equal(resized.width, WindowManager.MIN_WIDTH);
  assert.equal(resized.height, WindowManager.MIN_HEIGHT);
}

// --- Close/restore: pointer interaction leaks no listeners -------------------
{
  const target = new FakeTarget();
  const drag = new PointerInteraction(target);
  drag.start({ onMove: () => {} });
  assert.equal(target.listenerCount(), 2, "pointermove + pointerup registered while dragging");
  // Simulate the window closing mid-drag (WindowFrame.dispose() calls cancel()).
  drag.cancel();
  assert.equal(target.listenerCount(), 0, "cancel() removes every listener even without pointerup");

  drag.start({ onMove: () => {} });
  target.fire("pointerup", {});
  assert.equal(target.listenerCount(), 0, "a normal pointerup also leaves no listeners behind");
}

// --- EventBus subscriptions used by WindowFrame don't leak either -----------
{
  const bus = new EventBus();
  const unsubscribe = bus.on("window:focused", () => {});
  assert.equal(bus.listenerCount(), 1);
  unsubscribe();
  assert.equal(bus.listenerCount(), 0, "unsubscribing on close leaves no dangling handlers");
}

// --- x/y = 0 must still be saved and restored (no falsy-coalescing bugs) ----
{
  const storage = memoryStorage();
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage });
  const state = wm.open({ windowId: "zero-test", x: 0, y: 0, width: 300, height: 200 });
  assert.equal(state.x, 0);
  assert.equal(state.y, 0);
  wm.persistGeometry(state.instanceId);

  // A fresh manager reading the same storage must recover the exact 0/0 geometry.
  const wm2 = new WindowManager(new EventBus(), { storage });
  const saved = wm2.getSavedGeometry("zero-test");
  assert.equal(saved.x, 0, "x=0 survives persistence");
  assert.equal(saved.y, 0, "y=0 survives persistence");
}

// --- Drag clamping: titlebar can never be fully dragged off-desktop or fully
// hidden behind the taskbar (viewport 800x600, taskbar excluded already) ----
{
  const bus = new EventBus();
  const viewport = { width: 800, height: 570 }; // 600 - 30px taskbar, matches defaultViewport's convention
  const wm = new WindowManager(bus, { storage: memoryStorage(), getViewport: () => viewport });
  const state = wm.open({ windowId: "clamp-test", x: 100, y: 100, width: 300, height: 200 });

  wm.moveTo(state.instanceId, -10000, -10000);
  let clamped = wm.get(state.instanceId);
  assert.ok(clamped.x > -300, "left edge keeps at least 48px of titlebar reachable");
  assert.equal(clamped.y, 0, "top clamps to 0");

  wm.moveTo(state.instanceId, 10000, 10000);
  clamped = wm.get(state.instanceId);
  assert.ok(clamped.x < 800, "right edge keeps at least 48px of titlebar reachable");
  assert.ok(clamped.y <= viewport.height - 20, "titlebar never fully covered by the taskbar");

  // Opening a window near the desktop edge is clamped up front too.
  const edgeState = wm.open({ windowId: "clamp-open-test", x: -9999, y: 9999, width: 300, height: 200 });
  assert.ok(edgeState.x > -300);
  assert.ok(edgeState.y <= viewport.height - 20);

  // Unmaximizing must re-clamp in case the viewport shrank while maximized.
  wm.moveTo(state.instanceId, 700, 500);
  wm.maximize(state.instanceId);
  viewport.width = 400;
  viewport.height = 300;
  wm.unmaximize(state.instanceId);
  const restored = wm.get(state.instanceId);
  assert.ok(restored.x < 400, "unmaximize re-clamps x to the current viewport");
  assert.ok(restored.y <= viewport.height - 20, "unmaximize re-clamps y to the current viewport");
}

// --- icon flows from the window definition through to WindowManager state --
{
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage: memoryStorage() });
  const withIcon = wm.open({ windowId: "icon-test", title: "Icon", icon: "📄", width: 300, height: 200 });
  assert.equal(withIcon.icon, "📄");
  const withoutIcon = wm.open({ windowId: "no-icon-test", title: "No Icon", width: 300, height: 200 });
  assert.equal(withoutIcon.icon, null, "icon defaults to null when the definition doesn't provide one");
}

// --- window definitions using `id` (the WindowDefinitionStore key) instead of
// an explicit `windowId` field still resolve correctly ----------------------
{
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage: memoryStorage() });
  const state = wm.open({ id: "example", title: "示例窗口", width: 300, height: 200 });
  assert.equal(state.windowId, "example");
  assert.equal(wm.getByWindowId("example")?.instanceId, state.instanceId);
}

// --- fullscreen windows (plan §7.4): geometry snaps to the full viewport,
// they are not resizable, and drag/resize are no-ops -------------------------
{
  const bus = new EventBus();
  const viewport = { width: 1024, height: 738 };
  const wm = new WindowManager(bus, { storage: memoryStorage(), getViewport: () => viewport });
  const state = wm.open({ id: "off-duty", title: "下班模式", fullscreen: true, width: 480, height: 320 });
  assert.equal(state.fullscreen, true);
  assert.equal(state.resizable, false);
  assert.deepEqual({ x: state.x, y: state.y, width: state.width, height: state.height }, { x: 0, y: 0, width: 1024, height: 738 });

  // Dragging/resizing a fullscreen window is meaningless; moveTo/resize still
  // work at the WindowManager layer (WindowFrame is what actually gates the
  // gesture via `state.fullscreen`), but geometry stays sane either way.
  wm.moveTo(state.instanceId, 999, 999);
  const moved = wm.get(state.instanceId);
  assert.ok(Number.isFinite(moved.x) && Number.isFinite(moved.y));

  // Opening the same fullscreen window twice (singleInstance) must still
  // just focus/return the existing instance, never spawn a second one.
  const reopened = wm.open({ id: "off-duty", title: "下班模式", fullscreen: true });
  assert.equal(reopened.instanceId, state.instanceId);
}

console.log("ng window-manager probe: ok");
