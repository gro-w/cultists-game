import { t } from "./i18n/index.js";
import { createActivityInstance, cloneActivityInstance } from "./ActivityInstance.js";

/**
 * ActivityQueue - an ordered collection of Activity instances for one
 * queue (e.g. "main"). Owns instanceId assignment (per-activity sequence
 * numbers) and instance mutation; ActivityRunner/ActivityExecutionService
 * never touch `entries` directly, only through this API.
 */
export class ActivityQueue {
  constructor(queueId, options = {}) {
    this.queueId = queueId;
    this.nonBlocking = Boolean(options.nonBlocking);
    this.entries = [];
    this._entriesById = new Map();
    this._sequence = new Map();
  }

  /** Append a new instance for `activityId` and return the created instance. */
  append({ activityId, instanceId, currentNodeId, payload = null, parameters = [], receivedDay = null, receivedTime = null, receivedPhase = null } = {}) {
    if (!activityId) throw new Error(t("error.37554c5966cc"));
    const sequence = (this._sequence.get(activityId) || 0) + 1;
    this._sequence.set(activityId, sequence);
    const instance = createActivityInstance({
      instanceId: instanceId || `${activityId}:${sequence}`,
      activityId,
      queueId: this.queueId,
      currentNodeId,
      payload,
      parameters,
      receivedDay,
      receivedTime,
      receivedPhase,
    });
    this.entries.push(instance);
    if (!this._entriesById.has(instance.instanceId)) this._entriesById.set(instance.instanceId, instance);
    return instance;
  }

  get(instanceId) {
    return this._entriesById.get(instanceId) || null;
  }

  /** Read-only list for blueprint/debugger APIs. */
  list({ status = null, activityId = null } = {}) {
    return this.entries.filter((entry) =>
      (!status || entry.status === status) && (!activityId || entry.activityId === activityId));
  }

  update(instanceId, patch = {}) {
    const entry = this.get(instanceId);
    if (!entry) return false;
    Object.assign(entry, patch);
    return true;
  }

  remove(instanceId) {
    const index = this.entries.findIndex((entry) => entry.instanceId === instanceId);
    if (index < 0) return false;
    const [removed] = this.entries.splice(index, 1);
    if (this._entriesById.get(instanceId) === removed) {
      const duplicate = this.entries.find((entry) => entry.instanceId === instanceId);
      if (duplicate) this._entriesById.set(instanceId, duplicate);
      else this._entriesById.delete(instanceId);
    }
    return true;
  }

  /** Idempotent: completing an already-resolved instance is a no-op, not an error. */
  complete(instanceId) {
    const entry = this.get(instanceId);
    if (!entry || entry.status === "resolved") return false;
    entry.status = "resolved";
    entry.resolutionReason = entry.resolutionReason || "completed";
    return true;
  }

  cancel(instanceId) {
    const entry = this.get(instanceId);
    if (!entry || entry.status === "resolved") return false;
    entry.status = "resolved";
    entry.resolutionReason = "cancelled";
    return true;
  }

  /** The single active (unresolved) instance — queues are processed one at a time. */
  current() {
    return this.entries.find((entry) => entry.status === "unresolved") || null;
  }

  countByActivity(activityId) {
    return this.entries.filter((entry) => entry.activityId === activityId).length;
  }

  /** Deep-cloned entries, breaking every live reference (true save boundary). */
  snapshot() {
    return this.entries.map((entry) => cloneActivityInstance(entry));
  }

  restore(entries = []) {
    if (!Array.isArray(entries)) throw new Error(t("error.fcbb38a38162"));
    const seen = new Set();
    this.entries = entries.map((entry) => {
      if (!entry || typeof entry !== "object" || typeof entry.activityId !== "string" || !entry.activityId) {
        throw new Error(t("error.5e231e810e63"));
      }
      if (typeof entry.instanceId !== "string" || !entry.instanceId || seen.has(entry.instanceId)) {
        throw new Error(t("error.4339352ad20c"));
      }
      seen.add(entry.instanceId);
      const restored = cloneActivityInstance(entry);
      restored.parameters = Array.isArray(restored.parameters) ? restored.parameters : [];
      restored.executedNodeIds = Array.isArray(restored.executedNodeIds) ? restored.executedNodeIds : [];
      restored.executionTrace = Array.isArray(restored.executionTrace) ? restored.executionTrace : [];
      restored.executionStep = Math.max(
        Number.isInteger(restored.executionStep) && restored.executionStep >= 0 ? restored.executionStep : 0,
        restored.executionTrace.length,
      );
      restored.breakpointNodeIds = Array.isArray(restored.breakpointNodeIds) ? [...new Set(restored.breakpointNodeIds.map(String))] : [];
      restored.pausedAtBreakpointId = typeof restored.pausedAtBreakpointId === "string" ? restored.pausedAtBreakpointId : null;
      if (!restored.currentStep && restored.currentNodeId) {
        restored.currentStep = { nodeId: restored.currentNodeId, status: restored.waitingNodeId ? "waiting" : "pending" };
      }
      return restored;
    });
    this._entriesById = new Map(this.entries.map((entry) => [entry.instanceId, entry]));
    this._sequence = new Map();
    this.entries.forEach((entry) => {
      const match = String(entry.instanceId).match(/:(\d+)$/);
      if (!match) return;
      const next = Number(match[1]);
      this._sequence.set(entry.activityId, Math.max(this._sequence.get(entry.activityId) || 0, next));
    });
  }
}

export default ActivityQueue;
