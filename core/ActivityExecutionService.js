import { t } from "./i18n/index.js";
import { createActivityRunner } from "./ActivityRunner.js";
import { ACTIVITY_EVENTS } from "./ActivityEvents.js";

function scopedVariableStore(globalStore, instance, eventBus) {
  return {
    get(key) {
      if (String(key).startsWith("__local:")) return instance.localVariables?.[String(key).slice(8)];
      return globalStore?.get(key);
    },
    set(key, value) {
      if (String(key).startsWith("__local:")) {
        instance.localVariables = instance.localVariables || {};
        instance.localVariables[String(key).slice(8)] = structuredClone(value);
        eventBus?.emit("activity:local-variable-changed", { instanceId: instance.instanceId, key: String(key).slice(8), value });
        return;
      }
      globalStore?.set(key, value);
    },
    delta(key, amount) {
      if (String(key).startsWith("__local:")) {
        const current = Number(this.get(key)) || 0;
        this.set(key, current + (Number(amount) || 0));
        return;
      }
      globalStore?.delta(key, amount);
    },
  };
}

/**
 * ActivityExecutionService - owns ActivityRunner lifetimes. Guarantees a
 * terminal event (`completed`/`cancelled`/`failed`) is emitted at most once
 * per instanceId, even if `complete()`/`cancel()` is called again or the
 * runner naturally finishes after being externally cancelled.
 */
export class ActivityExecutionService {
  constructor(eventBus, gateways = {}) {
    this.eventBus = eventBus;
    this.runtimeGateway = gateways.runtimeGateway || null;
    this.activityDefinitionStore = gateways.activityDefinitionStore || null;
    this.runners = new Map();
    this._firedTerminal = new Set();
  }

  run({ queue, definition, instance, variableStore, timeGateway, windowGateway, activityGateway, eventGateway, dbGateway, pvGateway, runtimeGateway, eventStateGateway, onboardingGateway = eventStateGateway, apiGateway } = {}) {
    if (!queue || !definition || !instance) return null;
    if (instance.status === "resolved" || this.runners.has(instance.instanceId)) return null;

    const runner = createActivityRunner({
      definition,
      instance,
      variableStore: scopedVariableStore(variableStore, instance, this.eventBus),
      eventBus: this.eventBus,
      timeGateway,
      windowGateway,
      activityGateway,
      eventGateway,
      dbGateway,
      pvGateway,
      runtimeGateway: runtimeGateway || this.runtimeGateway,
      eventStateGateway: eventStateGateway || onboardingGateway,
      apiGateway,
      onCheckpoint: (updated, { notify = true } = {}) => {
        queue.update(updated.instanceId, updated);
        if (notify) this.eventBus.emit(ACTIVITY_EVENTS.changed, { queueId: queue.queueId, instance: { ...updated } });
      },
      onComplete: (updated, reason) => {
        queue.update(updated.instanceId, updated);
        this.runners.delete(updated.instanceId);
        this._emitTerminalOnce(queue.queueId, updated, reason);
      },
    });

    this.runners.set(instance.instanceId, runner);
    runner.start();
    return runner;
  }

  _emitTerminalOnce(queueId, instance, reason) {
    if (this._firedTerminal.has(instance.instanceId)) return;
    this._firedTerminal.add(instance.instanceId);
    const eventName = reason === "cancelled"
      ? ACTIVITY_EVENTS.cancelled
      : reason === "failed"
        ? ACTIVITY_EVENTS.failed
        : ACTIVITY_EVENTS.completed;
    this.eventBus.emit(eventName, { queueId, instance: { ...instance } });
  }

  get(instanceId) {
    return this.runners.get(instanceId) || null;
  }

  getDebugState(instanceId) {
    return this.get(instanceId)?.getDebugState() || null;
  }

  /** Public lifecycle/queue surface for custom manager Activities. */
  append(queue, options) {
    if (!queue) throw new Error(t("error.cfb9042df3bb"));
    return queue.append(options);
  }

  read(queue, instanceId) {
    return queue?.get(instanceId) || null;
  }

  list(queue, filters) {
    return queue?.list(filters) || [];
  }

  update(queue, instanceId, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
    const instance = queue?.get(instanceId);
    if (!instance) return false;
    const definition = this.activityDefinitionStore?.get(instance.activityId);
    const flowNodeIds = definition?.compiled?.flowNodeIds;
    if (flowNodeIds && Object.prototype.hasOwnProperty.call(patch, "currentNodeId") && !flowNodeIds.includes(patch.currentNodeId)) return false;
    if (Object.prototype.hasOwnProperty.call(patch, "status") && !["unresolved", "paused", "failed", "resolved"].includes(patch.status)) return false;
    if (Object.prototype.hasOwnProperty.call(patch, "breakpointNodeIds")) {
      if (!Array.isArray(patch.breakpointNodeIds)) return false;
      const breakpointNodeIds = [...new Set(patch.breakpointNodeIds.map(String))];
      if (flowNodeIds && breakpointNodeIds.some((nodeId) => !flowNodeIds.includes(nodeId))) return false;
      patch = { ...patch, breakpointNodeIds };
    }
    const runner = this.get(instanceId);
    if (runner && Object.prototype.hasOwnProperty.call(patch, "currentNodeId") && !runner.setCurrentNode(patch.currentNodeId)) return false;
    if (Object.prototype.hasOwnProperty.call(patch, "breakpointNodeIds")) {
      if (!Array.isArray(patch.breakpointNodeIds)) return false;
      if (runner && !runner.setBreakpoints(patch.breakpointNodeIds)) return false;
    }
    if (runner && Object.prototype.hasOwnProperty.call(patch, "status")) {
      if (!runner.setStatus(patch.status)) return false;
      const { status: _status, ...remainingPatch } = patch;
      patch = remainingPatch;
    }
    if (runner && !Object.keys(patch).length) return true;
    return queue?.update(instanceId, patch) || false;
  }

  setLocalVariable(instanceId, key, value) {
    return this.get(instanceId)?.setLocalVariable(key, value) || false;
  }

  setBreakpoints(instanceId, nodeIds) {
    return this.get(instanceId)?.setBreakpoints(nodeIds) || false;
  }

  complete(queue, instanceId) {
    return queue?.complete(instanceId) || false;
  }

  cancelEntry(queue, instanceId) {
    return queue?.cancel(instanceId) || false;
  }

  pause(instanceId) {
    return this.get(instanceId)?.pause() || false;
  }

  resume(instanceId) {
    return this.get(instanceId)?.resume() || false;
  }

  cancel(instanceId) {
    return this.get(instanceId)?.cancel() || false;
  }

  /** Restore-safe teardown: cancels every live runner without re-emitting terminal events for already-resolved instances. */
  clear() {
    this.runners.forEach((runner) => runner.cancel());
    this.runners.clear();
  }
}

export default ActivityExecutionService;
