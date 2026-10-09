import { t } from "./i18n/index.js";
import { decodeCl2Blueprints } from "./Cl2Embedded.js";
/**
 * DataStore - plan §9.3's "数据库": in-memory record collections keyed by
 * `databaseId`, validated against a `DataStructureManager` structure on
 * every write. All access is meant to happen exclusively through the
 * blueprint API nodes (`createRecord`/`getRecord`/`updateRecord`/
 * `deleteRecord`/`findRecords`/`countRecords` in ActivityNodeRegistry.js) -
 * "不能在 UI 中直接改数据库绕过 API" - so every mutating method here
 * validates and every read returns a deep clone, never the live record, to
 * make accidental bypass-the-API mutation impossible even from dev tools.
 */
function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function matchesQuery(record, query) {
  if (!query || typeof query !== "object") return true;
  return Object.entries(query).every(([field, expected]) => record[field] === expected);
}

export class DataStore {
  /** @param {import('./DataStructureManager.js').DataStructureManager} dataStructureManager */
  constructor(dataStructureManager) {
    this.dataStructureManager = dataStructureManager;
    this.databases = new Map(); // databaseId -> { recordType, primaryKey, allowDelete, records: Map, seq }
  }

  registerDatabase({ databaseId, recordType, primaryKey = "id", allowDelete = true, recordFile = "seed-records.json" }) {
    if (!databaseId) throw new Error(t("error.501444e950dc"));
    if (!this.dataStructureManager.get(recordType)) throw new Error(`Unknown recordType structure: ${recordType}`);
    this.databases.set(databaseId, { databaseId, recordType, primaryKey, allowDelete, recordFile, records: new Map(), seq: 1 });
    return this.databases.get(databaseId);
  }

  /** Loads an array of database definitions (e.g. fetched from data/databases.framework.json) - plan §9.3's database config is authored as game data. */
  loadDefinitions(definitions = []) {
    definitions.forEach((definition) => this.registerDatabase(definition));
  }

  /** Lists every registered database's own config (not its records) - used by dev-tool database browsers. */
  listDatabases() {
    return [...this.databases.values()].map(({ records, ...config }) => ({ ...config, recordCount: records.size }));
  }

  /**
   * Bulk-inserts pre-authored records into an already-registered database -
   * the generic, config-driven counterpart to `loadDefinitions()` for
   * *content* (e.g. `data/seed-records.json`), not schema. Each record still
   * goes through `createRecord()`'s normal defaults/validation/duplicate-key
   * checks, so a bad seed file fails the same way a bad `createRecord` call
   * would; no domain-specific bypass is introduced.
   */
  loadRecords(databaseId, records = []) {
    decodeCl2Blueprints(records, `database:${databaseId}`).forEach((record) => this.createRecord(databaseId, record));
  }

  /** Bulk-loads a `{ databaseId: records[] }` map (e.g. fetched from `data/seed-records.json`) across every listed database, in file order. */
  loadRecordSet(recordsByDatabase = {}) {
    Object.entries(recordsByDatabase).forEach(([databaseId, records]) => {
      if (!this.databases.has(databaseId)) return;
      this.loadRecords(databaseId, records);
    });
  }


  _db(databaseId) {
    const db = this.databases.get(databaseId);
    if (!db) throw new Error(`Unknown database: ${databaseId}`);
    return db;
  }

  createRecord(databaseId, data = {}) {
    const db = this._db(databaseId);
    const withDefaults = this.dataStructureManager.applyDefaults(db.recordType, data);
    if (withDefaults[db.primaryKey] === undefined || withDefaults[db.primaryKey] === null || withDefaults[db.primaryKey] === "") {
      withDefaults[db.primaryKey] = `${db.recordType}-${db.seq++}`;
    }
    const key = withDefaults[db.primaryKey];
    if (db.records.has(key)) throw new Error(`Duplicate primary key "${key}" in database "${databaseId}"`);
    const validation = this.dataStructureManager.validateRecord(db.recordType, withDefaults);
    if (!validation.ok) throw new Error(`createRecord validation failed: ${validation.errors.join("；")}`);
    db.records.set(key, clone(withDefaults));
    return clone(db.records.get(key));
  }

  getStructureDefinition(structureId) {
    return clone(this.dataStructureManager.get(structureId));
  }

  getDatabaseDefinition(databaseId) {
    return clone(this.databases.get(databaseId));
  }

  getRecord(databaseId, key) {
    const db = this._db(databaseId);
    const record = db.records.get(key);
    return record ? clone(record) : null;
  }

  updateRecord(databaseId, key, patch = {}) {
    const db = this._db(databaseId);
    const existing = db.records.get(key);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    const validation = this.dataStructureManager.validateRecord(db.recordType, merged);
    if (!validation.ok) throw new Error(`updateRecord validation failed: ${validation.errors.join("；")}`);
    db.records.set(key, clone(merged));
    return clone(db.records.get(key));
  }

  deleteRecord(databaseId, key) {
    const db = this._db(databaseId);
    if (!db.allowDelete) throw new Error(`Database "${databaseId}" does not allow deletion`);
    return db.records.delete(key);
  }

  findRecords(databaseId, query = {}) {
    const db = this._db(databaseId);
    return [...db.records.values()].filter((record) => matchesQuery(record, query)).map(clone);
  }

  countRecords(databaseId, query = {}) {
    return this.findRecords(databaseId, query).length;
  }

  /** Serializes every database's records for save/restore; structure/allowDelete config is data-driven and reloaded on boot, not saved. */
  toJSON() {
    const out = {};
    for (const [databaseId, db] of this.databases) out[databaseId] = { records: [...db.records.values()].map(clone), seq: db.seq };
    return out;
  }

  restore(data = {}) {
    for (const [databaseId, snapshot] of Object.entries(data)) {
      const db = this.databases.get(databaseId);
      if (!db) continue;
      db.records = new Map((snapshot.records || []).map((record) => [record[db.primaryKey], clone(record)]));
      db.seq = snapshot.seq || 1;
    }
  }
}

export default DataStore;
