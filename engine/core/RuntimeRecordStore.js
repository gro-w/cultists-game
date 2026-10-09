import { t } from "./i18n/index.js";
export class RuntimeRecordStore {
  constructor({ eventBus, eventPrefix = "runtime" } = {}) { this.eventBus = eventBus; this.eventPrefix = eventPrefix; this.definitions = new Map(); this.records = new Map(); }
  loadDefinitions(definitions = []) { for (const definition of definitions) { if (definition?.id != null) this.definitions.set(String(definition.id), structuredClone(definition)); } return this.definitions.size; }
  define(definition) { if (!definition?.id) throw new Error(t("error.5fe41c8bbd9c")); this.definitions.set(String(definition.id), structuredClone(definition)); return definition; }
  getDefinition(id) { return this.definitions.get(String(id)) || null; }
  set(id, value = {}) { const key = String(id); const current = this.records.get(key) || {}; const next = { ...current, ...structuredClone(value), id: key }; this.records.set(key, next); this.eventBus?.emit(`${this.eventPrefix}:changed`, { id: key, value: structuredClone(next) }); return next; }
  get(id) { const value = this.records.get(String(id)); return value ? structuredClone(value) : null; }
  delete(id) { return this.records.delete(String(id)); }
  snapshot() { return { definitions: [...this.definitions.values()].map((value) => structuredClone(value)), records: [...this.records.values()].map((value) => structuredClone(value)) }; }
  restore(snapshot = {}) { this.definitions.clear(); this.records.clear(); this.loadDefinitions(snapshot.definitions || []); for (const record of snapshot.records || []) this.set(record.id, record); }
}
export default RuntimeRecordStore;
