import { t } from "./i18n/index.js";
/**
 * DesktopIconManager - plan §8.1/§8.2's icon layout + double-click routing
 * model. Every icon is a plain data record:
 *
 *   { iconId, label, glyph, order, position: {mode:"grid"} | {mode:"free", x, y},
 *     blueprintId, inputs }
 *
 * `blueprintId` is either one of `BUILTIN_ICON_BLUEPRINT_IDS` or a custom
 * Activity id already registered in the ActivityDefinitionStore; either
 * way the icon itself never references a windowId/activityId/consumeTime
 * call directly (plan §8.2 "双击只绑定一个稳定的 blueprint ID 和输入参数;
 * 不在图标数据中内联另一套执行器"). Resolving *which* blueprint that id
 * means is the caller's job (see engine.js's `runIconBlueprint`); this
 * class only owns the icon list itself - order, position and the
 * declared blueprint reference - so it can be unit-tested without a
 * running Activity engine.
 */
export class DesktopIconManager {
  constructor(icons = [], { virtualFileSystem = null, appRegistry = null } = {}) {
    this.icons = new Map();
    this.virtualFileSystem = virtualFileSystem;
    this.appRegistry = appRegistry;
    icons.forEach((icon, index) => this.register({ order: index, ...icon }));
  }

  listDirectory(directory) {
    if (!this.virtualFileSystem) return this.list();
    return this.virtualFileSystem.list(directory)
      .map((entry, index) => {
        const shortcutEntry = entry.path.endsWith(".lnk");
        const resolved = shortcutEntry ? this.virtualFileSystem.resolveShortcut(entry.path) : null;
        const target = resolved?.target || entry;
        const filename = target.path.slice(target.path.lastIndexOf("/") + 1);
        const isText = target.type === "file" && filename.endsWith(".txt");
        const isShellScript = target.type === "file" && filename.endsWith(".sh");
        const hasShebang = target.type === "file" && target.content.startsWith("#!");
        const isScript = isShellScript || hasShebang;
        const programId = target.type === "file" && !isText && !isScript ? target.content.trim() : null;
        const program = programId ? this.appRegistry?.get(programId) : null;
        const fallback = programId && !program ? this.appRegistry?.getDefaultProgram?.() : null;
        const position = entry.metadata?.position;
        const blueprintId = target.type === "directory"
          ? "desktop.open-folder"
          : isScript ? "desktop.open-script"
            : isText ? "desktop.open-file" : "desktop.launch-program";
        return {
          iconId: entry.path,
          sourcePath: entry.path,
          targetPath: target.path,
          programId,
          label: program?.title || fallback?.title || (shortcutEntry ? entry.path.slice(entry.path.lastIndexOf("/") + 1, -4) : filename),
          glyph: target.type === "directory" ? "📁" : program?.icon || fallback?.icon || (isText || isScript ? "📄" : this.appRegistry?.document?.defaultProgramIcon || "⚙️"),
          order: index,
          position: { mode: "free", x: Number.isFinite(position?.x) ? position.x : 0, y: Number.isFinite(position?.y) ? position.y : index * 80 },
          blueprintId,
          inputs: { targetPath: target.path },
          startMenu: true,
        };
      });
  }

  register(icon) {
    if (!icon?.iconId) throw new Error(t("error.84614b33f867"));
    if (!icon.blueprintId) throw new Error(`Icon "${icon.iconId}" must declare a blueprintId`);
    const position = icon.position && icon.position.mode ? icon.position : { mode: "grid" };
    this.icons.set(icon.iconId, {
      iconId: icon.iconId,
      label: icon.label || icon.iconId,
      glyph: icon.glyph || "📦",
      order: Number.isFinite(icon.order) ? icon.order : this.icons.size,
      position,
      blueprintId: icon.blueprintId,
      inputs: icon.inputs || {},
      startMenu: icon.startMenu !== false,
      // Engine-owned icons are injected at runtime and never belong to the
      // game's editable data or save payload.
      engineOwned: icon.engineOwned === true,
    });
    return this.icons.get(icon.iconId);
  }

  get(iconId) {
    return this.icons.get(iconId) || null;
  }

  /** Icons in display order (stable sort keeps insertion order for equal `order` values). */
  list({ includeEngineOwned = false, directory = "/home/desktop" } = {}) {
    if (this.virtualFileSystem) return this.listDirectory(directory);
    return [...this.icons.values()]
      .filter((icon) => includeEngineOwned || !icon.engineOwned)
      .map((icon, index) => ({ icon, index }))
      .sort((a, b) => a.icon.order - b.icon.order || a.index - b.index)
      .map(({ icon }) => icon);
  }

  /** Moves an icon to a new grid order, shifting every other icon's order accordingly (plan §8.2 "拖动图标调整位置/选择图标顺序"). */
  reorder(iconId, newOrder) {
    if (this.virtualFileSystem) return false;
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.position = { mode: "grid" };
    const ordered = this.list().filter((entry) => entry.iconId !== iconId);
    const at = Math.max(0, Math.min(ordered.length, newOrder));
    ordered.splice(at, 0, icon);
    ordered.forEach((entry, index) => (entry.order = index));
    return true;
  }

  /** Switches an icon to free x/y placement (plan §8.1 "自由 x/y"). */
  setFreePosition(iconId, x, y) {
    if (this.virtualFileSystem) {
      if (!this.virtualFileSystem.exists(iconId)) return false;
      this.virtualFileSystem.updateMetadata(iconId, { position: { x, y } });
      return true;
    }
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.position = { mode: "free", x, y };
    return true;
  }

  setLogo(iconId, glyph) {
    if (this.virtualFileSystem) return false;
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.glyph = glyph;
    return true;
  }

  setLabel(iconId, label) {
    if (this.virtualFileSystem) return false;
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.label = label;
    return true;
  }

  /** Updates the icon's declared blueprint reference + inputs (plan §8.2 "指定双击行为"). */
  setBlueprint(iconId, blueprintId, inputs = {}) {
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.blueprintId = blueprintId;
    icon.inputs = inputs;
    return true;
  }

  setStartMenu(iconId, visible) {
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.startMenu = Boolean(visible);
    return true;
  }

  unregister(iconId) {
    return this.icons.delete(iconId);
  }

  toJSON() {
    return this.list();
  }

  restore(icons = []) {
    const engineIcons = [...this.icons.values()].filter((icon) => icon.engineOwned);
    this.icons.clear();
    engineIcons.forEach((icon) => this.icons.set(icon.iconId, icon));
    icons
      .filter((icon) => !icon.engineOwned)
      .forEach((icon, index) => this.register({ order: index, ...icon }));
  }
}

export default DesktopIconManager;
