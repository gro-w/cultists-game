import { t as translate } from "./i18n/index.js";
import { VirtualFileSystem } from "./VirtualFileSystem.js";
import { runVirtualShellCommand } from "./VirtualShell.js";

function t(key, values = key) {
  if (!values || typeof values !== "object") return translate(key, values);
  return Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), String(translate(key, key)));
}

function basename(path) {
  return path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
}

function parentPath(path) {
  if (path === "/") return "/";
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function joinPath(directory, name) {
  return directory === "/" ? `/${name}` : `${directory}/${name}`;
}

function isValidName(value) {
  return Boolean(value && value !== "." && value !== ".." && !/[\\/\\\\\0]/.test(value));
}

function ask(message, initial = "") {
  return typeof window !== "undefined" && typeof window.prompt === "function" ? window.prompt(message, initial) : null;
}

function makeButton(label, onClick, className = "win95-btn bevel-out") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function makeAction(label, onClick, className, role = "button") {
  const action = document.createElement("div");
  action.className = className;
  action.textContent = label;
  action.setAttribute("role", role);
  action.tabIndex = 0;
  action.addEventListener("click", onClick);
  action.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick(event);
  });
  return action;
}

function invokeMenuAction(menu, action) {
  try {
    action();
    menu.remove();
  } catch (error) {
    const message = menu.querySelector(".vfs-context-error");
    if (message) message.textContent = error.message;
  }
}

/** Shared Win95-style context menu used by desktop and file-manager surfaces. */
export function showVirtualFileContextMenu(event, {
  virtualFileSystem,
  path = null,
  directory = "/home/desktop",
  openPath = () => {},
  refresh = () => {},
} = {}) {
  event.preventDefault();
  event.stopPropagation();
  document.querySelectorAll(".vfs-context-menu").forEach((menu) => menu.remove());
  const menu = document.createElement("div");
  menu.className = "vfs-context-menu bevel-out";
  const entry = path ? virtualFileSystem.get(path) : null;
  const isDirectory = !path || entry?.type === "directory";
  const targetDirectory = isDirectory ? (path || directory) : parentPath(path);
  const addItem = (label, action) => {
    menu.appendChild(makeAction(label, () => invokeMenuAction(menu, action), "vfs-context-menu-item", "menuitem"));
  };
  const separator = () => {
    const line = document.createElement("div");
    line.className = "vfs-context-menu-separator";
    menu.appendChild(line);
  };
  const createFile = () => {
    const name = ask(t("vfs.prompt.fileName"), t("vfs.file.defaultName"));
    if (name === null) return;
    if (!isValidName(name.trim())) throw new Error(t("vfs.error.invalidName"));
    virtualFileSystem.createFile(joinPath(targetDirectory, name.trim()), "");
    refresh();
  };
  const createFolder = () => {
    const name = ask(t("vfs.prompt.folderName"), t("vfs.folder.defaultName"));
    if (name === null) return;
    if (!isValidName(name.trim())) throw new Error(t("vfs.error.invalidName"));
    virtualFileSystem.mkdir(joinPath(targetDirectory, name.trim()));
    refresh();
  };
  if (entry) {
    addItem(t("vfs.menu.open"), () => openPath(path));
    if (entry.metadata?.coreOnly !== true) {
      separator();
      addItem(t("vfs.menu.rename"), () => {
        const name = ask(t("vfs.prompt.rename"), basename(path));
        if (name === null) return;
        if (!isValidName(name.trim())) throw new Error(t("vfs.error.invalidName"));
        virtualFileSystem.rename(path, joinPath(parentPath(path), name.trim()));
        refresh();
      });
      addItem(t("vfs.menu.delete"), () => {
        if (typeof window === "undefined" || typeof window.confirm !== "function" || window.confirm(t("vfs.confirm.delete"))) {
          virtualFileSystem.moveToTrash(path);
          refresh();
        }
      });
      addItem(t("vfs.menu.copy"), () => { virtualFileSystem.clipboard = { path, operation: "copy" }; });
      addItem(t("vfs.menu.cut"), () => { virtualFileSystem.clipboard = { path, operation: "cut" }; });
      separator();
    }
  }
  addItem(t("vfs.menu.newFile"), createFile);
  addItem(t("vfs.menu.newFolder"), createFolder);
  addItem(t("vfs.menu.paste"), () => {
    const clipboard = virtualFileSystem.clipboard;
    if (!clipboard) return;
    if (clipboard.operation === "cut") {
      virtualFileSystem.move(clipboard.path, targetDirectory);
      virtualFileSystem.clipboard = null;
    } else virtualFileSystem.copy(clipboard.path, targetDirectory);
    refresh();
  });
  addItem(t("vfs.menu.pasteShortcut"), () => {
    const clipboard = virtualFileSystem.clipboard;
    if (!clipboard) return;
    const source = virtualFileSystem.get(clipboard.path);
    const target = source?.path.endsWith(".lnk") ? virtualFileSystem.resolveShortcut(source.path)?.target.path : source?.path;
    if (!target) throw new Error(t("vfs.error.notFound", { path: clipboard.path }));
    virtualFileSystem.createShortcut(target, targetDirectory);
    refresh();
  });
  const error = document.createElement("div");
  error.className = "vfs-context-error";
  menu.appendChild(error);
  menu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - 240))}px`;
  menu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - 250))}px`;
  document.body.appendChild(menu);
  const dismiss = (otherEvent) => {
    if (otherEvent.type === "keydown" && otherEvent.key !== "Escape") return;
    if (otherEvent.type === "click" && menu.contains(otherEvent.target)) return;
    menu.remove();
    document.removeEventListener("click", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  };
  document.addEventListener("click", dismiss, true);
  document.addEventListener("keydown", dismiss, true);
  return menu;
}

function programDisplay(entry, virtualFileSystem, appRegistry) {
  if (entry.type === "directory") return { icon: "📁", label: basename(entry.path) };
  if (entry.path.endsWith(".lnk")) {
    const resolved = virtualFileSystem.resolveShortcut(entry.path);
    const programId = resolved?.target.type === "file" && !basename(resolved.target.path).includes(".")
      ? resolved.target.content.trim()
      : null;
    return {
      icon: programId ? appRegistry?.getIcon(programId) : appRegistry?.document?.defaultProgramIcon || "⚙️",
      label: appRegistry?.get(programId)?.title || basename(entry.path).replace(/\.lnk$/, ""),
    };
  }
  if (!basename(entry.path).includes(".")) {
    const id = entry.content.trim();
    return { icon: appRegistry?.getIcon(id) || appRegistry?.document?.defaultProgramIcon || "⚙️", label: basename(entry.path) };
  }
  return { icon: "📄", label: basename(entry.path) };
}

class FileManagerWidget {
  constructor(node, context) {
    this.node = node;
    this.context = context;
    this.path = VirtualFileSystem.normalizePath(context.parameters?.[0] || node.path || "/home/desktop");
    this.el = document.createElement("section");
    this.el.className = "vfs-file-manager";
    this.toolbar = document.createElement("div");
    this.toolbar.className = "vfs-file-manager-toolbar";
    const pathLabel = document.createElement("label");
    pathLabel.textContent = `${t("vfs.fileManager.path")}:`;
    this.address = document.createElement("input");
    this.address.type = "text";
    this.address.className = "vfs-address";
    this.address.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.navigate(this.address.value);
    });
    const up = makeAction(t("vfs.fileManager.up"), () => this.navigate(parentPath(this.path)), "vfs-file-manager-up");
    this.toolbar.append(pathLabel, this.address, up);
    this.view = document.createElement("div");
    this.view.className = "vfs-file-manager-view";
    this.view.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".vfs-file-item")) return;
      showVirtualFileContextMenu(event, {
        virtualFileSystem: this.context.virtualFileSystem,
        directory: this.path,
        refresh: () => this.renderItems(),
      });
    });
    this.view.addEventListener("dragover", (event) => event.preventDefault());
    this.view.addEventListener("drop", (event) => this.dropOnBackground(event));
    this.el.append(this.toolbar, this.view);
    this.unsubscribe = this.context.eventBus?.on("vfs:changed", () => this.renderItems());
    this.unsubscribeOpen = this.context.eventBus?.on("file-manager:open-path", ({ instanceId, path } = {}) => {
      if (instanceId !== this.context.windowInstanceId || this.node.widgetId !== "file-manager-root") return;
      this.navigate(path);
    });
    this.unsubscribeParameters = this.context.eventBus?.on("window:parameters", ({ instanceId, windowId, parameters } = {}) => {
      if (instanceId !== this.context.windowInstanceId || windowId !== "file-manager" || this.node.widgetId !== "file-manager-root") return;
      if (typeof parameters?.[0] === "string") this.navigate(parameters[0]);
    });
    this.renderItems();
  }

  navigate(path) {
    try {
      const normalized = VirtualFileSystem.normalizePath(path, this.path);
      const entry = this.context.virtualFileSystem.get(normalized);
      if (!entry || entry.type !== "directory") throw new Error(t("vfs.error.notDirectory", { path: normalized }));
      this.path = normalized;
      this.renderItems();
    } catch (error) {
      this.status.textContent = error.message;
    }
  }

  dropOnBackground(event) {
    if (event.target.closest(".vfs-file-item")) return;
    event.preventDefault();
    const source = event.dataTransfer?.getData("application/x-cultists-vfs-path");
    if (!source) return;
    try {
      const moved = parentPath(source) !== this.path ? this.context.virtualFileSystem.move(source, this.path) : { path: source };
      const rect = this.view.getBoundingClientRect();
      this.context.virtualFileSystem.updateMetadata(moved.path, { position: { x: Math.max(0, event.clientX - rect.left), y: Math.max(0, event.clientY - rect.top) } });
      this.renderItems();
    } catch (error) {
      this.status.textContent = error.message;
    }
  }

  renderItems() {
    if (!this.view.isConnected && !this.el) return;
    this.address.value = this.path;
    this.view.replaceChildren();
    this.status = document.createElement("div");
    this.status.className = "vfs-file-manager-status";
    let entries;
    try { entries = this.context.virtualFileSystem.list(this.path); }
    catch (error) { this.status.textContent = error.message; this.view.appendChild(this.status); return; }
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "vfs-file-manager-empty";
      empty.textContent = t("vfs.fileManager.empty");
      this.view.append(empty, this.status);
      return;
    }
    entries.forEach((entry, index) => {
      const item = document.createElement("div");
      item.className = "vfs-file-item";
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      item.dataset.path = entry.path;
      item.draggable = true;
      const position = entry.metadata?.position;
      const x = Number.isFinite(position?.x) ? position.x : 12 + (index % 6) * 100;
      const y = Number.isFinite(position?.y) ? position.y : 12 + Math.floor(index / 6) * 108;
      item.style.left = `${x}px`;
      item.style.top = `${y}px`;
      const display = programDisplay(entry, this.context.virtualFileSystem, this.context.appRegistry);
      const icon = document.createElement("span");
      icon.className = "vfs-file-item-icon";
      icon.textContent = display.icon;
      const label = document.createElement("span");
      label.className = "vfs-file-item-label";
      label.textContent = display.label;
      item.append(icon, label);
      item.addEventListener("dblclick", () => {
        if (entry.type === "directory") this.navigate(entry.path);
        else this.context.openVirtualPath?.(entry.path, this.context.windowInstanceId);
      });
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (entry.type === "directory") this.navigate(entry.path);
        else this.context.openVirtualPath?.(entry.path, this.context.windowInstanceId);
      });
      item.addEventListener("contextmenu", (event) => showVirtualFileContextMenu(event, {
        virtualFileSystem: this.context.virtualFileSystem,
        path: entry.path,
        directory: this.path,
        openPath: (selectedPath) => {
          if (entry.type === "directory") this.navigate(selectedPath);
          else this.context.openVirtualPath?.(selectedPath, this.context.windowInstanceId);
        },
        refresh: () => this.renderItems(),
      }));
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("application/x-cultists-vfs-path", entry.path);
        event.dataTransfer.effectAllowed = "move";
      });
      item.addEventListener("dragover", (event) => {
        if (entry.type === "directory") { event.preventDefault(); item.classList.add("drop-target"); }
      });
      item.addEventListener("dragleave", () => item.classList.remove("drop-target"));
      item.addEventListener("drop", (event) => {
        if (entry.type !== "directory") return;
        event.preventDefault();
        event.stopPropagation();
        item.classList.remove("drop-target");
        const source = event.dataTransfer?.getData("application/x-cultists-vfs-path");
        if (!source || source === entry.path) return;
        try { this.context.virtualFileSystem.move(source, entry.path); this.renderItems(); }
        catch (error) { this.status.textContent = error.message; }
      });
      this.view.appendChild(item);
    });
    this.view.appendChild(this.status);
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribeOpen?.();
    this.unsubscribeParameters?.();
  }
}

class DocumentEditorWidget {
  constructor(node, context) {
    this.context = context;
    this.path = null;
    this.dirty = false;
    this.el = document.createElement("section");
    this.el.className = "vfs-document-editor";
    this.toolbar = document.createElement("div");
    this.toolbar.className = "vfs-document-toolbar";
    this.fileMenuButton = makeButton(t("document.fileMenu"), () => this.toggleMenu());
    this.menu = document.createElement("div");
    this.menu.className = "vfs-document-menu bevel-out";
    this.menu.hidden = true;
    this.menu.append(
      makeButton(t("document.open"), () => { this.menu.hidden = true; this.openPicker("open"); }, "vfs-document-menu-item"),
      makeButton(t("document.save"), () => { this.menu.hidden = true; this.save(); }, "vfs-document-menu-item"),
      makeButton(t("document.saveAs"), () => { this.menu.hidden = true; this.saveAs(); }, "vfs-document-menu-item"),
      makeButton(t("document.close"), () => { this.menu.hidden = true; this.close(); }, "vfs-document-menu-item"),
    );
    this.filename = document.createElement("span");
    this.filename.className = "vfs-document-filename";
    this.filename.textContent = t("document.untitled");
    this.toolbar.append(this.fileMenuButton, this.menu, this.filename);
    this.textarea = document.createElement("textarea");
    this.textarea.className = "vfs-document-text";
    this.textarea.spellcheck = false;
    this.textarea.addEventListener("input", () => { this.dirty = true; this.updateTitle(); });
    this.status = document.createElement("div");
    this.status.className = "vfs-document-status";
    this.el.append(this.toolbar, this.textarea, this.status);
    this.unsubscribeResult = this.context.eventBus?.on("file-picker:result", (result = {}) => {
      if (result.instanceId !== this.context.windowInstanceId) return;
      if (result.mode === "open") this.openFile(result.path);
      else if (result.mode === "save-as") this.saveFile(result.path, { confirmOverwrite: true });
      else if (result.mode === "save") this.saveFile(result.path);
    });
    this.unsubscribeOpen = this.context.eventBus?.on("document:open-request", ({ instanceId, path } = {}) => {
      if (instanceId === this.context.windowInstanceId) this.openFile(path);
    });
    this.unsubscribeParameters = this.context.eventBus?.on("window:parameters", ({ instanceId, windowId, parameters } = {}) => {
      if (instanceId !== this.context.windowInstanceId || windowId !== "document") return;
      if (typeof parameters?.[0] === "string") this.openFile(parameters[0]);
    });
    if (typeof this.context.parameters?.[0] === "string") this.openFile(this.context.parameters[0]);
  }

  toggleMenu() { this.menu.hidden = !this.menu.hidden; }

  openPicker(mode) {
    const state = this.context.openWindow?.("file-picker");
    if (!state) { this.status.textContent = t("vfs.filePicker.title"); return; }
    this.context.eventBus?.emit("file-picker:request", {
      instanceId: state.instanceId,
      ownerWindowInstanceId: this.context.windowInstanceId,
      mode,
      directory: this.path ? parentPath(this.path) : "/home/desktop",
      filename: this.path ? basename(this.path) : "",
    });
  }

  save() {
    if (this.path) { this.saveFile(this.path); return; }
    this.openPicker("save");
  }

  saveAs() { this.openPicker("save-as"); }

  saveFile(path, { confirmOverwrite = false } = {}) {
    try {
      const normalized = VirtualFileSystem.normalizePath(path);
      const current = this.context.virtualFileSystem.get(normalized);
      if (current && current.type !== "file") throw new Error(t("vfs.error.notFile", { path: normalized }));
      if (confirmOverwrite && current && typeof window !== "undefined" && typeof window.confirm === "function"
        && !window.confirm(t("document.confirmOverwrite", { filename: basename(normalized) }))) return;
      if (current) this.context.virtualFileSystem.writeFile(normalized, this.textarea.value);
      else this.context.virtualFileSystem.createFile(normalized, this.textarea.value);
      this.path = normalized;
      this.dirty = false;
      this.status.textContent = t("document.saved");
      this.updateTitle();
    } catch (error) { this.status.textContent = error.message; }
  }

  openFile(path) {
    try {
      if (this.dirty && typeof window !== "undefined" && typeof window.confirm === "function"
        && !window.confirm(t("document.confirmOpen"))) return;
      const normalized = VirtualFileSystem.normalizePath(path);
      this.textarea.value = this.context.virtualFileSystem.readFile(normalized);
      this.path = normalized;
      this.dirty = false;
      this.status.textContent = "";
      this.updateTitle();
    } catch (error) { this.status.textContent = error.message; }
  }

  updateTitle() {
    this.filename.textContent = `${this.path ? basename(this.path) : t("document.untitled")}${this.dirty ? " *" : ""}`;
  }

  close() {
    if (this.dirty && typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(t("document.confirmClose"))) return;
    const state = this.context.windowManager?.get(this.context.windowInstanceId);
    if (state) this.context.windowManager.close(state.instanceId);
  }

  dispose() {
    this.unsubscribeResult?.();
    this.unsubscribeOpen?.();
    this.unsubscribeParameters?.();
  }
}

class FilePickerWidget {
  constructor(node, context) {
    this.context = context;
    this.mode = "open";
    this.path = "/home/desktop";
    this.filenameValue = "";
    this.el = document.createElement("section");
    this.el.className = "vfs-file-picker";
    this.toolbar = document.createElement("div");
    this.toolbar.className = "vfs-file-picker-toolbar";
    this.address = document.createElement("input");
    this.address.type = "text";
    this.address.className = "vfs-address";
    this.address.addEventListener("keydown", (event) => { if (event.key === "Enter") this.navigate(this.address.value); });
    this.upButton = makeButton(t("vfs.fileManager.up"), () => this.navigate(parentPath(this.path)));
    this.toolbar.append(this.address, this.upButton);
    this.list = document.createElement("div");
    this.list.className = "vfs-file-picker-list";
    this.filename = document.createElement("input");
    this.filename.type = "text";
    this.filename.className = "vfs-file-picker-filename";
    this.filename.setAttribute("aria-label", t("vfs.filePicker.filename"));
    this.filename.addEventListener("input", () => { this.selectedPath = null; });
    this.actions = document.createElement("div");
    this.actions.className = "vfs-file-picker-actions";
    this.actionButton = makeButton(t("vfs.filePicker.open"), () => this.confirmSelection());
    this.cancelButton = makeButton(t("vfs.filePicker.cancel"), () => this.close());
    this.actions.append(this.actionButton, this.cancelButton);
    this.status = document.createElement("div");
    this.status.className = "vfs-file-picker-status";
    this.el.append(this.toolbar, this.list, this.filename, this.actions, this.status);
    this.unsubscribeRequest = this.context.eventBus?.on("file-picker:request", (request = {}) => {
      if (request.instanceId !== this.context.windowInstanceId) return;
      this.ownerWindowInstanceId = request.ownerWindowInstanceId;
      this.mode = request.mode === "save-as" ? "save-as" : request.mode === "save" ? "save" : "open";
      this.path = request.directory || "/home/desktop";
      this.filenameValue = request.filename || "";
      this.selectedPath = null;
      this.filename.value = this.filenameValue;
      this.actionButton.textContent = t(this.mode !== "open" ? "vfs.filePicker.save" : "vfs.filePicker.open");
      this.renderList();
    });
    this.unsubscribeFs = this.context.eventBus?.on("vfs:changed", () => this.renderList());
    this.renderList();
  }

  navigate(path) {
    try {
      const normalized = VirtualFileSystem.normalizePath(path, this.path);
      if (this.context.virtualFileSystem.get(normalized)?.type !== "directory") throw new Error(t("vfs.error.notDirectory", { path: normalized }));
      this.path = normalized;
      this.renderList();
    } catch (error) { this.status.textContent = error.message; }
  }

  renderList() {
    if (!this.list) return;
    this.address.value = this.path;
    this.list.replaceChildren();
    let entries;
    try { entries = this.context.virtualFileSystem.list(this.path); }
    catch (error) { this.status.textContent = error.message; return; }
    entries.forEach((entry) => {
      if (entry.type !== "directory" && this.mode === "open" && entry.path.endsWith(".lnk")) return;
      const button = makeButton(`${entry.type === "directory" ? "📁" : "📄"} ${basename(entry.path)}`, () => {
        if (entry.type === "directory") this.navigate(entry.path);
        else {
          this.filename.value = basename(entry.path);
          this.selectedPath = entry.path;
        }
      }, "vfs-file-picker-entry");
      button.addEventListener("dblclick", () => {
        if (entry.type === "directory") this.navigate(entry.path);
        else { this.selectedPath = entry.path; this.confirmSelection(); }
      });
      this.list.appendChild(button);
    });
  }

  confirmSelection() {
    try {
      let selectedPath = this.selectedPath;
      if (this.mode !== "open") {
        const filename = this.filename.value.trim();
        if (!isValidName(filename)) throw new Error(t("vfs.error.invalidName"));
        selectedPath = joinPath(this.path, filename);
      } else if (!selectedPath && this.filename.value.trim()) {
        selectedPath = joinPath(this.path, this.filename.value.trim());
      }
      if (!selectedPath) throw new Error(t("vfs.error.notFound", { path: this.path }));
      if (this.mode === "open" && this.context.virtualFileSystem.get(selectedPath)?.type !== "file") {
        throw new Error(t("vfs.error.notFile", { path: selectedPath }));
      }
      this.context.eventBus?.emit("file-picker:result", {
        instanceId: this.ownerWindowInstanceId,
        mode: this.mode,
        path: selectedPath,
      });
      this.close();
    } catch (error) { this.status.textContent = error.message; }
  }

  close() {
    const state = this.context.windowManager?.get(this.context.windowInstanceId);
    if (state) this.context.windowManager.close(state.instanceId);
  }

  dispose() {
    this.unsubscribeRequest?.();
    this.unsubscribeFs?.();
  }
}

export function runVirtualTerminalCommand(commandLine, context = {}, state = { cwd: "/home/desktop" }, depth = 0) {
  try {
    runVirtualShellCommand(commandLine, context, state, depth);
  } catch (error) {
    if (error?.shellControl) throw error;
    throw error;
  }
  return state;
}

class TerminalWidget {
  constructor(node, context) {
    this.context = context;
    this.cwd = "/home/desktop";
    this.env = { PATH: "/usr/bin:/opt", HOME: "/home/desktop", PWD: this.cwd, OLDPWD: this.cwd };
    this.history = [];
    this.keyboardVisible = false;
    this.el = document.createElement("section");
    this.el.className = "vfs-terminal";
    this.output = document.createElement("pre");
    this.output.className = "vfs-terminal-output";
    this.controls = document.createElement("div");
    this.controls.className = "vfs-terminal-controls";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "vfs-terminal-input";
    this.input.placeholder = t("terminal.placeholder");
    this.prompt = document.createElement("span");
    this.prompt.className = "vfs-terminal-prompt";
    this.keyboardButton = makeButton(t("terminal.keyboard"), () => this.toggleKeyboard());
    this.controls.append(this.prompt, this.input, this.keyboardButton);
    this.keyboard = document.createElement("div");
    this.keyboard.className = "vfs-osk-window";
    this.keyboard.hidden = true;
    this.keyboard.setAttribute("aria-label", "osk.exe");
    this.el.append(this.output, this.controls, this.keyboard);
    this.write(t("terminal.banner"));
    this.updatePrompt();
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { this.executeInput(); event.preventDefault(); }
    });
    this.renderKeyboard();
    this.unsubscribeOutput = this.context.eventBus?.on("terminal:write", ({ instanceId, text } = {}) => {
      if (instanceId === this.context.windowInstanceId) this.write(text);
    });
    this.unsubscribeParameters = this.context.eventBus?.on("window:parameters", ({ instanceId, windowId, parameters } = {}) => {
      if (instanceId === this.context.windowInstanceId && windowId === "terminal") this.applyParameters(parameters);
    });
    this.applyParameters(this.context.parameters || []);
  }

  applyParameters(parameters = []) {
    if (!Array.isArray(parameters)) return;
    const requestedCwd = parameters[1];
    if (typeof requestedCwd === "string" && requestedCwd) {
      try {
        const path = VirtualFileSystem.normalizePath(requestedCwd, this.cwd);
        if (this.context.virtualFileSystem.get(path)?.type === "directory") {
          this.cwd = path;
          this.env.PWD = path;
          this.updatePrompt();
        }
      } catch { /* Invalid optional working directories leave the current cwd unchanged. */ }
    }
    if (typeof parameters[0] === "string" && parameters[0].trim()) this.executeInput(parameters[0]);
  }

  write(text = "") {
    this.output.textContent += `${this.output.textContent ? "\n" : ""}${String(text)}`;
    this.output.scrollTop = this.output.scrollHeight;
  }

  updatePrompt() { this.prompt.textContent = `${this.cwd}>`; }

  executeInput(line = this.input.value) {
    const source = String(line).trim();
    if (!source) return;
    this.write(`${this.cwd}> ${source}`);
    this.history.push(source);
    this.input.value = "";
    try { this.runCommand(source, 0); }
    catch (error) { this.write(error.message); }
    this.updatePrompt();
  }

  runCommand(tokens, depth) {
    return runVirtualTerminalCommand(tokens, {
      virtualFileSystem: this.context.virtualFileSystem,
      write: (text) => this.write(text),
      appRegistry: this.context.appRegistry,
      terminalInstanceId: this.context.windowInstanceId,
      openVirtualPath: (path, sourceInstanceId, parameters, options) => this.context.openVirtualPath?.(path, sourceInstanceId, parameters, options),
      openWindow: (windowId, parameters = []) => this.context.openWindow?.(windowId, parameters),
    }, this, depth);
  }

  toggleKeyboard() {
    this.keyboardVisible = !this.keyboardVisible;
    this.keyboard.hidden = !this.keyboardVisible;
  }

  renderKeyboard() {
    this.keyboard.replaceChildren();
    const rows = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
    rows.forEach((row) => {
      const line = document.createElement("div");
      line.className = "vfs-osk-row";
      [...row].forEach((key) => line.appendChild(makeButton(key, () => this.insertKey(key), "vfs-osk-key bevel-out")));
      this.keyboard.appendChild(line);
    });
    const controls = document.createElement("div");
    controls.className = "vfs-osk-row";
    controls.append(
      makeButton("/", () => this.insertKey("/"), "vfs-osk-key bevel-out"),
      makeButton("-", () => this.insertKey("-"), "vfs-osk-key bevel-out"),
      makeButton("_", () => this.insertKey("_"), "vfs-osk-key bevel-out"),
      makeButton("Space", () => this.insertKey(" "), "vfs-osk-key vfs-osk-space bevel-out"),
      makeButton("⌫", () => this.eraseKey(), "vfs-osk-key bevel-out"),
      makeButton(t("terminal.keyboardEnter"), () => this.executeInput(), "vfs-osk-key bevel-out"),
    );
    this.keyboard.appendChild(controls);
  }

  insertKey(key) {
    const start = this.input.selectionStart ?? this.input.value.length;
    const end = this.input.selectionEnd ?? start;
    this.input.setRangeText(key, start, end, "end");
    this.input.focus();
  }

  eraseKey() {
    const start = this.input.selectionStart ?? this.input.value.length;
    const end = this.input.selectionEnd ?? start;
    if (start === end && start > 0) this.input.setRangeText("", start - 1, end, "end");
    else this.input.setRangeText("", start, end, "end");
    this.input.focus();
  }

  dispose() {
    this.unsubscribeOutput?.();
    this.unsubscribeParameters?.();
  }
}

export function createVirtualFileWidgetFactories({ virtualFileSystem, appRegistry, eventBus, windowManager, openWindow, openVirtualPath } = {}) {
  function makeFactory(Type) {
    return (node, context) => {
      context.widgetInstances ||= new Map();
      const id = node.widgetId || node.id || node.type;
      let instance = context.widgetInstances.get(id);
      if (!instance) {
        instance = new Type(node, {
          virtualFileSystem,
          appRegistry,
          eventBus,
          windowManager,
          windowInstanceId: context.windowInstanceId,
          ownerWindowInstanceId: context.ownerWindowInstanceId,
          parameters: context.parameters || [],
          openWindow,
          openVirtualPath,
        });
        context.widgetInstances.set(id, instance);
      }
      return instance.el;
    };
  }
  return {
    fileManager: makeFactory(FileManagerWidget),
    documentEditor: makeFactory(DocumentEditorWidget),
    filePicker: makeFactory(FilePickerWidget),
    terminal: makeFactory(TerminalWidget),
  };
}

export function disposeVirtualFileWidgetInstances(instances) {
  for (const instance of instances?.values?.() || []) instance.dispose?.();
  instances?.clear?.();
}

export default createVirtualFileWidgetFactories;
