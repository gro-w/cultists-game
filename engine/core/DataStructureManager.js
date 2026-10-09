import { t } from "./i18n/index.js";
/**
 * DataStructureManager - plan §9.2's "结构 schema": a registry of
 * data-structure definitions (field name/type/required/default), used to
 * validate and apply defaults to records before `DataStore` writes them.
 * Deliberately domain-agnostic (plan §15 风险 F): items, medical records,
 * dialogue contexts etc. are all just registered structures + database
 * records, never a new engine-level type.
 *
 * Supported field types (plan §9.2, first version):
 *   bool, smallInteger, integer, real, string, objectRef, array, object
 * `array<T>` may be written as the field's `type` (e.g. "array<string>") to
 * additionally validate each element's type; a bare "array" accepts any
 * element type. `object` accepts any plain (non-array) JSON object -
 * for content whose internal shape is itself data-defined (e.g. a legacy
 * achievement's free-form `trigger` descriptor), not a new engine concept,
 * just a scalar type as domain-agnostic as `array`'s "accept anything".
 */
const SCALAR_VALIDATORS = {
  bool: (value) => typeof value === "boolean",
  smallInteger: (value) => Number.isInteger(value),
  integer: (value) => Number.isInteger(value),
  real: (value) => typeof value === "number" && Number.isFinite(value),
  string: (value) => typeof value === "string",
  // objectRef only requires a stable reference id (string) to some other
  // registered domain (activity instance, queue, structure record, global
  // variable, window instance, ...); resolving that reference is the
  // caller's concern, not the structure manager's.
  objectRef: (value) => typeof value === "string" && value.length > 0,
  object: (value) => typeof value === "object" && value !== null && !Array.isArray(value),
};

function parseArrayItemType(type) {
  const match = /^array<(.+)>$/.exec(type || "");
  return match ? match[1] : null;
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function defaultValueFor(field) {
  if (Object.prototype.hasOwnProperty.call(field, "default")) return clone(field.default);
  if (field.type === "bool") return false;
  if (field.type === "smallInteger" || field.type === "integer") return 0;
  if (field.type === "real") return 0;
  if (field.type === "string") return "";
  if (field.type === "array" || parseArrayItemType(field.type)) return [];
  if (field.type === "object") return {};
  if (field.type === "activity") return {};
  return null;
}

function isActivityBlueprint(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && value.nodes && typeof value.nodes === "object");
}

function isEmbeddedActivityValue(value) {
  if (isActivityBlueprint(value)) return true;
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value).every(isActivityBlueprint));
}

export class DataStructureManager {
  constructor() {
    this.structures = new Map();
  }

  /** Registers (or replaces) a structure definition; returns the stored definition. */
  register(definition) {
    if (!definition?.id) throw new Error(t("error.8238fd728d4a"));
    if (!Array.isArray(definition.fields)) throw new Error(`Structure "${definition.id}" must declare a \`fields\` array`);
    for (const field of definition.fields) {
      if (!field?.id) throw new Error(`Structure "${definition.id}" has a field with no \`id\``);
      const itemType = parseArrayItemType(field.type);
      if (!SCALAR_VALIDATORS[field.type] && field.type !== "array" && field.type !== "activity" && !itemType) {
        throw new Error(`Structure "${definition.id}" field "${field.id}" has unknown type "${field.type}"`);
      }
    }
    this.structures.set(definition.id, definition);
    return definition;
  }

  get(id) {
    return this.structures.get(id) || null;
  }

  list() {
    return [...this.structures.values()];
  }

  unregister(id) {
    return this.structures.delete(id);
  }

  /** Loads an array of structure definitions (e.g. fetched from data/structures.framework.json) - plan §9.2's "结构 schema" is authored as game data, not engine code. */
  loadDefinitions(definitions = []) {
    definitions.forEach((definition) => this.register(definition));
  }

  /** Plain-array snapshot for save/persist (mirrors `data/structures.framework.json`'s top-level array shape). */
  toJSON() {
    return this.list();
  }

  /** Returns a new record with every field present, unset fields filled from `field.default` (or a type-appropriate zero value). */
  applyDefaults(structureId, record = {}) {
    const structure = this.get(structureId);
    if (!structure) throw new Error(`Unknown structure: ${structureId}`);
    const result = { ...record };
    for (const field of structure.fields) {
      if (!Object.prototype.hasOwnProperty.call(result, field.id) || result[field.id] === undefined) {
        result[field.id] = defaultValueFor(field);
      }
    }
    return result;
  }

  /** Validates a record against a structure's field types/required flags. Never mutates `record`. Returns { ok, errors }. */
  validateRecord(structureId, record = {}) {
    const structure = this.get(structureId);
    if (!structure) return { ok: false, errors: [`${t("legacy.528e4841bf64")}: ${structureId}`] };
    const errors = [];
    for (const field of structure.fields) {
      const value = record[field.id];
      const present = value !== undefined && value !== null;
      if (!present) {
        if (field.required) errors.push(`${t("legacy.7cf814385877")}${field.id} ${t("legacy.bd01b67cff18")}`);
        continue;
      }
      const itemType = parseArrayItemType(field.type);
      if (field.type === "activity") {
        if (!isEmbeddedActivityValue(value)) errors.push(`${t("legacy.7cf814385877")}${field.id} ${t("legacy.319566b285d6")}Activity blueprint ${t("legacy.9328a8532ede")}Activity ${t("legacy.43353e0245e0")}`);
        continue;
      }
      if (itemType || field.type === "array") {
        if (!Array.isArray(value)) {
          errors.push(`${t("legacy.7cf814385877")}${field.id} ${t("legacy.ae5def43e0de")}`);
        } else if (itemType) {
          const validator = SCALAR_VALIDATORS[itemType];
          value.forEach((item, index) => {
            if (validator && !validator(item)) errors.push(`${t("legacy.7cf814385877")}${field.id}[${index}] ${t("legacy.a3943eecebe8")}${itemType}`);
          });
        }
        continue;
      }
      const validator = SCALAR_VALIDATORS[field.type];
      if (validator && !validator(value)) errors.push(`${t("legacy.7cf814385877")}${field.id} ${t("legacy.a3943eecebe8")}${field.type}`);
    }
    return { ok: errors.length === 0, errors };
  }
}

export default DataStructureManager;
