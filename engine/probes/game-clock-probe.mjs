import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { GameClock, GAME_CLOCK_EVENTS } from "../core/GameClock.js";

// --- Scenario 1: default state is Day 1, 00:00, and stays put with no advance() calls ---
{
  const eventBus = new EventBus();
  const clock = new GameClock(eventBus);
  assert.deepEqual(clock.snapshot(), { day: 1, minutes: 0 });
  assert.equal(clock.formatClock(), "Day 1 00:00");

  let changeCount = 0;
  eventBus.on(GAME_CLOCK_EVENTS.changed, () => changeCount += 1);

  // Nothing here calls advance(); the clock must not drift on its own
  // (plan §4.1 "不使用系统时间控制游戏逻辑" - no timers, no Date reads).
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(clock.snapshot(), { day: 1, minutes: 0 }, "clock must never advance on its own");
  assert.equal(changeCount, 0, "no changed event without an explicit advance()");
}

// --- Scenario 2: advance() moves the clock forward and rolls over into new days ---
{
  const eventBus = new EventBus();
  const clock = new GameClock(eventBus);
  let lastPayload = null;
  eventBus.on(GAME_CLOCK_EVENTS.changed, (payload) => { lastPayload = payload; });

  clock.advance(90);
  assert.deepEqual(clock.snapshot(), { day: 1, minutes: 90 });
  assert.deepEqual(lastPayload, { day: 1, minutes: 90 });
  assert.equal(clock.formatClock(), "Day 1 01:30");

  clock.advance(1440); // exactly one full day
  assert.deepEqual(clock.snapshot(), { day: 2, minutes: 90 });

  clock.advance(1440 * 2 + 10); // multi-day rollover in one call
  assert.deepEqual(clock.snapshot(), { day: 4, minutes: 100 });

  // Negative/garbage input must be a no-op, not corrupt the clock.
  const before = clock.snapshot();
  clock.advance(-30);
  clock.advance(NaN);
  assert.deepEqual(clock.snapshot(), before);
}

// --- Scenario 3: restore() sets an arbitrary day/minutes (e.g. from a save) and normalizes bad input ---
{
  const eventBus = new EventBus();
  const clock = new GameClock(eventBus);
  clock.restore({ day: 5, minutes: 723 });
  assert.deepEqual(clock.snapshot(), { day: 5, minutes: 723 });

  clock.restore({ day: 0, minutes: -10 });
  assert.equal(clock.day >= 1, true, "day must never restore below 1");
  assert.ok(clock.minutes >= 0 && clock.minutes < 1440, "minutes must normalize into [0,1440)");
}

console.log("game-clock-probe: all scenarios passed");
