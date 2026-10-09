import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import GameClock from "../core/GameClock.js";
import ActivityQueueRegistry from "../core/ActivityQueueRegistry.js";
import RuntimeCollectionRegistry from "../core/RuntimeCollectionRegistry.js";

const eventBus = new EventBus();
const gameClock = new GameClock(eventBus, { day: 1, minutes: 480 });
const queues = new ActivityQueueRegistry(eventBus);
const dataStore = {
  findRecords(databaseId) {
    if (databaseId === "patients") return [
      { id: "p1", dialogueActivityId: "work01a-patient1-start" },
      { id: "p2", dialogueActivityId: "work02a-patient1-start" },
    ];
    return [];
  },
};
const runtime = new RuntimeCollectionRegistry({ dataStore, eventBus, activityQueueRegistry: queues, gameClock });
runtime.loadDefinitions({
  hisPatients: {
    activityQueueId: "work",
    databaseId: "patients",
    joinField: "dialogueActivityId",
    joinActivitySuffix: "-start",
    unresolvedOnly: true,
  },
  daily: { databaseId: "daily", currentDayField: "day" },
});
dataStore.findRecords = (databaseId) => databaseId === "daily"
  ? [{ id: "d1", day: 1 }, { id: "d2", day: 2 }]
  : databaseId === "patients"
    ? [{ id: "p1", dialogueActivityId: "work01a-patient1-start" }, { id: "p2", dialogueActivityId: "work02-patient1-start" }]
    : [];

queues.append("work", { activityId: "work01a-patient1", payload: {} });
assert.deepEqual(runtime.get("hisPatients").map((record) => record.id), ["p1"]);
assert.deepEqual(runtime.get("daily").map((record) => record.id), ["d1"]);

gameClock.restore({ day: 2, minutes: 480 });
assert.deepEqual(runtime.get("daily").map((record) => record.id), ["d2"]);
queues.completeEntry("work", "work01a-patient1:1");
assert.deepEqual(runtime.get("hisPatients"), []);

console.log("time-driven-collection-probe: ok");
