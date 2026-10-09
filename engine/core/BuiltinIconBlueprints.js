/**
 * BuiltinIconBlueprints - plan §8.3's "内置图标 blueprint": a small,
 * unmodifiable set of desktop icon behaviours, referenced by id only.
 * Desktop icons never call `openWindow`/`consumeTime`/etc. directly; they
 * declare a stable `blueprintId` (one of these, or a custom Activity id)
 * plus `inputs`, and the *exact same* generic ActivityRunner/
 * ActivityExecutionService that runs every other Activity executes it.
 *
 * Every blueprint here is a value-input passthrough: the icon's own
 * `inputs` (e.g. `{ windowId: "example" }`) are copied straight onto the
 * relevant node's `inputs`, so no new wiring convention is needed - the
 * icon's declared inputs *are* the blueprint's node inputs.
 */
const BUILTIN_ICON_BLUEPRINTS = {
  "desktop.open-window": (inputs) => ({
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      open: { id: "open", type: "openWindow", inputs: { windowId: inputs.windowId } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "open", toPort: "flowIn" },
      { fromNodeId: "open", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  }),
  "desktop.open-window-and-advance-time": (inputs) => ({
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      open: { id: "open", type: "openWindow", inputs: { windowId: inputs.windowId } },
      consume: { id: "consume", type: "callApi", inputs: { apiId: "engine.consumeTime", payload: { minutes: inputs.minutes ?? 0 } } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "open", toPort: "flowIn" },
      { fromNodeId: "open", fromPort: "flowOut", toNodeId: "consume", toPort: "flowIn" },
      { fromNodeId: "consume", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  }),
  "desktop.run-activity": (inputs) => ({
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      run: { id: "run", type: "runActivity", inputs: { activityId: inputs.activityId, queueId: inputs.queueId ?? "main" } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "run", toPort: "flowIn" },
      { fromNodeId: "run", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  }),
  "desktop.emit-event": (inputs) => ({
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      emit: { id: "emit", type: "emitEvent", inputs: { eventName: inputs.eventName, payload: inputs.payload } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "emit", toPort: "flowIn" },
      { fromNodeId: "emit", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  }),
};

export const BUILTIN_ICON_BLUEPRINT_IDS = Object.freeze(Object.keys(BUILTIN_ICON_BLUEPRINTS));

/** Returns a fresh blueprint (built from the icon's own `inputs`) for a built-in blueprintId, or null if `blueprintId` isn't one of the built-ins. */
export function buildBuiltinIconBlueprint(blueprintId, inputs = {}) {
  const factory = BUILTIN_ICON_BLUEPRINTS[blueprintId];
  return factory ? factory(inputs) : null;
}

export default buildBuiltinIconBlueprint;
