import { t as translate } from "./i18n/index.js";

function t(key, values = key) {
  if (!values || typeof values !== "object") return translate(key, values);
  return Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), String(translate(key, key)));
}

const ROOT = "/";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validPosition(value) {
  return plainObject(value) && Number.isFinite(value.x) && value.x >= 0
    && Number.isFinite(value.y) && value.y >= 0;
}

function parentPath(path) {
  if (path === ROOT) return null;
  const index = path.lastIndexOf("/");
  return index <= 0 ? ROOT : path.slice(0, index);
}

function basename(path) {
  return path === ROOT ? ROOT : path.slice(path.lastIndexOf("/") + 1);
}

function joinPath(parent, name) {
  return parent === ROOT ? `/${name}` : `${parent}/${name}`;
}

export class VirtualFileSystem {
  constructor(defaultDocument, eventBus = null) {
    this.eventBus = eventBus;
    this.entries = new Map();
    this.coreEntries = new Map();
    this.allowCoreOnlyEntries = false;
    this.clipboard = null;
    this.loadDefaults(defaultDocument);
  }

  static normalizePath(path, cwd = ROOT) {
    const raw = String(path ?? "");
    if (!raw || raw.includes("\\") || raw.includes("\0")) throw new Error(t("vfs.error.invalidPath"));
    const absolute = raw.startsWith("/") ? raw : `${cwd === ROOT ? "" : cwd}/${raw}`;
    const parts = [];
    for (const segment of absolute.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        if (!parts.length) throw new Error(t("vfs.error.pathEscape"));
        parts.pop();
      } else {
        parts.push(segment);
      }
    }
    return parts.length ? `/${parts.join("/")}` : ROOT;
  }

  static validateDocument(document) {
    if (!plainObject(document) || document.version !== 1 || !Array.isArray(document.entries)) {
      throw new Error(t("vfs.error.invalidDocument"));
    }
    const paths = new Set();
    for (const entry of document.entries) {
      if (!plainObject(entry) || !["file", "directory"].includes(entry.type) || typeof entry.path !== "string") {
        throw new Error(t("vfs.error.invalidEntry"));
      }
      const normalized = VirtualFileSystem.normalizePath(entry.path);
      if (normalized !== entry.path || normalized === ROOT && entry.type !== "directory") {
        throw new Error(t("vfs.error.invalidEntryPath", { path: entry.path }));
      }
      if (paths.has(normalized)) throw new Error(t("vfs.error.duplicatePath", { path: normalized }));
      paths.add(normalized);
      if (entry.type === "file" && typeof entry.content !== "string") {
        throw new Error(t("vfs.error.invalidContent", { path: normalized }));
      }
      if (entry.metadata !== undefined && !plainObject(entry.metadata)) {
        throw new Error(t("vfs.error.invalidMetadata", { path: normalized }));
      }
      if (entry.metadata?.position !== undefined && !validPosition(entry.metadata.position)) {
        throw new Error(t("vfs.error.invalidMetadata", { path: normalized }));
      }
    }
    if (!paths.has(ROOT)) throw new Error(t("vfs.error.missingRoot"));
    for (const entry of document.entries) {
      if (entry.path === ROOT) continue;
      const parent = parentPath(entry.path);
      if (!paths.has(parent)) throw new Error(t("vfs.error.missingParent", { path: entry.path, parent }));
      const parentEntry = document.entries.find((candidate) => candidate.path === parent);
      if (parentEntry?.type !== "directory") throw new Error(t("vfs.error.parentNotDirectory", { path: entry.path, parent }));
    }
    return true;
  }

  static validateDefaultDocument(document) {
    VirtualFileSystem.validateDocument(document);
    if (document.entries.some((entry) => Object.hasOwn(entry.metadata || {}, "coreOnly"))) {
      throw new Error(t("vfs.error.coreEntryInDefaults"));
    }
    return true;
  }

  loadDefaults(document) {
    VirtualFileSystem.validateDefaultDocument(document);
    this.entries = new Map(document.entries.map((entry) => [entry.path, clone(entry)]));
    if (this.allowCoreOnlyEntries) {
      for (const [path, entry] of this.coreEntries) this.entries.set(path, clone(entry));
    }
    this._changed("defaults-loaded", ROOT);
  }

  injectCoreEntries(entries) {
    if (!this.allowCoreOnlyEntries) throw new Error(t("vfs.error.coreEntryProtected"));
    if (!Array.isArray(entries)) throw new Error(t("vfs.error.invalidEntry"));
    const nextCoreEntries = new Map(this.coreEntries);
    for (const entry of entries) {
      if (!plainObject(entry) || typeof entry.path !== "string") throw new Error(t("vfs.error.invalidEntry"));
      nextCoreEntries.set(entry.path, {
        ...clone(entry),
        metadata: { ...(entry.metadata || {}), coreOnly: true },
      });
    }
    const merged = new Map(this.entries);
    for (const [path, entry] of nextCoreEntries) merged.set(path, clone(entry));
    const document = { version: 1, entries: [...merged.values()] };
    VirtualFileSystem.validateDocument(document);
    this.coreEntries = nextCoreEntries;
    this.entries = merged;
    this._changed("core-inject", ROOT);
  }

  _changed(operation, path) {
    this.eventBus?.emit("vfs:changed", { operation, path });
  }

  get(path, cwd = ROOT) {
    const normalized = VirtualFileSystem.normalizePath(path, cwd);
    const entry = this.entries.get(normalized);
    return entry ? clone(entry) : null;
  }

  exists(path, cwd = ROOT) {
    return this.entries.has(VirtualFileSystem.normalizePath(path, cwd));
  }

  list(path = ROOT, cwd = ROOT) {
    const directory = VirtualFileSystem.normalizePath(path, cwd);
    const entry = this.entries.get(directory);
    if (!entry) throw new Error(t("vfs.error.notFound", { path: directory }));
    if (entry.type !== "directory") throw new Error(t("vfs.error.notDirectory", { path: directory }));
    const prefix = directory === ROOT ? ROOT : `${directory}/`;
    return [...this.entries.values()]
      .filter((candidate) => candidate.path !== directory && candidate.path.startsWith(prefix)
        && !candidate.path.slice(prefix.length).includes("/"))
      .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      .map(clone);
  }

  readFile(path, cwd = ROOT) {
    const normalized = VirtualFileSystem.normalizePath(path, cwd);
    const entry = this.entries.get(normalized);
    if (!entry) throw new Error(t("vfs.error.notFound", { path: normalized }));
    if (entry.type !== "file") throw new Error(t("vfs.error.notFile", { path: normalized }));
    return entry.content;
  }

  writeFile(path, content, { cwd = ROOT, create = false, metadata } = {}) {
    const normalized = VirtualFileSystem.normalizePath(path, cwd);
    if (typeof content !== "string") throw new Error(t("vfs.error.contentMustBeText"));
    if (metadata !== undefined && !plainObject(metadata)) throw new Error(t("vfs.error.invalidMetadata", { path: normalized }));
    if (metadata && Object.hasOwn(metadata, "coreOnly")) throw new Error(t("vfs.error.coreEntryProtected"));
    if (metadata?.position !== undefined && !validPosition(metadata.position)) {
      throw new Error(t("vfs.error.invalidMetadata", { path: normalized }));
    }
    const existing = this.entries.get(normalized);
    if (existing) {
      if (existing.type !== "file") throw new Error(t("vfs.error.notFile", { path: normalized }));
      this._assertUserMutable(existing);
      existing.content = content;
      if (metadata) existing.metadata = { ...(existing.metadata || {}), ...clone(metadata) };
    } else {
      if (!create) throw new Error(t("vfs.error.notFound", { path: normalized }));
      this._requireParent(normalized);
      this.entries.set(normalized, { path: normalized, type: "file", content, ...(metadata ? { metadata: clone(metadata) } : {}) });
    }
    this._changed(existing ? "write" : "create-file", normalized);
    return this.get(normalized);
  }

  createFile(path, content = "", options = {}) {
    return this.writeFile(path, content, { ...options, create: true });
  }

  mkdir(path, { cwd = ROOT, recursive = false } = {}) {
    const normalized = VirtualFileSystem.normalizePath(path, cwd);
    if (this.entries.has(normalized)) throw new Error(t("vfs.error.alreadyExists", { path: normalized }));
    const parent = parentPath(normalized);
    if (parent && !this.entries.has(parent)) {
      if (!recursive) throw new Error(t("vfs.error.missingParent", { path: normalized, parent }));
      this.mkdir(parent, { recursive: true });
    }
    const parentEntry = parent && this.entries.get(parent);
    if (parentEntry && parentEntry.type !== "directory") throw new Error(t("vfs.error.parentNotDirectory", { path: normalized, parent }));
    if (parentEntry) this._assertUserMutable(parentEntry);
    this.entries.set(normalized, { path: normalized, type: "directory" });
    this._changed("create-directory", normalized);
    return this.get(normalized);
  }

  updateMetadata(path, metadata, cwd = ROOT) {
    const normalized = VirtualFileSystem.normalizePath(path, cwd);
    const entry = this.entries.get(normalized);
    if (!entry) throw new Error(t("vfs.error.notFound", { path: normalized }));
    if (!plainObject(metadata)) throw new Error(t("vfs.error.invalidMetadata", { path: normalized }));
    if (Object.hasOwn(metadata, "coreOnly") && entry.metadata?.coreOnly !== true) {
      throw new Error(t("vfs.error.coreEntryProtected"));
    }
    if (metadata.position !== undefined && !validPosition(metadata.position)) {
      throw new Error(t("vfs.error.invalidMetadata", { path: normalized }));
    }
    if (entry.metadata?.coreOnly === true) {
      const keys = Object.keys(metadata);
      if (keys.some((key) => key !== "position")) throw new Error(t("vfs.error.coreEntryProtected"));
    }
    entry.metadata = { ...(entry.metadata || {}), ...clone(metadata), ...(entry.metadata?.coreOnly ? { coreOnly: true } : {}) };
    this._changed("metadata", normalized);
    return this.get(normalized);
  }

  rename(source, target, cwd = ROOT) {
    return this.move(source, target, cwd);
  }

  move(source, target, cwd = ROOT) {
    const from = VirtualFileSystem.normalizePath(source, cwd);
    const to = this._destinationPath(from, target, cwd);
    this._assertMovable(from, to);
    const subtree = this._subtree(from);
    if (subtree.some((entry) => entry.metadata?.coreOnly === true)) throw new Error(t("vfs.error.coreEntryProtected"));
    for (const item of subtree) this.entries.delete(item.path);
    for (const item of subtree) {
      const suffix = item.path === from ? "" : item.path.slice(from.length);
      const movedPath = `${to}${suffix}`;
      this.entries.set(movedPath, { ...clone(item), path: movedPath });
    }
    this._changed("move", to);
    return this.get(to);
  }

  copy(source, target, cwd = ROOT) {
    const from = VirtualFileSystem.normalizePath(source, cwd);
    const to = this._destinationPath(from, target, cwd);
    const entry = this.entries.get(from);
    if (!entry) throw new Error(t("vfs.error.notFound", { path: from }));
    if (to === from || to.startsWith(`${from}/`)) throw new Error(t("vfs.error.copyIntoSelf"));
    if (this.entries.has(to)) throw new Error(t("vfs.error.alreadyExists", { path: to }));
    this._requireParent(to);
    const subtree = this._subtree(from);
    if (subtree.some((item) => item.metadata?.coreOnly === true)) throw new Error(t("vfs.error.coreEntryProtected"));
    for (const item of subtree) {
      const suffix = item.path === from ? "" : item.path.slice(from.length);
      const copiedPath = `${to}${suffix}`;
      this.entries.set(copiedPath, { ...clone(item), path: copiedPath });
    }
    this._changed("copy", to);
    return this.get(to);
  }

  remove(path, cwd = ROOT) {
    const normalized = VirtualFileSystem.normalizePath(path, cwd);
    if (normalized === ROOT) throw new Error(t("vfs.error.cannotRemoveRoot"));
    if (!this.entries.has(normalized)) throw new Error(t("vfs.error.notFound", { path: normalized }));
    const subtree = this._subtree(normalized);
    if (subtree.some((entry) => entry.metadata?.coreOnly === true)) throw new Error(t("vfs.error.coreEntryProtected"));
    for (const entry of subtree) this.entries.delete(entry.path);
    this._changed("remove", normalized);
    return true;
  }

  moveToTrash(path, cwd = ROOT) {
    const source = VirtualFileSystem.normalizePath(path, cwd);
    if (source === ROOT || source === "/trash" || source.startsWith("/trash/")) return this.remove(source);
    const name = basename(source);
    let target = `/trash/${name}`;
    let suffix = 1;
    while (this.entries.has(target)) {
      const dot = name.lastIndexOf(".");
      target = dot > 0 ? `/trash/${name.slice(0, dot)} (${suffix})${name.slice(dot)}` : `/trash/${name} (${suffix})`;
      suffix += 1;
    }
    return this.move(source, target);
  }

  createShortcut(targetPath, directory, label = null, metadata = {}) {
    const target = VirtualFileSystem.normalizePath(targetPath);
    if (!this.entries.has(target)) throw new Error(t("vfs.error.notFound", { path: target }));
    const parent = VirtualFileSystem.normalizePath(directory);
    const targetEntry = this.entries.get(target);
    if (targetEntry.metadata?.coreOnly === true) throw new Error(t("vfs.error.coreEntryProtected"));
    if (Object.hasOwn(metadata || {}, "coreOnly")) throw new Error(t("vfs.error.coreEntryProtected"));
    const suggestedName = label || basename(target);
    let name = suggestedName.endsWith(".lnk") ? suggestedName : `${suggestedName}.lnk`;
    let path = joinPath(parent, name);
    let suffix = 1;
    while (this.entries.has(path)) {
      name = `${suggestedName.replace(/\.lnk$/, "")} (${suffix++}).lnk`;
      path = joinPath(parent, name);
    }
    return this.createFile(path, target, { metadata: clone(metadata) });
  }

  resolveShortcut(path, cwd = ROOT) {
    const entry = this.get(path, cwd);
    if (!entry || entry.type !== "file" || !entry.path.endsWith(".lnk")) return null;
    const target = VirtualFileSystem.normalizePath(entry.content);
    const targetEntry = this.entries.get(target);
    return targetEntry ? { shortcut: entry, target: clone(targetEntry) } : null;
  }

  _destinationPath(source, target, cwd) {
    const normalizedTarget = VirtualFileSystem.normalizePath(target, cwd);
    if (!this.entries.has(source)) throw new Error(t("vfs.error.notFound", { path: source }));
    const targetEntry = this.entries.get(normalizedTarget);
    const result = targetEntry?.type === "directory" ? joinPath(normalizedTarget, basename(source)) : normalizedTarget;
    this._requireParent(result);
    if (this.entries.has(result)) throw new Error(t("vfs.error.alreadyExists", { path: result }));
    return result;
  }

  _requireParent(path) {
    const parent = parentPath(path);
    const entry = parent && this.entries.get(parent);
    if (!entry) throw new Error(t("vfs.error.missingParent", { path, parent }));
    if (entry.type !== "directory") throw new Error(t("vfs.error.parentNotDirectory", { path, parent }));
    this._assertUserMutable(entry);
  }

  _assertUserMutable(entry) {
    if (entry?.metadata?.coreOnly === true) throw new Error(t("vfs.error.coreEntryProtected"));
  }

  _assertMovable(from, to) {
    if (from === ROOT) throw new Error(t("vfs.error.cannotMoveRoot"));
    if (!this.entries.has(from)) throw new Error(t("vfs.error.notFound", { path: from }));
    if (this.entries.has(to)) throw new Error(t("vfs.error.alreadyExists", { path: to }));
    if (to === from || to.startsWith(`${from}/`)) throw new Error(t("vfs.error.moveIntoSelf"));
    this._requireParent(to);
  }

  _subtree(path) {
    return [...this.entries.values()].filter((entry) => entry.path === path || entry.path.startsWith(`${path}/`));
  }

  snapshot() {
    return { version: 1, entries: [...this.entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(clone) };
  }

  restore(snapshot) {
    VirtualFileSystem.validateDocument(snapshot);
    const coreOnlyPaths = new Set(snapshot.entries.filter((entry) => entry.metadata?.coreOnly === true).map((entry) => entry.path));
    const excludedDirectories = snapshot.entries
      .filter((entry) => entry.type === "directory" && entry.metadata?.coreOnly === true)
      .map((entry) => entry.path);
    const nextEntries = new Map(snapshot.entries
      .filter((entry) => (entry.metadata?.coreOnly !== true
        || (this.allowCoreOnlyEntries && this.coreEntries.has(entry.path)))
        && (this.allowCoreOnlyEntries || !this._shortcutTargetsAny(entry, coreOnlyPaths))
        && !excludedDirectories.some((path) => entry.path.startsWith(`${path}/`)))
      .map((entry) => [entry.path, clone(entry)]));
    if (this.allowCoreOnlyEntries) {
      for (const [path, entry] of this.coreEntries) {
        const saved = snapshot.entries.find((candidate) => candidate.path === path && candidate.metadata?.coreOnly === true);
        const position = saved?.metadata?.position;
        const metadata = { ...(entry.metadata || {}), ...(position && validPosition(position) ? { position: clone(position) } : {}), coreOnly: true };
        nextEntries.set(path, { ...clone(entry), metadata });
      }
    }
    VirtualFileSystem.validateDocument({ version: 1, entries: [...nextEntries.values()] });
    this.entries = nextEntries;
    this.clipboard = null;
    this._changed("restore", ROOT);
  }

  _shortcutTargetsAny(entry, paths) {
    if (entry.type !== "file" || !entry.path.endsWith(".lnk")) return false;
    try { return paths.has(VirtualFileSystem.normalizePath(entry.content)); }
    catch { return false; }
  }
}

export default VirtualFileSystem;
