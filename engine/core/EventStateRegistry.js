/**
 * Generic data-driven event-state registry.
 * Core owns persistence and event routing; Framework supplies definitions and
 * chooses the event names. No tutorial, dialogue, or game domain is encoded.
 */
export class EventStateRegistry {
  constructor({ eventBus, events = {}, stateKeys = {} } = {}) {
    this.eventBus = eventBus;
    this.events = { changed: "state:changed", request: "state:request", close: "state:close", ...events };
    this.stateKeys = { marked: "marked", requested: "requested", dismissed: "dismissed", ...stateKeys };
    this.definitions = new Map();
    this.marked = new Set();
    this.requested = new Set();
    this.dismissed = new Set();
    this.enabled = true;
    this._triggerUnsubscribers = [];
  }
  loadDefinitions(definitions = []) {
    this.definitions = new Map((Array.isArray(definitions) ? definitions : []).filter((item) => item && typeof item.id === "string").map((item) => [item.id, item]));
  }
  bindTriggers(triggers = {}) {
    this._triggerUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this._triggerUnsubscribers = Object.entries(triggers || {}).map(([eventName, stateId]) =>
      this.eventBus?.on(eventName, () => this.mark(stateId)) || (() => {}));
    return () => {
      this._triggerUnsubscribers.forEach((unsubscribe) => unsubscribe());
      this._triggerUnsubscribers = [];
    };
  }
  list() { return [...this.definitions.values()]; }
  has(id) { return this.marked.has(id); }
  mark(id) {
    if (!id) return false;
    const isNew = !this.marked.has(id);
    this.marked.add(id);
    if (!isNew || !this.enabled) return isNew;
    this.eventBus?.emit(this.events.changed, this.snapshot());
    this.definitions.forEach((definition) => {
      if (definition.completeOn === id && this.requested.has(definition.id) && !this.dismissed.has(definition.id)) this.close(definition.id);
    });
    this.definitions.forEach((definition) => {
      if (definition.trigger === id && !this.requested.has(definition.id) && !this.dismissed.has(definition.id)) {
        this.requested.add(definition.id);
        this.eventBus?.emit(this.events.request, { ...definition });
      }
    });
    return isNew;
  }
  close(id) { this.eventBus?.emit(this.events.close, { id }); }
  dismiss(id) { if (!this.definitions.has(id)) return; this.dismissed.add(id); this.close(id); this.eventBus?.emit(this.events.changed, this.snapshot()); }
  acknowledge(id) { this.close(id); }
  setEnabled(enabled) { this.enabled = Boolean(enabled); this.eventBus?.emit(this.events.changed, this.snapshot()); }
  snapshot() { return { enabled: this.enabled, [this.stateKeys.marked]: [...this.marked], [this.stateKeys.requested]: [...this.requested], [this.stateKeys.dismissed]: [...this.dismissed] }; }
  restore(state = {}) { this.enabled = state.enabled !== false; this.marked = new Set(state[this.stateKeys.marked] || state.marked || state.milestones || []); this.requested = new Set(state[this.stateKeys.requested] || state.requested || state.shownHintIds || []); this.dismissed = new Set(state[this.stateKeys.dismissed] || state.dismissed || state.dismissedHintIds || []); }
  // Compatibility aliases are generic state operations, not domain behavior.
  markMilestone(id) { this.mark(id); }
  hasMilestone(id) { return this.has(id); }
  loadHints(value) { this.loadDefinitions(value); }
  dismissHint(id) { this.dismiss(id); }
  acknowledgeHint(id) { this.acknowledge(id); }
}
export default EventStateRegistry;
