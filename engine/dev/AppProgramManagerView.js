// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { AppProgramRegistry } from "../core/AppProgramRegistry.js";
import { downloadTextFile, writeDataFile } from "./devApi.js";

const clone = (value) => structuredClone(value);

export class AppProgramManagerView {
  constructor({ appRegistry, dataLoader, windowDefinitionStore, activityDefinitionStore } = {}) {
    this.appRegistry = appRegistry;
    this.dataLoader = dataLoader;
    this.windowDefinitionStore = windowDefinitionStore;
    this.activityDefinitionStore = activityDefinitionStore;
    this.programSeq = 1;
    this.parameterErrors = new Set();
    this.draft = appRegistry.snapshotDefinitions();
    this.el = document.createElement("section");
    this.el.className = "ng-app-program-manager";
    this.render();
  }

  render() {
    this.el.replaceChildren();
    const toolbar = document.createElement("div");
    toolbar.className = "ng-app-program-toolbar";
    const defaultLabel = document.createElement("label");
    defaultLabel.textContent = t("appManager.defaultIcon");
    this.defaultIcon = document.createElement("input");
    this.defaultIcon.type = "text";
    this.defaultIcon.value = this.draft.defaultProgramIcon || "";
    this.defaultIcon.addEventListener("input", () => { this.draft.defaultProgramIcon = this.defaultIcon.value; });
    defaultLabel.appendChild(this.defaultIcon);
    toolbar.appendChild(defaultLabel);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "win95-btn bevel-out";
    add.textContent = t("appManager.addProgram");
    add.addEventListener("click", () => {
      let id;
      do { id = `new-program-${this.programSeq++}`; } while (this.draft.programs.some((program) => program.id === id));
      this.draft.programs.push({ id, title: t("appManager.newProgram"), icon: this.draft.defaultProgramIcon || "📦", kind: "window", target: "settings" });
      this.render();
    });
    toolbar.appendChild(add);
    for (const [action, label] of [
      ["memory", t("editor.saveToMemory")],
      ["download", `${t("legacy.3f10b573ee1b")}JSON`],
      ["disk", t("editor.writeToDisk")],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "win95-btn bevel-out";
      button.textContent = label;
      button.addEventListener("click", () => this[action === "memory" ? "saveToMemory" : action === "download" ? "download" : "writeToDisk"]());
      toolbar.appendChild(button);
    }
    this.status = document.createElement("span");
    this.status.className = "ng-editor-status";
    toolbar.appendChild(this.status);
    this.el.appendChild(toolbar);

    const list = document.createElement("div");
    list.className = "ng-app-program-list";
    this.draft.defaultProgram ||= { title: t("appManager.defaultProgram"), icon: this.draft.defaultProgramIcon || "⚙️", kind: "window", target: "terminal", parameters: [] };
    list.appendChild(this.createDefaultProgramRow());
    for (const [index, program] of this.draft.programs.entries()) list.appendChild(this.createProgramRow(program, index));
    this.el.appendChild(list);
  }

  createDefaultProgramRow() {
    const program = this.draft.defaultProgram;
    const row = document.createElement("fieldset");
    row.className = "ng-app-program-row ng-app-program-default";
    const legend = document.createElement("legend");
    legend.textContent = t("appManager.defaultProgram");
    row.appendChild(legend);
    for (const name of ["title", "icon", "target"]) {
      const label = document.createElement("label");
      label.textContent = t(`appManager.field.${name}`);
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(program[name] ?? "");
      input.addEventListener("input", () => { program[name] = input.value; });
      label.appendChild(input);
      row.appendChild(label);
    }
    const kindLabel = document.createElement("label");
    kindLabel.textContent = t("appManager.field.kind");
    const kind = document.createElement("select");
    for (const value of ["window", "activity"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = t(`appManager.kind.${value}`);
      kind.appendChild(option);
    }
    kind.value = program.kind;
    kind.addEventListener("change", () => { program.kind = kind.value; this.render(); });
    kindLabel.appendChild(kind);
    row.appendChild(kindLabel);
    program.parameters ||= [];
    const parametersLabel = document.createElement("label");
    parametersLabel.className = "ng-app-program-parameters";
    parametersLabel.textContent = t("appManager.field.parameters");
    const parameters = document.createElement("textarea");
    parameters.rows = 3;
    parameters.value = JSON.stringify(program.parameters, null, 2);
    parameters.addEventListener("input", () => {
      try {
        const value = JSON.parse(parameters.value);
        if (!Array.isArray(value)) throw new Error("parameters must be an array");
        program.parameters = value;
        this.defaultParameterError = false;
      } catch { this.defaultParameterError = true; }
    });
    parametersLabel.appendChild(parameters);
    row.appendChild(parametersLabel);
    return row;
  }

  createProgramRow(program, index) {
    const row = document.createElement("fieldset");
    row.className = "ng-app-program-row";
    const legend = document.createElement("legend");
    legend.textContent = `${program.id} · ${index + 1}`;
    row.appendChild(legend);
    const addField = (name, type = "text") => {
      const label = document.createElement("label");
      label.textContent = t(`appManager.field.${name}`);
      const input = document.createElement("input");
      input.type = type;
      input.value = String(program[name] ?? "");
      if (name === "id") input.readOnly = true;
      input.addEventListener("input", () => { program[name] = input.value; });
      label.appendChild(input);
      row.appendChild(label);
    };
    addField("id");
    addField("title");
    addField("icon");
    const kindLabel = document.createElement("label");
    kindLabel.textContent = t("appManager.field.kind");
    const kind = document.createElement("select");
    for (const value of ["window", "activity"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = t(`appManager.kind.${value}`);
      kind.appendChild(option);
    }
    kind.value = program.kind;
    kind.addEventListener("change", () => {
      program.kind = kind.value;
      this.parameterErrors.delete(program.id);
      program.parameters ||= [];
      this.render();
    });
    kindLabel.appendChild(kind);
    row.appendChild(kindLabel);
    addField("target");
    program.parameters ||= [];
    const parametersLabel = document.createElement("label");
    parametersLabel.className = "ng-app-program-parameters";
    parametersLabel.textContent = t("appManager.field.parameters");
    const parameters = document.createElement("textarea");
    parameters.rows = 3;
    parameters.value = JSON.stringify(program.parameters || []);
    parameters.setAttribute("aria-label", t("appManager.field.parameters"));
    parameters.addEventListener("input", () => {
      try {
        const value = JSON.parse(parameters.value);
        if (!Array.isArray(value)) throw new Error("parameters must be an array");
        program.parameters = value;
        this.parameterErrors.delete(program.id);
      } catch { this.parameterErrors.add(program.id); }
    });
    parametersLabel.appendChild(parameters);
    row.appendChild(parametersLabel);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "win95-btn bevel-out";
    remove.textContent = t("appManager.removeProgram");
    remove.addEventListener("click", () => { this.draft.programs.splice(index, 1); this.render(); });
    row.appendChild(remove);
    return row;
  }

  validate() {
    AppProgramRegistry.validateDocument(this.draft);
    if (this.parameterErrors.size || this.defaultParameterError) throw new Error(t("appManager.error.invalidParameters"));
    if (this.draft.programs.some(({ id }) => id === "dev-mode-launcher")) throw new Error(t("appManager.error.coreOwnedProgram"));
    for (const program of [...this.draft.programs, { ...this.draft.defaultProgram, id: "defaultProgram" }]) {
      const exists = program.kind === "window"
        ? Boolean(this.windowDefinitionStore?.get(program.target))
        : Boolean(this.activityDefinitionStore?.get(program.target));
      if (!exists) throw new Error(t("appManager.error.unknownTarget", { id: program.id, target: program.target }));
    }
    return true;
  }

  serialized() { return `${JSON.stringify(this.draft, null, 2)}\n`; }

  saveToMemory() {
    try {
      this.validate();
      const value = clone(this.draft);
      this.appRegistry.replaceDocument(value);
      this.dataLoader.cache.set(this.dataLoader.resolve("app-definitions.json"), clone(value));
      this.status.textContent = t("editor.savedToMemory");
    } catch (error) { this.status.textContent = error.message; }
  }

  download() {
    try {
      this.validate();
      downloadTextFile("app-definitions.json", this.serialized());
      this.status.textContent = t("editor.downloaded");
    } catch (error) { this.status.textContent = error.message; }
  }

  async writeToDisk() {
    try {
      this.validate();
      await writeDataFile("app-definitions.json", this.serialized());
      const persisted = await this.dataLoader.loadJSON("app-definitions.json", { cache: false });
      if (JSON.stringify(persisted) !== JSON.stringify(this.draft)) throw new Error(t("editor.diskReadbackMismatch"));
      this.appRegistry.replaceDocument(clone(persisted));
      this.dataLoader.cache.set(this.dataLoader.resolve("app-definitions.json"), clone(persisted));
      this.status.textContent = t("editor.wroteToDisk");
    } catch (error) { this.status.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`; }
  }
}

export default AppProgramManagerView;
// DEV-TOOLS:END
