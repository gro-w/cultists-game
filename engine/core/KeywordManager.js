/**
 * KeywordManager - the generic "keyword collection" mechanic (plan §8/§15
 * 风险 F: domain-agnostic — this file knows nothing about dialogue/his/
 * item content, only an opaque `keywords` database of `{id, content,
 * contentLowSan, relatedIds}` records already seeded by
 * `data/seed-records.json`).
 *
 * Mirrors the legacy `js/core/KeywordManager.js` contract (collect/has/
 * get/all, `[[id]]`/`[[id|display]]` marker parsing, low-SAN distorted
 * text) but sourced from `DataStore`'s `keywords` database instead of a
 * bespoke `keywords.json` loader, and persisted through the same
 * SaveManager envelope as every other domain (`snapshot()`/`restore()`).
 */
const MARKER_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export class KeywordManager {
  constructor({ dataStore, eventBus, sanityProvider } = {}) {
    this.dataStore = dataStore;
    this.eventBus = eventBus;
    // Reads the protagonist's current SAN lazily (a callback, not a
    // snapshot) so `displayContent` always reflects the live value without
    // this generic module needing to know which public-variable id holds
    // it — the caller (engine.js) supplies that domain mapping.
    this.sanityProvider = sanityProvider || (() => 100);
    /** @type {Map<string, {id:string, collectedDay:number}>} */
    this.collected = new Map();
  }

  /** Look up a keyword's definition record, or null if unknown. */
  getDefinition(id) {
    return this.dataStore.getRecord("keywords", id);
  }

  /** Extract every canonical keyword id referenced by `[[...]]` markers in `text`. */
  idsFromText(text) {
    const ids = [];
    String(text || "").replace(MARKER_RE, (_, id) => {
      if (!ids.includes(id)) ids.push(id);
      return _;
    });
    return ids;
  }

  /** The text shown for a keyword id: the low-SAN distorted variant when SAN < 50 and one is authored, else the normal content. */
  displayContent(id) {
    const definition = this.getDefinition(id);
    if (!definition) return id;
    const san = Number(this.sanityProvider());
    if (definition.contentLowSan && san < 50) return definition.contentLowSan;
    return definition.content || id;
  }

  /**
   * Render a plain string's `[[id|display]]`/`[[id]]` markers into HTML
   * with clickable highlighted spans (`data-keyword-id`), same markup
   * convention as the legacy engine so existing CSS/authoring is reusable.
   * Unknown ids fall back to the raw display text with no span (never
   * silently drop content).
   */
  renderHighlightedText(text) {
    if (!text) return "";
    return String(text).replace(MARKER_RE, (match, id, display) => {
      const definition = this.getDefinition(id);
      const label = display || (definition ? this.displayContent(id) : id);
      if (!definition) return label;
      const collectedClass = this.collected.has(id) ? " keyword-highlight-collected" : "";
      return `<span class="keyword-highlight${collectedClass}" data-keyword-id="${id}">${label}</span>`;
    });
  }

  /** Collect a keyword by id (idempotent — re-collecting an already-collected id is a no-op besides re-emitting `keyword:collected`). Unknown ids are ignored (never fabricate a definition). */
  collect(id, day) {
    const definition = this.getDefinition(id);
    if (!definition) return;
    const isNew = !this.collected.has(id);
    const stored = isNew ? { id, collectedDay: day } : this.collected.get(id);
    this.collected.set(id, stored);
    this.eventBus?.emit("keyword:collected", { id, collectedDay: stored.collectedDay, isNew });
    if (isNew) this.eventBus?.emit("keyword:new", { id, collectedDay: stored.collectedDay });
  }

  remove(id) {
    if (!this.collected.has(id)) return;
    this.collected.delete(id);
    this.eventBus?.emit("keyword:removed", { id });
  }

  has(id) {
    return this.collected.has(id);
  }

  get(id) {
    const entry = this.collected.get(id);
    if (!entry) return null;
    return { ...this.getDefinition(id), ...entry };
  }

  /** Every collected keyword, joined with its definition, most-recently-collected first. */
  all() {
    return [...this.collected.values()]
      .map((entry) => ({ ...this.getDefinition(entry.id), ...entry }))
      .sort((a, b) => (b.collectedDay || 0) - (a.collectedDay || 0));
  }

  snapshot() {
    return [...this.collected.values()];
  }

  restore(entries = []) {
    this.collected = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (entry && typeof entry.id === "string") this.collected.set(entry.id, { id: entry.id, collectedDay: entry.collectedDay });
    });
  }
}

export default KeywordManager;
