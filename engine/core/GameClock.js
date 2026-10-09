/**
 * GameClock - generic in-game day/minutes clock (plan §4.1 "时钟显示（显示
 * 引擎/游戏状态，不使用系统时间控制游戏逻辑）"). Starts at Day 1, 00:00 and
 * only ever advances when explicitly told to via `advance()`; it is never
 * driven by `Date`, `setInterval`, or any other real-world clock. Deliberately
 * domain-agnostic: no phase/duty/work-window concept lives here, since those
 * are content-specific and excluded from the generic engine (plan §1.3 "在
 * 通用引擎内写死...专用领域逻辑").
 */

export const GAME_CLOCK_EVENTS = Object.freeze({ changed: "gameClock:changed", dayChanged: "gameClock:dayChanged" });

const MINUTES_PER_DAY = 1440;

export class GameClock {
  constructor(eventBus, initial = {}) {
    this.eventBus = eventBus;
    this.day = Math.max(1, Math.floor(Number(initial.day) || 1));
    this.minutes = ((Math.floor(Number(initial.minutes) || 0) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }

  /** Advance the clock by `minutesToAdd` in-game minutes (rolling over into new days); negative/NaN input is a no-op. */
  advance(minutesToAdd) {
    const delta = Math.max(0, Math.floor(Number(minutesToAdd) || 0));
    if (!delta) return this.snapshot();
    const previousDay = this.day;
    let total = this.minutes + delta;
    while (total >= MINUTES_PER_DAY) {
      total -= MINUTES_PER_DAY;
      this.day += 1;
    }
    this.minutes = total;
    this.eventBus?.emit(GAME_CLOCK_EVENTS.changed, this.snapshot());
    if (this.day !== previousDay) this.eventBus?.emit(GAME_CLOCK_EVENTS.dayChanged, this.snapshot());
    return this.snapshot();
  }

  snapshot() {
    return { day: this.day, minutes: this.minutes };
  }

  restore({ day, minutes } = {}) {
    const previousDay = this.day;
    this.day = Math.max(1, Math.floor(Number(day) || 1));
    this.minutes = ((Math.floor(Number(minutes) || 0) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    this.eventBus?.emit(GAME_CLOCK_EVENTS.changed, this.snapshot());
    if (this.day !== previousDay) this.eventBus?.emit(GAME_CLOCK_EVENTS.dayChanged, this.snapshot());
  }

  /** "Day N HH:MM" presentation text for the taskbar clock; never reflects the system clock. */
  formatClock() {
    const hh = String(Math.floor(this.minutes / 60)).padStart(2, "0");
    const mm = String(this.minutes % 60).padStart(2, "0");
    return `Day ${this.day} ${hh}:${mm}`;
  }
}

export default GameClock;
