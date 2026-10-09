import { t } from "./i18n/index.js";
/** Routes opaque Activity display events to the currently mounted receiver for a data-declared target. */
export class DisplayReceiverRegistry {
  constructor() {
    this.receivers = new Map();
    this.pending = new Map();
    this.lastTarget = null;
  }

  register(target, receiver) {
    target = this._target(target);
    if (!target || !receiver || typeof receiver.handle !== "function") throw new Error(t("error.3e276326c833"));
    this.receivers.set(target, receiver);
    this.lastTarget = target;
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] receiver registered", { target, receiverCount: this.receivers.size, pending: (this.pending.get(target) || []).length });
    /* DEV-TOOLS:END */
    const pending = this.pending.get(target) || [];
    this.pending.delete(target);
    pending.forEach((payload) => receiver.handle(payload));
    return () => {
      if (this.receivers.get(target) === receiver) this.receivers.delete(target);
      if (this.lastTarget === target && !this.receivers.has(target)) this.lastTarget = [...this.receivers.keys()].at(-1) || null;
    };
  }

  dispatch(target, payload) {
    target = this._target(target);
    const resolvedTarget = target === "default" && !this.receivers.has(target) ? this.lastTarget : target;
    const receiver = this.receivers.get(resolvedTarget);
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] receiver dispatch", { target, resolvedTarget, type: payload?.type, receiver: Boolean(receiver), pendingTargets: [...this.pending.keys()] });
    /* DEV-TOOLS:END */
    if (!receiver) {
      const pending = this.pending.get(target) || [];
      pending.push(payload);
      if (pending.length > 50) pending.shift();
      this.pending.set(target, pending);
      return false;
    }
    receiver.handle(payload);
    return true;
  }

  has(target) { return this.receivers.has(target); }
  clear() { this.receivers.clear(); this.pending.clear(); this.lastTarget = null; }

  _target(target) {
    const value = String(target ?? "").trim();
    return value || "default";
  }
}

export default DisplayReceiverRegistry;
