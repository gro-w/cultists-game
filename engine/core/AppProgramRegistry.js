import { t as translate } from "./i18n/index.js";

function t(key, values = key) {
  if (!values || typeof values !== "object") return translate(key, values);
  return Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), String(translate(key, key)));
}

function clone(value) {
  return structuredClone(value);
}

function validateLaunchDefinition(program) {
  if (!program || typeof program !== "object" || Array.isArray(program)
    || typeof program.title !== "string" || !program.title
    || typeof program.icon !== "string" || !program.icon
    || !["window", "activity"].includes(program.kind)
    || typeof program.target !== "string" || !program.target
    || (program.parameters !== undefined && !Array.isArray(program.parameters))) {
    throw new Error(t("appManager.error.invalidProgram"));
  }
}

function validateProgramDefinitions(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)
    || document.version !== 1 || !Array.isArray(document.programs)
    || typeof document.defaultProgramIcon !== "string" || !document.defaultProgramIcon) {
    throw new Error(t("appManager.error.invalidDocument"));
  }
  if (document.defaultProgram !== undefined) validateLaunchDefinition(document.defaultProgram);
  const ids = new Set();
  for (const program of document.programs) {
    if (!program || typeof program !== "object" || Array.isArray(program)
      || typeof program.id !== "string" || !program.id) {
      throw new Error(t("appManager.error.invalidProgram"));
    }
    validateLaunchDefinition(program);
    if (program.id.startsWith("dev-") || program.target.startsWith("dev-")) {
      throw new Error(t("appManager.error.coreOwnedProgram"));
    }
    if (ids.has(program.id)) throw new Error(t("appManager.error.duplicateProgram", { id: program.id }));
    ids.add(program.id);
  }
  return true;
}

/** Owns icon/launch metadata; executable files and .lnk files store only IDs/paths. */
export class AppProgramRegistry {
  constructor(document, eventBus = null) {
    this.eventBus = eventBus;
    this.corePrograms = new Map();
    this.replaceDocument(document);
  }

  static validateDocument(document) {
    return validateProgramDefinitions(document);
  }

  replaceDocument(document) {
    validateProgramDefinitions(document);
    this.document = clone(document);
    this.eventBus?.emit("app-programs:changed", { programs: this.list() });
  }

  registerCoreProgram(program) {
    if (!program || typeof program.id !== "string" || !program.id) {
      throw new Error(t("appManager.error.invalidProgram"));
    }
    validateLaunchDefinition(program);
    this.corePrograms.set(program.id, clone(program));
    this.eventBus?.emit("app-programs:changed", { programs: this.list() });
  }

  get(programId) {
    const program = this.corePrograms.get(String(programId))
      || this.document.programs.find((entry) => entry.id === String(programId));
    return program ? clone(program) : null;
  }

  getActivityParameters(programId, invocationParameters = []) {
    const program = this.get(programId);
    if (program?.kind !== "activity") return [];
    return [
      ...(Array.isArray(program.parameters) ? program.parameters : []),
      ...(Array.isArray(invocationParameters) ? invocationParameters : []),
    ];
  }

  getWindowParameters(programId, invocationParameters = []) {
    const program = this.get(programId);
    if (program?.kind !== "window") return [];
    return Array.isArray(invocationParameters) && invocationParameters.length
      ? clone(invocationParameters)
      : (Array.isArray(program.parameters) ? clone(program.parameters) : []);
  }

  getDefaultProgram() {
    return clone(this.document.defaultProgram || {
      title: t("appManager.defaultProgram"),
      icon: this.document.defaultProgramIcon || "⚙️",
      kind: "window",
      target: "terminal",
    });
  }

  getIcon(programId) {
    return this.get(programId)?.icon || this.getDefaultProgram().icon || this.document.defaultProgramIcon;
  }

  list() {
    const programs = new Map(this.document.programs.map((program) => [program.id, clone(program)]));
    for (const [id, program] of this.corePrograms) programs.set(id, clone(program));
    return [...programs.values()];
  }

  snapshotDefinitions() {
    return clone(this.document);
  }
}

export default AppProgramRegistry;
