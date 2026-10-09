import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { GameClock } from "../core/GameClock.js";
import { TimeService, TIME_EVENTS } from "../core/TimeService.js";

const eventBus = new EventBus();
const clock = new GameClock(eventBus);
const time = new TimeService(clock, eventBus);
const consumed = [];
eventBus.on(TIME_EVENTS.consumed, (event) => consumed.push(event));

assert.deepEqual(time.snapshot(), { day: 1, minutes: 0 });
const result = time.consume(20, { source: "probe" });
assert.deepEqual(result.before, { day: 1, minutes: 0 });
assert.deepEqual(result.after, { day: 1, minutes: 20 });
assert.equal(consumed.length, 1);
assert.equal(consumed[0].metadata.source, "probe");
assert.throws(() => time.consume(1.5), /non-negative integer/);
assert.throws(() => time.consume(-20), /non-negative integer/);

time.consume(1420);
assert.deepEqual(time.snapshot(), { day: 2, minutes: 0 });
time.restore({ day: 3, minutes: 480 });
assert.deepEqual(time.snapshot(), { day: 3, minutes: 480 });
console.log("time-service probe: ok");
