import { t } from "./i18n/index.js";
/**
 * PublicVariableManager - plan §10 "公共变量管理器": a registry of typed,
 * ID-addressed public variables (distinct from the generic per-Activity
 * `VariableStore` used by `setVariable`/`getVariable`/`blockUntil`, which
 * is scoped to proving out the Phase 2 Activity engine - see
 * VariableStore.js's own doc comment). IDs are the stable, persistent
 * identity (0..65535, unique, non-negative integer); everything else about
 * a variable (name/type/bounds/persistence/description) lives in its
 * definition, loaded as game data, never hardcoded here (plan §15 风险 F -
 * no project-specific reserved ID ranges baked into the engine).
 *
 * Object-typed variables never hold a live object reference directly:
 * only a `{objectType, objectId}` ref is stored/persisted, resolved
 * on-demand through a `RuntimeRefResolver` (see RuntimeRefResolver.js).
 * An unresolvable ref surfaces as an explicit `{resolved:false}` result,
 * never silently falling back to some other object.
 */
const TYPES = new Set(["bool", "smallInteger", "integer", "real", "string", "object", "json"]);
const COMPARISON_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte"]);
const MIN_ID = 0;
const MAX_ID = 65535;
const SMALL_INTEGER_MIN = 0;
const SMALL_INTEGER_MAX = 255;

function isValidId(id) {
  return Number.isInteger(id) && id >= MIN_ID && id <= MAX_ID;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObjectRef(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "objectType" in value && "objectId" in value);
}

export class PublicVariableManager {
  /** @param {import('./RuntimeRefResolver.js').RuntimeRefResolver} [refResolver] */
  constructor(refResolver, eventBus) {
    this.refResolver = refResolver || null;
    this.eventBus = eventBus || null;
    this.definitions = new Map(); // id -> definition
    this.values = new Map(); // id -> coerced value (or {objectType,objectId}/null for "object")
    this.syncSources = new Map();
  }

  /** Registers (or re-registers) one variable definition; returns the stored definition. Throws on invalid id/type/duplicate id. */
  register(raw) {
    const id = Number(raw?.id);
    if (!isValidId(id)) throw new Error(`Global variable id must be an integer 0..${MAX_ID}, got ${raw?.id}`);
    if (!TYPES.has(raw?.type)) throw new Error(`Global variable ${id} has unknown type "${raw?.type}"`);
    if (this.definitions.has(id)) throw new Error(`Global variable ${id} already registered`);
    const definition = {
      id,
      name: raw.name || `variable-${id}`,
      type: raw.type,
      min: raw.min,
      max: raw.max,
      maxLength: raw.maxLength,
      persistent: raw.persistent !== false,
      readOnly: Boolean(raw.readOnly),
      objectTarget: raw.objectTarget || null,
      // Declarative hook (plan-compatible extension, not a new engine concept):
      // content data may mark a variable as mirroring some other generic
      // engine signal (currently only "gameClock.totalMinutes" is wired, in
      // engine.js) - the manager itself does not interpret this value.
      syncSource: raw.syncSource || null,
      description: raw.description || "",
    };
    this.definitions.set(id, definition);
    const initial = Object.prototype.hasOwnProperty.call(raw, "defaultValue") ? raw.defaultValue : this._defaultValueFor(definition);
    this.values.set(id, this._coerce(definition, initial));
    return definition;
  }

  /** Bulk-registers an array of definitions (e.g. fetched from a data/*.json file) - plan §10.2's schema is authored as game data. */
  loadDefinitions(definitions = []) {
    definitions.forEach((definition) => this.register(definition));
  }

  registerSyncSource(sourceId, read) {
    if (!sourceId || typeof read !== "function") throw new Error(t("error.7664f0b3f52f"));
    this.syncSources.set(sourceId, read);
    this.syncFromSources();
  }

  syncFromSources() {
    for (const definition of this.definitions.values()) {
      if (!definition.syncSource || !this.syncSources.has(definition.syncSource)) continue;
      const next = this._coerce(definition, this.syncSources.get(definition.syncSource)());
      const previous = this.values.get(definition.id);
      if (Object.is(previous, next)) continue;
      this.values.set(definition.id, next);
      this.eventBus?.emit("variable:changed", { id: definition.id, name: definition.name, previous, value: next, source: definition.syncSource });
    }
  }

  unregister(id) {
    const normalized = Number(id);
    this.values.delete(normalized);
    return this.definitions.delete(normalized);
  }

  definition(id) {
    return this.definitions.get(Number(id)) || null;
  }

  list() {
    return [...this.definitions.values()];
  }

  /** Plain-array snapshot of every *definition* (not values) - mirrors a `data/public-variables.framework.json` top-level array shape. */
  toJSON() {
    return this.list();
  }

  _defaultValueFor(definition) {
    if (definition.type === "bool") return false;
    if (definition.type === "smallInteger" || definition.type === "integer") return 0;
    if (definition.type === "real") return 0;
    if (definition.type === "string") return "";
    if (definition.type === "json") return {};
    return null; // object
  }

  _coerce(definition, value) {
    if (definition.type === "bool") {
      if (typeof value !== "boolean") throw new Error(`Global variable ${definition.id} (bool) requires a boolean, got ${JSON.stringify(value)}`);
      return value;
    }
    if (definition.type === "smallInteger") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < SMALL_INTEGER_MIN || n > SMALL_INTEGER_MAX) {
        throw new Error(`Global variable ${definition.id} (smallInteger) must be an integer 0..255, got ${JSON.stringify(value)}`);
      }
      return n;
    }
    if (definition.type === "integer") {
      const n = Number(value);
      if (!Number.isInteger(n) || !Number.isSafeInteger(n)) {
        throw new Error(`Global variable ${definition.id} (integer) must be a safe integer, got ${JSON.stringify(value)}`);
      }
      const min = definition.min !== undefined ? definition.min : Number.MIN_SAFE_INTEGER;
      const max = definition.max !== undefined ? definition.max : Number.MAX_SAFE_INTEGER;
      if (n < min || n > max) throw new Error(`Global variable ${definition.id} (integer) must be within ${min}..${max}, got ${n}`);
      return n;
    }
    if (definition.type === "real") {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`Global variable ${definition.id} (real) must be a finite number, got ${JSON.stringify(value)}`);
      const min = definition.min !== undefined ? definition.min : -Infinity;
      const max = definition.max !== undefined ? definition.max : Infinity;
      if (n < min || n > max) throw new Error(`Global variable ${definition.id} (real) must be within ${min}..${max}, got ${n}`);
      return n;
    }
    if (definition.type === "string") {
      if (typeof value !== "string") throw new Error(`Global variable ${definition.id} (string) requires a string, got ${JSON.stringify(value)}`);
      if (definition.maxLength !== undefined && value.length > definition.maxLength) {
        throw new Error(`Global variable ${definition.id} (string) exceeds maxLength ${definition.maxLength}`);
      }
      return value;
    }
    if (definition.type === "json") {
      if (!value || typeof value !== "object") throw new Error(`Global variable ${definition.id} (json) requires an object or array`);
      return clone(value);
    }
    // object: null (unset) or a {objectType, objectId} reference; never a live object.
    if (value === null || value === undefined) return null;
    if (!isPlainObjectRef(value)) throw new Error(`Global variable ${definition.id} (object) requires a {objectType, objectId} ref or null`);
    return { objectType: value.objectType, objectId: value.objectId };
  }

  /** Raw stored value (for "object" type this is the `{objectType,objectId}` ref itself, or null - never a resolved live object). */
  get(id) {
    const definition = this.definition(id);
    if (!definition) throw new Error(`Unknown global variable: ${id}`);
    return clone(this.values.get(definition.id));
  }

  /** Resolves an "object"-typed variable's ref through the configured RuntimeRefResolver. Always `{resolved:false, value:null}` for an unset/invalid ref or missing resolver - never silently returns some other object. */
  resolveObject(id) {
    const definition = this.definition(id);
    if (!definition) throw new Error(`Unknown global variable: ${id}`);
    if (definition.type !== "object") throw new Error(`Global variable ${id} is not of type "object"`);
    const ref = this.values.get(definition.id);
    if (!ref || !this.refResolver) return { resolved: false, value: null };
    return this.refResolver.resolve(ref);
  }

  set(id, value, { emit = true } = {}) {
    const definition = this.definition(id);
    if (!definition) throw new Error(`Unknown global variable: ${id}`);
    if (definition.readOnly) throw new Error(`Global variable ${id} is read-only`);
    const next = this._coerce(definition, value);
    const previous = this.values.get(definition.id);
    this.values.set(definition.id, next);
    if (emit) this.eventBus?.emit("variable:changed", { id: definition.id, name: definition.name, previous, value: next });
    return next;
  }

  /** Sets an "object"-typed variable's ref directly (plan §10.3 effect `setObjectRef`); `ref` must be `{objectType, objectId}` or null to clear. */
  setObjectRef(id, ref, options) {
    return this.set(id, ref, options);
  }

  /** Numeric delta, restricted to smallInteger/integer/real per plan §10.3 ("delta（仅整数/实数）"). */
  increment(id, delta, options) {
    const definition = this.definition(id);
    if (!definition || !["smallInteger", "integer", "real"].includes(definition.type)) {
      throw new Error(`Only numeric global variables can be incremented: ${id}`);
    }
    return this.set(id, Number(this.values.get(definition.id)) + Number(delta), options);
  }

  /** Flips a bool variable (plan §10.3 effect `toggle`). */
  toggle(id, options) {
    const definition = this.definition(id);
    if (!definition || definition.type !== "bool") throw new Error(`Only bool global variables can be toggled: ${id}`);
    return this.set(id, !this.values.get(definition.id), options);
  }

  /**
   * Generic condition evaluation (plan §10.3): `{all:[...]}`, `{any:[...]}`,
   * `{not:{...}}` compose recursively; a leaf is `{id, op, value}` with
   * `op` one of eq/neq/gt/gte/lt/lte (default "eq").
   */
  evaluateCondition(condition) {
    if (!condition) return true;
    if (Array.isArray(condition)) return condition.every((item) => this.evaluateCondition(item));
    if (condition.all) return condition.all.every((item) => this.evaluateCondition(item));
    if (condition.any) return condition.any.some((item) => this.evaluateCondition(item));
    if (condition.not) return !this.evaluateCondition(condition.not);
    const definition = this.definition(condition.id);
    if (!definition) return false;
    const actual = this.values.get(definition.id);
    const operator = condition.op || "eq";
    if (!COMPARISON_OPERATORS.has(operator)) return false;
    let expected = condition.value;
    try {
      expected = definition.type === "object" ? condition.value : this._coerce(definition, condition.value);
    } catch {
      return false; // a type-mismatched expected value can never match - "类型安全比较"
    }
    switch (operator) {
      case "eq": return actual === expected || (isPlainObjectRef(actual) && isPlainObjectRef(expected) && actual.objectType === expected.objectType && actual.objectId === expected.objectId);
      case "neq": return !this.evaluateCondition({ ...condition, op: "eq" });
      case "gt": return actual > expected;
      case "gte": return actual >= expected;
      case "lt": return actual < expected;
      case "lte": return actual <= expected;
      default: return false;
    }
  }

  /** Generic effect application (plan §10.3): `set`/`delta`/`toggle`/`setObjectRef`. `append`/`remove` are left to structure-defined array fields (DataStore), not public variables. */
  applyEffect(effect) {
    if (!effect || effect.id === undefined) return;
    const { id } = effect;
    if (Object.prototype.hasOwnProperty.call(effect, "value")) this.set(id, effect.value);
    else if (Object.prototype.hasOwnProperty.call(effect, "delta")) this.increment(id, effect.delta);
    else if (effect.toggle) this.toggle(id);
    else if (Object.prototype.hasOwnProperty.call(effect, "setObjectRef")) this.setObjectRef(id, effect.setObjectRef);
  }

  applyEffects(effects = []) {
    effects.forEach((effect) => this.applyEffect(effect));
  }

  /** `{id: value}` snapshot of every *persistent* variable's raw stored value (object variables snapshot as their ref, never a live object) - plan §12.2 "公共变量值". */
  snapshot() {
    const out = {};
    for (const definition of this.definitions.values()) {
      if (!definition.persistent) continue;
      out[definition.id] = clone(this.values.get(definition.id));
    }
    return out;
  }

  restore(snapshot = {}) {
    for (const definition of this.definitions.values()) {
      this.values.set(definition.id, this._defaultValueFor(definition));
    }
    for (const [rawId, value] of Object.entries(snapshot || {})) {
      const id = Number(rawId);
      if (this.definitions.has(id)) {
        try { this.set(id, value, { emit: false }); } catch { /* stale/incompatible saved value: keep the definition's default rather than throwing away the whole restore */ }
      }
    }
    this.eventBus?.emit("variable:changed", this.snapshot());
  }
}

export default PublicVariableManager;
