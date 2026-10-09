import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import GameClock from "../core/GameClock.js";
import TimeService from "../core/TimeService.js";
import StateBoundaryService from "../core/StateBoundaryService.js";

function make(minutes = 480, state = {}) {
  const bus = new EventBus();
  const clock = new GameClock(bus, { day: 1, minutes });
  const time = new TimeService(clock, bus);
  const boundary = new StateBoundaryService({
    gameClock: clock, timeService: time, eventBus: bus,
    initialState: { phase: "day", duty: "on-duty", location: "work", ...state },
    rules: { workStart: 480, workEnd: 960, wakeTime: 480, workLocation: "work", offDutyLocation: "dorm" },
  });
  return { bus, clock, boundary };
}

// Manifest-equivalent initial state and exact 16:00 boundary.
{
  const { clock, boundary } = make();
  assert.deepEqual(boundary.snapshot(), { day: 1, phase: "day", duty: "on-duty", location: "work", settledDays: [] });
  boundary.toggleDuty();
  assert.deepEqual(clock.snapshot(), { day: 1, minutes: 960 });
  assert.equal(boundary.snapshot().phase, "night");
  assert.equal(boundary.snapshot().duty, "off-duty");
}

// Outside work hours, ending duty does not move time; the next toggle sleeps.
{
  const { clock, boundary } = make(1200);
  boundary.toggleDuty();
  assert.equal(clock.minutes, 1200);
  const result = boundary.toggleDuty();
  assert.deepEqual(result.clock, { day: 2, minutes: 480 });
  assert.equal(boundary.snapshot().duty, "on-duty");
  assert.equal(boundary.snapshot().location, "work");
  assert.deepEqual(boundary.snapshot().settledDays, [1]);
  const settled = [];
  boundary.eventBus.on("stateBoundary:settled", ({ day }) => settled.push(day));
  boundary.sleep();
  assert.deepEqual(settled, [2], "a later sleep settles only the newly completed day");
}

// Same-day restore and cross-midnight settlement remain deterministic.
{
  const { clock, boundary } = make(1380);
  const saved = boundary.snapshot();
  const restoredSession = make(480);
  const restored = restoredSession.boundary;
  restoredSession.clock.restore({ day: saved.day, minutes: 1380 });
  restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
  const settled = [];
  restored.eventBus.on("stateBoundary:settled", ({ day }) => settled.push(day));
  restored.sleep();
  restored.sleep();
  assert.deepEqual(settled, [1, 2], "each completed day settles once");
}

console.log("state-boundary-probe: ok");
