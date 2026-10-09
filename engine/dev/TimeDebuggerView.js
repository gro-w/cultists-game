// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
/**
 * Live game-clock debugger. This is a development-only view: it changes the
 * generic GameClock through its public restore/advance API and never writes
 * canonical game data or save payloads directly.
 */
export class TimeDebuggerView {
  constructor({ gameClock, forceEndWork = null } = {}) {
    this.gameClock = gameClock;
    this.forceEndWork = forceEndWork;
    this.el = document.createElement("div");
    this.el.className = "ng-dev-time-debugger";
    this.el.innerHTML = `
      <div class="ng-dev-debugger-row">
        <strong>${t("legacy.6a7cfee34c75")}</strong>
        <output data-role="current"></output>
      </div>
      <label class="ng-dev-debugger-row">${t("legacy.f02ba3a54679")}
        <input data-role="day" type="number" min="1" step="1" value="1">
      </label>
      <label class="ng-dev-debugger-row">${t("legacy.89b4aa6364ce")}
        <input data-role="time" type="time" value="08:00" step="60">
      </label>
      <div class="ng-dev-debugger-actions">
        <button type="button" data-action="set">${t("legacy.e6403871dc21")}</button>
        <button type="button" data-action="advance20">${t("legacy.1d171c7b3ca1")}20 ${t("legacy.28bf227b9bf7")}</button>
        <button type="button" data-action="advance60">${t("legacy.1d171c7b3ca1")}60 ${t("legacy.28bf227b9bf7")}</button>
        <button type="button" data-action="forceEndWork">${t("legacy.f5392cbb745f")}</button>
      </div>
      <p data-role="status" class="ng-dev-debugger-status"></p>
    `;
    this.currentEl = this.el.querySelector('[data-role="current"]');
    this.dayEl = this.el.querySelector('[data-role="day"]');
    this.timeEl = this.el.querySelector('[data-role="time"]');
    this.statusEl = this.el.querySelector('[data-role="status"]');
    this.el.querySelector('[data-action="set"]').addEventListener("click", () => this.setTime());
    this.el.querySelector('[data-action="advance20"]').addEventListener("click", () => this.advance(20));
    this.el.querySelector('[data-action="advance60"]').addEventListener("click", () => this.advance(60));
    this.el.querySelector('[data-action="forceEndWork"]').addEventListener("click", () => this.forceEndWork?.());
    this.render();
  }

  render() {
    const snapshot = this.gameClock?.snapshot?.() || { day: 1, minutes: 0 };
    const hours = Math.floor(snapshot.minutes / 60);
    const minutes = snapshot.minutes % 60;
    this.currentEl.textContent = `Day ${snapshot.day} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    this.dayEl.value = String(snapshot.day);
    this.timeEl.value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  setTime() {
    const day = Math.max(1, Math.floor(Number(this.dayEl.value) || 1));
    const [hours, minutes] = String(this.timeEl.value || "00:00").split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      this.statusEl.textContent = t("legacy.a8325cf6860b");
      return;
    }
    this.gameClock?.restore({ day, minutes: hours * 60 + minutes });
    this.statusEl.textContent = t("legacy.1c87b82d97b1");
    this.render();
  }

  advance(minutes) {
    this.gameClock?.advance(minutes);
    this.statusEl.textContent = `${t("legacy.111daa12b8b4")}${minutes} ${t("legacy.28bf227b9bf7")}`;
    this.render();
  }
}
// DEV-TOOLS:END
