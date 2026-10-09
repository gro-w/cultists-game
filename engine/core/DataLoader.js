import { t } from "./i18n/index.js";
import { decodeCl2Blueprints } from "./Cl2Embedded.js";
/**
 * DataLoader - the single content-loading boundary for ng.
 *
 * The engine never knows a game's language directory or individual content
 * files. The manifest supplies the content root; this loader owns URL joining,
 * response errors, caching, cache invalidation, and optional dev-server
 * change notifications. It intentionally contains no game-domain knowledge.
 */
export class DataLoader {
  constructor({ root, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    if (typeof root !== "string" || !root) throw new Error("DataLoader requires an explicit content root");
    if (typeof fetchImpl !== "function") throw new Error(t("error.f2bf38a7cfbe"));
    this.root = root.endsWith("/") ? root : `${root}/`;
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
    this.devEventSource = null;
  }

  setRoot(root) {
    if (typeof root !== "string" || !root) throw new Error("DataLoader requires an explicit content root");
    this.root = root.replace(/\/$/, "") + "/";
    this.clearCache();
  }

  resolve(fileName) {
    const value = String(fileName || "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/")) return value;
    return `${this.root}${value.replace(/^\/+/, "")}`;
  }

  async loadJSON(fileName, { cache = true, optional = false } = {}) {
    const url = this.resolve(fileName);
    if (cache && this.cache.has(url)) return this.cache.get(url);
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      if (optional && response.status === 404) return null;
      throw new Error(`Failed to load JSON "${url}": ${response.status}`);
    }
    let value;
    try {
      value = decodeCl2Blueprints(await response.json(), fileName);
    } catch (error) {
      throw new Error(`Invalid JSON in "${url}": ${error.message}`);
    }
    if (cache) this.cache.set(url, value);
    return value;
  }

  async loadText(fileName, { cache = true, optional = false } = {}) {
    const url = this.resolve(fileName);
    if (cache && this.cache.has(url)) return this.cache.get(url);
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      if (optional && response.status === 404) return null;
      throw new Error(`Failed to load text "${url}": ${response.status}`);
    }
    const value = await response.text();
    if (cache) this.cache.set(url, value);
    return value;
  }

  clearCache(fileName = null) {
    if (fileName == null) this.cache.clear();
    else this.cache.delete(this.resolve(fileName));
  }

  async detectDevServer() {
    // The ng development server is intentionally write-only. Existing data
    // is always read from the static content root, so probing a file-list
    // endpoint would be both an invalid read and a noisy 404 on every dev boot.
    return false;
  }

  connectChangeEvents({ onChange } = {}) {
    if (typeof EventSource === "undefined" || this.devEventSource) return false;
    try {
      const source = new EventSource("/api/events");
      source.onmessage = (event) => {
        let payload = null;
        try { payload = JSON.parse(event.data); } catch { /* ignore malformed notices */ }
        this.clearCache(payload?.file || null);
        onChange?.(payload);
      };
      source.onerror = () => { source.close(); this.devEventSource = null; };
      this.devEventSource = source;
      return true;
    } catch {
      return false;
    }
  }

  disconnectChangeEvents() {
    this.devEventSource?.close();
    this.devEventSource = null;
  }
}

export default DataLoader;
