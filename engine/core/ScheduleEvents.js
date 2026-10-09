export const ACTIVITY_EVENTS = Object.freeze({
  appended: "schedule:appended",
  changed: "schedule:changed",
  resolved: "schedule:resolved",
  completed: "schedule:completed",
  triggered: "schedule:triggered",
  requested: "schedule:requested",
  image: "schedule:image",
  cg: "schedule:cg",
  endCg: "schedule:end_cg",
});

export function scheduleEventPayload(queueId, instance, extra = {}) {
  return { queueId: queueId || null, instanceId: instance?.instanceId || null, instance: instance || null, ...extra };
}
