import assert from "node:assert/strict";
import { WindowFrame } from "../core/desktopWindowFrame.js";

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const scheduledFrames = [];
globalThis.requestAnimationFrame = (callback) => scheduledFrames.push(callback);
try {
  const frame = Object.create(WindowFrame.prototype);
  frame._root = {};
  frame._disposed = false;
  frame._rootRefreshScheduled = false;
  frame._unsubscribers = [];
  const listeners = new Map();
  frame.eventBus = {
    on(event, listener) {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
  };
  let renders = 0;
  frame._rerenderRoot = () => { renders += 1; };

  frame._bindRootRefresh();
  for (let index = 0; index < 1000; index += 1) {
    for (const listener of listeners.values()) listener();
  }
  assert.equal(scheduledFrames.length, 1, "all invalidations in one frame should queue one DOM rebuild");
  assert.equal(renders, 0, "DOM rebuild must wait until the browser's next frame");
  scheduledFrames.shift()();
  assert.equal(renders, 1);

  frame._scheduleRootRefresh();
  assert.equal(scheduledFrames.length, 1, "a later frame must still be allowed to refresh");
  frame._disposed = true;
  frame._root = null;
  scheduledFrames.shift()();
  assert.equal(renders, 1, "a scheduled frame must not touch a disposed window");
  console.log("window-frame-refresh-coalescing-probe: 1000 invalidations → 1 frame render; disposed frames ignored");
} finally {
  if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
}
