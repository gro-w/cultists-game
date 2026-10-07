/**
 * DesktopIcon - renders icons from `DesktopIconManager.list()` (plan §8.1/
 * §8.2). Supports two position modes per icon:
 * - `grid`: normal flow order in the icon layer, drag-and-drop reorders
 *   via `onReorder(iconId, newOrder)` (persisted through
 *   `DesktopIconManager.reorder`).
 * - `free`: absolute `x`/`y` placement, drag-and-drop calls
 *   `onFreeMove(iconId, x, y)` instead of reordering.
 * Double-click always calls `onActivate(icon)`, which the caller (engine.js)
 * routes through the icon's declared `blueprintId` - never a
 * windowId/activityId shortcut baked into this renderer.
 */
export function renderDesktopIcons(rootEl, icons, { onActivate, onReorder, onFreeMove } = {}) {
  rootEl.innerHTML = "";
  icons.forEach((icon, displayIndex) => {
    const el = document.createElement("div");
    el.className = "desktop-icon";
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-label", icon.label || "");
    el.draggable = true;
    el.dataset.iconId = icon.iconId;
    el.classList.add("desktop-icon-free");
    el.style.left = `${icon.position?.x ?? 0}px`;
    el.style.top = `${icon.position?.y ?? 0}px`;
    const glyph = document.createElement("span");
    glyph.className = "icon-glyph";
    glyph.textContent = icon.glyph || "📦";
    const label = document.createElement("span");
    label.className = "icon-label";
    label.textContent = icon.label || "";
    el.append(glyph, label);
    // Opening is intentionally double-click-only.  Count the two click
    // events ourselves as well as listening for dblclick: embedded browser
    // surfaces do not always synthesize dblclick, while a single click must
    // never start an Activity or open a window.
    let clickTimer = null;
    let lastActivationAt = -Infinity;
    const activate = () => {
      const now = performance.now();
      if (now - lastActivationAt < 400) return;
      lastActivationAt = now;
      onActivate?.(icon);
    };
    el.addEventListener("click", () => {
      if (clickTimer !== null) {
        clearTimeout(clickTimer);
        clickTimer = null;
        activate();
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = null;
      }, 400);
    });
    el.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (clickTimer !== null) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      activate();
    });
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/desktop-icon-id", icon.iconId);
    });
    el.addEventListener("dragover", (e) => e.preventDefault());
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData("text/desktop-icon-id");
      if (!draggedId || draggedId === icon.iconId) return;
      const rect = rootEl.getBoundingClientRect();
      onFreeMove?.(draggedId, Math.max(0, e.clientX - rect.left), Math.max(0, e.clientY - rect.top));
    });
    rootEl.appendChild(el);
  });
  // Dropping on empty desktop space: a free-position icon lands wherever
  // released; a grid icon dropped past the last one appends to the end.
  rootEl.ondragover = (e) => e.preventDefault();
  rootEl.ondrop = (e) => {
    if (e.target !== rootEl) return;
    const draggedId = e.dataTransfer.getData("text/desktop-icon-id");
    if (!draggedId) return;
    const dragged = icons.find((icon) => icon.iconId === draggedId);
    if (dragged?.position?.mode === "free") {
      const rect = rootEl.getBoundingClientRect();
      onFreeMove?.(draggedId, Math.max(0, e.clientX - rect.left), Math.max(0, e.clientY - rect.top));
    } else {
      onReorder?.(draggedId, icons.length);
    }
  };
}

export default renderDesktopIcons;
