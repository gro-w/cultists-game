import { t } from "./i18n/index.js";
/**
 * LocalVariableManager owns names/types for Activity-local variables only.
 * Values never live here: each Activity instance owns its own localVariables
 * object, so two instances can use the same definition without sharing state.
 */
const TYPES = new Set(["bool", "integer", "real", "string", "json"]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class LocalVariableManager {
  constructor(eventBus) {
    this.eventBus = eventBus || null;
    this.definitions = new Map();
  }

  register(raw = {}) {
    const id = String(raw.id ?? "").trim();
    if (!id) throw new Error(t("error.9170f3080c58"));
    if (!TYPES.has(raw.type)) throw new Error(`Local variable ${id} has unknown type "${raw.type}"`);
    if (this.definitions.has(id)) throw new Error(`Local variable ${id} already registered`);
    const definition = {
      id,
      name: raw.name || id,
      type: raw.type,
      defaultValue: clone(raw.defaultValue ?? this.defaultValue(raw.type)),
      description: raw.description || "",
    };
    this.definitions.set(id, definition);
    return definition;
  }

  loadDefinitions(definitions = []) {
    definitions.forEach((definition) => this.register(definition));
  }

  definition(id) { return this.definitions.get(String(id)) || null; }
  list() { return [...this.definitions.values()]; }
  toJSON() { return this.list().map((definition) => ({ ...definition, defaultValue: clone(definition.defaultValue) })); }

  resolveKey(key) {
    const normalized = String(key);
    return this.definitions.has(normalized) ? this.definitions.get(normalized).id : normalized;
  }

  defaultValue(type) {
    if (type === "bool") return false;
    if (type === "integer" || type === "real") return 0;
    if (type === "string") return "";
    return {};
  }

  unregister(id) { return this.definitions.delete(String(id)); }
}

export default LocalVariableManager;