import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { WindowDefinitionStore } from "../core/WindowDefinitionStore.js";
import { VariableStore } from "../core/VariableStore.js";
import { GameClock } from "../core/GameClock.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";

/**
 * Minimal stand-in for engine.js's widget-event wiring (plan §4.2): every
 * widget's `events.onClick`/`onChange`/`onFocus`/`onBlur` inline blueprint
 * runs through the shared ActivityExecutionService - never a second
 * bespoke Runner - on a dedicated non-blocking queue, exactly mirroring
 * the window-lifecycle mechanism but keyed by widgetId as well as
 * windowId so the debugger never confuses the two kinds of events.
 */
function wireWidgetEvents({ windowDefinitionStore, activityQueueRegistry, activityExecutionService, variableStore, gameClock }) {
  const widgetEventsQueue = activityQueueRegistry.register("widget-events", { nonBlocking: true });

  function findWidgetNode(root, widgetId) {
    if (!root) return null;
    if (root.widgetId === widgetId) return root;
    if (root.type !== "container") return null;
    for (const child of root.children || []) {
      const found = findWidgetNode(child, widgetId);
      if (found) return found;
    }
    return null;
  }

  function runWidgetEvent(windowId, widgetId, eventName, value) {
    const definition = windowDefinitionStore.get(windowId);
    const widget = findWidgetNode(definition?.root, widgetId);
    const blueprint = widget?.events?.[eventName];
    if (!blueprint) return null;
    const validation = validateBlueprint(blueprint);
    if (!validation.ok) return null;
    if (value !== undefined) variableStore.set("event:value", value);
    const activityId = `widget:${windowId}:${widgetId}:${eventName}`;
    const instance = widgetEventsQueue.append({ activityId });
    return activityExecutionService.run({
      queue: widgetEventsQueue,
      definition: { id: activityId, blueprint: validation.blueprint },
      instance,
      variableStore,
      timeGateway: (minutes) => gameClock.advance(minutes),
      windowGateway: () => {},
    });
  }

  return { runWidgetEvent, widgetEventsQueue };
}

function buildHarness() {
  const eventBus = new EventBus();
  const windowDefinitionStore = new WindowDefinitionStore();
  const variableStore = new VariableStore(eventBus);
  const gameClock = new GameClock(eventBus);
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);
  const { runWidgetEvent, widgetEventsQueue } = wireWidgetEvents({
    windowDefinitionStore,
    activityQueueRegistry,
    activityExecutionService,
    variableStore,
    gameClock,
  });
  return { windowDefinitionStore, variableStore, runWidgetEvent, widgetEventsQueue };
}

// --- a widget with no `events` at all is a safe no-op ----------------------
{
  const { windowDefinitionStore, runWidgetEvent } = buildHarness();
  windowDefinitionStore.register({
    id: "demo-window",
    title: "Demo",
    root: { type: "container", children: [{ type: "button", widgetId: "btn1", text: "Click" }] },
  });
  const result = runWidgetEvent("demo-window", "btn1", "onClick");
  assert.equal(result, null, "no `events` on a widget must not throw and must return null");
}

// --- an onClick blueprint fires exactly once per click, incrementing a variable ---
{
  const { windowDefinitionStore, variableStore, runWidgetEvent } = buildHarness();
  variableStore.set("clicks", 0);
  windowDefinitionStore.register({
    id: "demo-window",
    title: "Demo",
    root: {
      type: "container",
      children: [
        {
          type: "button",
          widgetId: "btn1",
          text: "Click",
          events: {
            onClick: {
              startNodeId: "start",
              nodes: {
                start: { id: "start", type: "flowStart", inputs: {} },
                inc: { id: "inc", type: "setVariable", inputs: { key: "clicks", delta: 1 } },
                end: { id: "end", type: "activityEnd", inputs: {} },
              },
              connections: [
                { fromNodeId: "start", fromPort: "flowOut", toNodeId: "inc", toPort: "flowIn" },
                { fromNodeId: "inc", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
              ],
            },
          },
        },
      ],
    },
  });

  runWidgetEvent("demo-window", "btn1", "onClick");
  assert.equal(variableStore.get("clicks"), 1, "onClick blueprint must run exactly once");

  runWidgetEvent("demo-window", "btn1", "onClick");
  assert.equal(variableStore.get("clicks"), 2, "a second click must run the blueprint again (not resume-skip it)");
}

// --- an onChange blueprint receives the new value via the `event:value` well-known variable ---
{
  const { windowDefinitionStore, variableStore, runWidgetEvent } = buildHarness();
  windowDefinitionStore.register({
    id: "demo-window",
    title: "Demo",
    root: {
      type: "container",
      children: [
        {
          type: "textInput",
          widgetId: "input1",
          events: {
            onChange: {
              startNodeId: "start",
              nodes: {
                start: { id: "start", type: "flowStart", inputs: {} },
                store: { id: "store", type: "setVariable", inputs: { key: "lastValue", value: { variable: "event:value" } } },
                end: { id: "end", type: "activityEnd", inputs: {} },
              },
              connections: [
                { fromNodeId: "start", fromPort: "flowOut", toNodeId: "store", toPort: "flowIn" },
                { fromNodeId: "store", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
              ],
            },
          },
        },
      ],
    },
  });

  runWidgetEvent("demo-window", "input1", "onChange", "hello");
  assert.equal(variableStore.get("lastValue"), "hello", "onChange blueprint must see the new value via `event:value`");
}

// --- a widget nested inside containers is still found by findWidgetNode ----
{
  const { windowDefinitionStore, variableStore, runWidgetEvent } = buildHarness();
  windowDefinitionStore.register({
    id: "demo-window",
    title: "Demo",
    root: {
      type: "container",
      children: [
        {
          type: "container",
          children: [
            {
              type: "button",
              widgetId: "nested-btn",
              events: {
                onClick: {
                  startNodeId: "start",
                  nodes: {
                    start: { id: "start", type: "flowStart", inputs: {} },
                    mark: { id: "mark", type: "setVariable", inputs: { key: "marked", value: true } },
                    end: { id: "end", type: "activityEnd", inputs: {} },
                  },
                  connections: [
                    { fromNodeId: "start", fromPort: "flowOut", toNodeId: "mark", toPort: "flowIn" },
                    { fromNodeId: "mark", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  });

  runWidgetEvent("demo-window", "nested-btn", "onClick");
  assert.equal(variableStore.get("marked"), true, "a widget nested two levels deep must still be found and its blueprint run");
}

console.log("widget-event-probe: all assertions passed");
