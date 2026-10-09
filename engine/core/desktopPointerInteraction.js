/**
 * PointerInteraction - shared drag/resize gesture helper used by
 * desktop/WindowFrame.js for both title-bar dragging and resize handles.
 *
 * Kept DOM-independent (only requires addEventListener/removeEventListener
 * on the injected `target`) so the "close/restore leaks no listeners"
 * probe can exercise it with a lightweight fake target instead of a real
 * browser window.
 */
export class PointerInteraction {
  constructor(target = typeof window !== "undefined" ? window : null) {
    this.target = target;
    this._active = null;
  }

  /** True while a drag/resize gesture is in progress. */
  get isActive() {
    return !!this._active;
  }

  /**
   * Begin tracking pointer movement until pointerup fires (or cancel() is
   * called explicitly, e.g. because the window closed mid-gesture).
   * @param {{ onMove:(event:any)=>void, onEnd?:(event:any)=>void }} handlers
   */
  start({ onMove, onEnd }) {
    this.cancel();
    const moveHandler = (event) => onMove(event);
    const upHandler = (event) => {
      this.cancel();
      if (onEnd) onEnd(event);
    };
    this.target.addEventListener("pointermove", moveHandler);
    this.target.addEventListener("pointerup", upHandler);
    this._active = { moveHandler, upHandler };
  }

  /** Stop tracking and detach listeners without firing onEnd. */
  cancel() {
    if (!this._active) return;
    this.target.removeEventListener("pointermove", this._active.moveHandler);
    this.target.removeEventListener("pointerup", this._active.upHandler);
    this._active = null;
  }
}

export default PointerInteraction;
