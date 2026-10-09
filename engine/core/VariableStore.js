/**
 * VariableStore - a minimal, generic key/value store used by the Phase 2
 * Activity runtime's `setVariable`/`blockUntil` nodes. This is deliberately
 * NOT the typed public-variable system (0..65535 IDs, bool/smallInteger/
 * integer/real/string/object) described for Phase 6 — it is a stand-in
 * scoped to proving out the generic Activity engine, and is expected to be
 * superseded by `PublicVariableManager` once that phase lands.
 */
export class VariableStore {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.values = new Map();
  }

  get(key) {
    return this.values.has(key) ? this.values.get(key) : undefined;
  }

  set(key, value) {
    this.values.set(key, value);
    this.eventBus?.emit("variable:changed", { key, value });
  }

  delta(key, amount) {
    const current = Number(this.values.get(key)) || 0;
    this.set(key, current + (Number(amount) || 0));
  }

  snapshot({ include = null } = {}) {
    return Object.fromEntries([...this.values].filter(([key, value]) => !include || include(key, value)));
  }

  restore(data = {}, { preserve = [] } = {}) {
    const preserved = new Map(preserve.map((key) => [key, this.values.get(key)]).filter(([, value]) => value !== undefined));
    this.values = new Map([...Object.entries(data), ...preserved]);
  }
}

export default VariableStore;
