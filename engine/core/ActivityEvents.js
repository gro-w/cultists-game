/**
 * ActivityEvents - the EventBus protocol for the Activity runtime (plan
 * §13 Phase 2 "EventBus 协议"). Every module that reacts to activity
 * lifecycle changes should subscribe to these names instead of inventing
 * ad-hoc event strings.
 */
export const ACTIVITY_EVENTS = Object.freeze({
  appended: "activity:appended",
  changed: "activity:changed",
  completed: "activity:completed",
  cancelled: "activity:cancelled",
  failed: "activity:failed",
  localVariableChanged: "activity:local-variable-changed",
});

export default ACTIVITY_EVENTS;
