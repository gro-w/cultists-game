import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { RuntimeCollectionRegistry } from "../core/RuntimeCollectionRegistry.js";
import { EventActivityRouter } from "../core/EventActivityRouter.js";
import GameClock from "../core/GameClock.js";
import TimeService from "../core/TimeService.js";
import StateBoundaryService from "../core/StateBoundaryService.js";

const bus = new EventBus();
const variables = new VariableStore(bus);
const collections = new RuntimeCollectionRegistry({ eventBus: bus });
collections.loadDefinitions({
  achievements: { stateOnly: true },
  achievementStates: { stateOnly: true },
  history: { stateOnly: true },
});
const started = [];
const displayed = [];
const clock = new GameClock(bus);
const time = new TimeService(clock, bus);
const stateBoundary = new StateBoundaryService({
  gameClock: clock,
  timeService: time,
  eventBus: bus,
  initialState: { day: 1, phase: "day", duty: "on-duty", location: "work" },
});
const router = new EventActivityRouter({
  eventBus: bus,
  variableStore: variables,
  runtimeGateway: collections,
  displayRegistry: { dispatch: (target, payload) => displayed.push({ target, payload }) },
  stateBoundary,
  resources: { media: new Map([["cg_test", { id: "cg_test", imageData: "data:image/test" }]]) },
  runActivity: (id, queue) => started.push({ id, queue }),
  routes: [{
    event: "achievement:display",
    activityId: "achievement-handler",
    queueId: "managers",
    actions: [
      { type: "collection.set", collectionId: "achievements", recordId: { path: "achievementId" }, value: { unlocked: true } },
      { type: "collection.append", collectionId: "history", value: { kind: "achievement", id: { path: "achievementId" } } },
      { type: "display.dispatch", target: "ending-screen", displayType: "media", value: { cgId: { path: "achievementId" }, imageData: { resource: "media", id: "cg_test", field: "imageData" } } },
    ],
  }, {
    event: "game:study",
    actions: [{ type: "collection.incrementField", collectionId: "achievementStates", recordId: "study_king", field: "progress", value: 1, unlockAt: 3, unlockValue: { unlocked: true, statusMark: "✅" } }],
  }, {
    event: "favorability:changed",
    condition: { path: "delta", op: "gt", value: 0 },
    actions: [{ type: "collection.incrementField", collectionId: "achievementStates", recordId: "fav_cumulative_up", field: "progress", value: { path: "delta" } }],
  }, {
    event: "favorability:changed",
    condition: { path: "delta", op: "lt", value: 0 },
    actions: [{ type: "collection.incrementField", collectionId: "achievementStates", recordId: "fav_cumulative_down", field: "progress", value: { path: "delta" }, absolute: true }],
  }, {
    event: "game:skill_check",
    condition: { path: "outcome", in: ["success", "criticalSuccess"] },
    actions: [{ type: "collection.incrementField", collectionId: "achievementStates", recordId: "skillcheck_cumulative_success", field: "progress", value: 1 }],
  }, {
    event: "favorability:changed",
    condition: { value: { gte: 100 } },
    actions: [{ type: "collection.set", collectionId: "achievementStates", recordId: "fav_maxed", value: { unlocked: true } }],
  }, {
    event: "favorability:changed",
    condition: { allAbove: 75 },
    actions: [{ type: "collection.set", collectionId: "achievementStates", recordId: "fav_three_high", value: { unlocked: true } }],
  }, {
    event: "favorability:changed",
    condition: { allHadPositive: true },
    actions: [{ type: "collection.set", collectionId: "achievementStates", recordId: "fav_all_positive", value: { unlocked: true } }],
  }, {
    event: "game:sanity_changed",
    condition: { delta: { lte: -10 } },
    actions: [{ type: "collection.set", collectionId: "achievementStates", recordId: "san_fast_drop", value: { unlocked: true } }],
  }, {
    event: "daynight:changed",
    condition: { day: { gte: 5 }, sanity: { gte: 80 } },
    actions: [{ type: "collection.set", collectionId: "achievementStates", recordId: "san_steady", value: { unlocked: true } }],
  }, {
    event: "location:requested",
    actions: [{ type: "stateBoundary.requestLocation", value: { path: "locationId" } }],
  }],
}).start();

bus.emit("achievement:display", { achievementId: "exam_pass" });
assert.deepEqual(collections.get("achievements"), [{ id: "exam_pass", unlocked: true }]);
assert.deepEqual(collections.get("history"), [{ id: "exam_pass", kind: "achievement" }]);
assert.deepEqual(variables.get("event:payload"), { achievementId: "exam_pass" });
bus.emit("game:study", {});
assert.deepEqual(collections.get("achievementStates"), [{ id: "study_king", progress: 1 }]);
bus.emit("game:study", {});
bus.emit("game:study", {});
assert.deepEqual(collections.get("achievementStates"), [{ id: "study_king", progress: 3, unlocked: true, statusMark: "✅" }]);
bus.emit("favorability:changed", { delta: 4 });
bus.emit("favorability:changed", { delta: -3 });
bus.emit("game:skill_check", { outcome: "success" });
bus.emit("favorability:changed", { value: 100 });
bus.emit("favorability:changed", { allAbove: 80 });
bus.emit("favorability:changed", { allHadPositive: true });
bus.emit("game:sanity_changed", { delta: -12 });
bus.emit("daynight:changed", { day: 5, sanity: 80 });
assert.deepEqual(collections.get("achievementStates"), [
  { id: "study_king", progress: 3, unlocked: true, statusMark: "✅" },
  { id: "fav_cumulative_up", progress: 4 },
  { id: "fav_cumulative_down", progress: 3 },
  { id: "skillcheck_cumulative_success", progress: 1 },
  { id: "fav_maxed", unlocked: true },
  { id: "fav_three_high", unlocked: true },
  { id: "fav_all_positive", unlocked: true },
  { id: "san_fast_drop", unlocked: true },
  { id: "san_steady", unlocked: true },
]);
assert.deepEqual(started, [{ id: "achievement-handler", queue: "managers" }]);
assert.deepEqual(displayed, [{ target: "ending-screen", payload: { cgId: "exam_pass", imageData: "data:image/test", type: "media" } }]);
bus.emit("location:requested", { locationId: "seaside" });
assert.equal(stateBoundary.snapshot().location, "seaside");

const snapshot = collections.snapshot();
collections.restore({});
assert.deepEqual(collections.get("achievements"), []);
collections.restore(snapshot);
assert.deepEqual(collections.get("achievements"), [{ id: "exam_pass", unlocked: true }]);
router.stop();
console.log("event-activity-router-probe: ok");
