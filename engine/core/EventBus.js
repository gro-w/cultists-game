/**
 * EventBus - minimal publish/subscribe hub used across ng/ so modules never
 * reach into each other's internals. Mirrors the old engine's js/core/EventBus.js
 * contract (on/once/off/emit with an unsubscribe function returned from on/once).
 */
class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const wrapped = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(event);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    /* DEV-TOOLS:START */
    const performanceSamples = event === "variable:changed" && globalThis.__cultistsPerformanceSamples;
    const dispatchStartedAt = Array.isArray(performanceSamples) ? globalThis.performance.now() : null;
    const listenerCount = set.size;
    /* DEV-TOOLS:END */
    [...set].forEach((handler) => {
      /* DEV-TOOLS:START */
      const handlerStartedAt = Array.isArray(performanceSamples) ? globalThis.performance.now() : null;
      /* DEV-TOOLS:END */
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] handler error for "${event}":`, err);
      } finally {
        /* DEV-TOOLS:START */
        if (Array.isArray(performanceSamples) && Number.isFinite(handlerStartedAt)) {
          performanceSamples.push({
            name: "event-bus-listener",
            event,
            listenerLabel: handler.__cultistsPerformanceLabel || handler.name || "anonymous",
            durationMs: globalThis.performance.now() - handlerStartedAt,
          });
        }
        /* DEV-TOOLS:END */
      }
    });
    /* DEV-TOOLS:START */
    if (Array.isArray(performanceSamples) && Number.isFinite(dispatchStartedAt)) {
      performanceSamples.push({
        name: "event-bus-dispatch",
        event,
        listenerCount,
        durationMs: globalThis.performance.now() - dispatchStartedAt,
      });
    }
    /* DEV-TOOLS:END */
  }

  /** Total number of registered handlers across every event (used by probes/tests). */
  listenerCount() {
    let count = 0;
    for (const set of this._listeners.values()) count += set.size;
    return count;
  }
}

export const eventBus = new EventBus();
export default EventBus;
