import { t } from "./i18n/index.js";
/**
 * WindowDefinitionStore - single owner of window *definitions* (static
 * content describing a window's default geometry and body), loaded from
 * the selected content root's windows directory. Runtime open windows and their live geometry are
 * owned by WindowManager instead; this store never mutates once loaded.
 *
 * All JSON reads for window definitions must go through this store so no
 * other module scatters `fetch("data/windows/...")` calls (plan §2.1).
 */
export class WindowDefinitionStore {
  constructor(dataLoader = null) {
    this.dataLoader = dataLoader;
    this._definitions = new Map();
  }

  /** Register a definition object (id, title, width, height, body, ...). */
  register(definition) {
    if (!definition || !definition.id) {
      throw new Error(t("error.fd47610c013e"));
    }
    this._definitions.set(definition.id, definition);
    return definition;
  }

  get(id) {
    return this._definitions.get(id) || null;
  }

  list() {
    return [...this._definitions.values()];
  }

  /** Removes a definition (plan follow-up: "自定义窗口管理器也可以+-按钮"). */
  unregister(id) {
    return this._definitions.delete(id);
  }

  /**
   * Load every `*.json` file listed in `manifest` (array of file names)
   * from `baseUrl` (default "windows/") and register each as a window
   * definition keyed by its own `id` field.
   */
  async loadManifest(manifest, baseUrl = "windows/") {
    if (!this.dataLoader) throw new Error("WindowDefinitionStore.loadManifest requires a configured DataLoader");
    const loaded = await Promise.all(
      manifest.map(async (fileName) => {
        return this.dataLoader.loadJSON(`${baseUrl}${fileName}`);
      }),
    );
    loaded.forEach((definition) => this.register(definition));
    return this.list();
  }
}

export default WindowDefinitionStore;
