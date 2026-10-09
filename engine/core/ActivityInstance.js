/**
 * ActivityInstance - canonical shape for a single Activity instance plus
 * helpers to create/clone one. ActivityQueue is the only module allowed to
 * assign `instanceId` (it owns the per-activity sequence numbers); this
 * module just owns the instance's field defaults so every queue produces
 * consistent, snapshot-safe instances.
 */
export function createActivityInstance({ instanceId, activityId, queueId, currentNodeId = null, payload = null, parameters = [], receivedDay = null, receivedTime = null, receivedPhase = null, localVariables = {} }) {
  return {
    instanceId,
    activityId,
    queueId,
    status: "unresolved",
    resolutionReason: null,
    currentNodeId,
    currentStep: currentNodeId ? { nodeId: currentNodeId, status: "pending" } : null,
    waitingNodeId: null,
    executedNodeIds: [],
    executionStep: 0,
    executionTrace: [],
    breakpointNodeIds: [],
    pausedAtBreakpointId: null,
    localVariables: structuredClone(localVariables || {}),
    payload,
    parameters: structuredClone(Array.isArray(parameters) ? parameters : []),
    receivedDay,
    receivedTime,
    receivedPhase,
  };
}

/** Deep clone, breaking every reference — used by ActivityQueue.snapshot() to emulate a true save/load boundary. */
export function cloneActivityInstance(instance) {
  return JSON.parse(JSON.stringify(instance));
}

export default createActivityInstance;
