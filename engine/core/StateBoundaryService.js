import { t } from "./i18n/index.js";
/**
 * Generic, data-driven state boundary owner.
 *
 * The core owns the mechanics (clock boundary, orthogonal state fields,
 * idempotent settlement and persistence). A manifest supplies field names,
 * locations and boundary minutes; no game/content meaning is hard-coded here.
 */
export const STATE_BOUNDARY_EVENTS = Object.freeze({
  changed: "stateBoundary:changed",
  phaseChanged: "stateBoundary:phaseChanged",
  settled: "stateBoundary:settled",
});

const MINUTES_PER_DAY = 1440;

export class StateBoundaryService {
  constructor({ gameClock, timeService, eventBus = null, initialState = {}, rules = {} } = {}) {
    if (!gameClock || !timeService) throw new Error(t("error.4bb16e49f05a"));
    this.gameClock = gameClock;
    this.timeService = timeService;
    this.eventBus = eventBus;
    this.rules = {
      workStart: 480,
      workEnd: 960,
      wakeTime: 480,
      workLocation: "work",
      offDutyLocation: "dorm",
      dayPhase: "day",
      nightPhase: "night",
      ...rules,
    };
    const { clockMinutes: _clockMinutes, ...configuredState } = initialState || {};
    this.state = {
      day: 1,
      phase: this.rules.dayPhase,
      duty: "on-duty",
      location: this.rules.workLocation,
      ...configuredState,
    };
    this.settledDays = new Set();
    this._unsubscribe = this.eventBus?.on("gameClock:changed", (clock) => this._sync(clock));
    this._sync(this.gameClock.snapshot(), { emit: false });
  }

  _phase(minutes) {
    return minutes >= this.rules.workStart && minutes < this.rules.workEnd
      ? this.rules.dayPhase : this.rules.nightPhase;
  }

  _sync(clock, { emit = true } = {}) {
    const before = { ...this.state };
    this.state.day = clock.day;
    this.state.phase = this._phase(clock.minutes);
    const phaseChanged = before.phase !== this.state.phase;
    if (emit && (phaseChanged || before.day !== this.state.day)) {
      const payload = { before, current: this.snapshot(), phaseChanged };
      this.eventBus?.emit(STATE_BOUNDARY_EVENTS.changed, payload);
      if (phaseChanged) this.eventBus?.emit(STATE_BOUNDARY_EVENTS.phaseChanged, payload);
    }
    return this.snapshot();
  }

  sync() { return this._sync(this.gameClock.snapshot()); }
  snapshot() { return { ...this.state, settledDays: [...this.settledDays].sort((a, b) => a - b) }; }

  restore(snapshot = {}) {
    if (!snapshot || typeof snapshot !== "object") throw new Error(t("error.6b14856a17f5"));
    const restored = { ...this.state, ...snapshot };
    if (!Number.isInteger(restored.day) || restored.day < 1) throw new Error(t("error.b509e5fd3124"));
    if (![this.rules.dayPhase, this.rules.nightPhase].includes(restored.phase)) throw new Error(t("error.ccaa49de7821"));
    if (typeof restored.duty !== "string" || typeof restored.location !== "string") throw new Error(t("error.2322433db705"));
    this.state = { ...restored };
    delete this.state.settledDays;
    this.settledDays = new Set((snapshot.settledDays || []).filter((day) => Number.isInteger(day) && day >= 1));
    this._sync(this.gameClock.snapshot(), { emit: false });
    this.eventBus?.emit(STATE_BOUNDARY_EVENTS.changed, { restored: true, current: this.snapshot(), phaseChanged: false });
    return this.snapshot();
  }

  _settleDay(day, reason = "sleep") {
    if (this.settledDays.has(day)) return false;
    this.settledDays.add(day);
    this.eventBus?.emit(STATE_BOUNDARY_EVENTS.settled, { day, reason, current: this.snapshot() });
    return true;
  }

  toggleDuty() {
    const before = this.snapshot();
    const { minutes } = this.gameClock.snapshot();
    if (this.state.duty === "on-duty") {
      this.state.duty = "off-duty";
      this.state.location = this.rules.offDutyLocation;
      if (minutes >= this.rules.workStart && minutes < this.rules.workEnd) {
        this.timeService.consume(this.rules.workEnd - minutes, { source: "state-boundary" });
      }
    } else if (minutes >= this.rules.workStart && minutes < this.rules.workEnd) {
      this.state.duty = "on-duty";
      this.state.location = this.rules.workLocation;
    } else {
      return this.sleep();
    }
    this._sync(this.gameClock.snapshot());
    return { before, after: this.snapshot(), phaseChanged: before.phase !== this.state.phase };
  }

  sleep() {
    const before = this.snapshot();
    const start = this.gameClock.snapshot();
    const target = start.minutes < this.rules.wakeTime
      ? this.rules.wakeTime - start.minutes
      : MINUTES_PER_DAY - start.minutes + this.rules.wakeTime;
    this.timeService.consume(target, { source: "state-boundary:sleep" });
    const afterClock = this.gameClock.snapshot();
    for (let day = start.day; day < afterClock.day; day += 1) this._settleDay(day, "sleep");
    this.state.duty = "on-duty";
    this.state.location = this.rules.workLocation;
    this._sync(afterClock);
    return { before, after: this.snapshot(), clock: afterClock, settledDays: [...this.settledDays] };
  }

  requestLocation(location) {
    if (typeof location !== "string" || !location) return { ok: false, reason: "invalid-location" };
    const before = this.snapshot();
    this.state.location = location;
    this.eventBus?.emit(STATE_BOUNDARY_EVENTS.changed, { before, current: this.snapshot(), phaseChanged: false, locationChanged: true });
    return { ok: true, before, after: this.snapshot() };
  }

  destroy() { this._unsubscribe?.(); }
}

export default StateBoundaryService;
