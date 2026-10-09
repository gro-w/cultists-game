import { t } from "./i18n/index.js";
import { validateBlueprint } from "./ActivityValidator.js";
import { validateCl2 } from "./Cl2Validator.js";
import { compileCl2Activity } from "./Cl2Compiler.js";

/**
 * ActivityDefinitionStore - single owner of Activity *definitions*
 * (id + blueprint), loaded from the selected content root's activities directory. Mirrors
 * WindowDefinitionStore's read-only, fetch-once contract so no other
 * module scatters `fetch("data/activities/...")` calls.
 */
export class ActivityDefinitionStore {
  constructor(dataLoader = null) {
    this.dataLoader = dataLoader;
    this._definitions = new Map();
  }

  // In-memory graph registration remains available to runtime harnesses and
  // tests; canonical Activity sources must still enter through registerCl2().
  register(definition) {
    if (!definition || !definition.id) throw new Error(t("error.6ce7ea0c5850"));
    const validation = validateBlueprint(definition.blueprint);
    if (!validation.ok) throw new Error(`Invalid in-memory blueprint for activity "${definition.id}": ${validation.errors.join("；")}`);
    const blueprint = validation.blueprint;
    const registered = {
      ...definition,
      format: definition.format || "graph",
      blueprint,
      compiled: compileCl2Activity(blueprint),
    };
    this._definitions.set(definition.id, registered);
    return registered;
  }

  registerCl2({ id, source, sourcePath = id, ...metadata } = {}) {
    if (!id) throw new Error(t("error.6ce7ea0c5850"));
    const result = validateCl2(source, { sourcePath });
    if (!result.ok) {
      const details = result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("；");
      throw new Error(`Invalid CL2 activity "${id}": ${details}`);
    }
    const registered = {
      id,
      ...metadata,
      source,
      sourcePath,
      format: "CL2",
      graph: result.graph,
      blueprint: result.graph,
      compiled: compileCl2Activity(result.graph),
    };
    this._definitions.set(id, registered);
    return registered;
  }

  get(id) {
    return this._definitions.get(id) || null;
  }

  list() {
    return [...this._definitions.values()];
  }

  async loadManifest(activityIds, baseUrl = "activities/") {
    if (!this.dataLoader) throw new Error("ActivityDefinitionStore.loadManifest requires a configured DataLoader");
    // Keep the legacy list-driven loading order. Promise.all makes the
    // browser parse and validate the complete corpus in one bootstrap burst.
    for (const entry of activityIds || []) {
      const activityId = typeof entry === "string" ? entry : entry.id;
      if (!activityId || this._definitions.has(activityId)) continue;
      const file = typeof entry === "string" ? `${activityId}.CL2.txt` : entry.file;
      if (!file) continue;
      if (!file.endsWith(".CL2.txt")) throw new Error(`Activity source must use CL2: ${file}`);
      const source = await this.dataLoader.loadText(`${baseUrl}${file}`);
      this.registerCl2({ id: activityId, source, sourcePath: `${baseUrl}${file}`, ...entry });
    }
    return this.list();
  }
}

export default ActivityDefinitionStore;
