export function createApiRegistry({ eventBus: bus, variableStore, publicVariableManager, activityQueueRegistry, shell, timeService, dataStore, runtimeGateway, audioPlayback = null }) {
  const handlers = new Map([
    ["engine.getVariable", ({ key }) => variableStore.get(key)],
    ["engine.setVariable", ({ key, value }) => (variableStore.set(key, value), value)],
    ["engine.getPublicVariable", ({ id }) => publicVariableManager.get(id)],
    ["engine.setPublicVariable", ({ id, value }) => (publicVariableManager.set(id, value), value)],
    ["engine.emit", ({ event, payload }) => (bus.emit(event, payload), true)],
    ["engine.consumeTime", ({ minutes }) => timeService.consume(Number(minutes) || 0, { source: "activity" })],
    ["engine.publicVariableOperation", ({ id, operation = "delta", value = 0, minimum = 0 }) => {
      const current = Number(publicVariableManager.get(id) || 0);
      const next = operation === "delta" ? current + Number(value || 0) : value;
      if (typeof next === "number" && next < Number(minimum)) return { ok: false, reason: "insufficient", current, next };
      publicVariableManager.set(id, next);
      return { ok: true, id, previous: current, current: next };
    }],
    ["runtime.collection.operation", ({ collectionId, recordId, operation = "delta", value = 0, minimum = 0 }) => runtimeGateway.operateCollection(collectionId, recordId, { operation, value, minimum })],
    ["engine.records", ({ databaseId, query = {} }) => dataStore.findRecords(databaseId, query)],
    ["engine.queue.list", ({ queueId = "main", filters }) => activityQueueRegistry.listEntries(queueId, filters)],
    ["engine.queue.listQueues", () => activityQueueRegistry.listQueues()],
    ["engine.queue.get", ({ queueId = "main", instanceId }) => activityQueueRegistry.getEntry(queueId, instanceId)],
    ["engine.queue.append", ({ queueId = "main", ...options }) => activityQueueRegistry.append(queueId, options)],
    ["engine.queue.update", ({ queueId = "main", instanceId, patch }) => activityQueueRegistry.updateEntry(queueId, instanceId, patch)],
    ["engine.queue.complete", ({ queueId = "main", instanceId }) => activityQueueRegistry.completeEntry(queueId, instanceId)],
    ["engine.queue.cancel", ({ queueId = "main", instanceId }) => activityQueueRegistry.cancelEntry(queueId, instanceId)],
    ["engine.queue.remove", ({ queueId = "main", instanceId }) => activityQueueRegistry.removeEntry(queueId, instanceId)],
    ["engine.openWindow", ({ windowId }) => (shell.openWindow(windowId), true)],
    ["audio.playLoop", ({ trackId }) => audioPlayback?.play(trackId) || { ok: false, reason: "audio-unavailable" }],
    ["audio.stop", () => audioPlayback?.stop() || { ok: false, reason: "audio-unavailable" }],
    ["audio.volume", ({ volume }) => audioPlayback?.setVolume(volume) ?? 0],
    ["audio.layer", ({ action, trackId }) => audioPlayback?.applyLayer(action, trackId) || { ok: false, reason: "audio-unavailable" }],
  ]);
  return {
    call(apiId, payload = {}) {
      const handler = handlers.get(apiId);
      if (!handler) throw new Error(`Unknown engine API: ${apiId}`);
      return handler(payload);
    },
    list() { return [...handlers.keys()]; },
    register(apiId, handler) { handlers.set(apiId, handler); },
  };
}

export default createApiRegistry;
