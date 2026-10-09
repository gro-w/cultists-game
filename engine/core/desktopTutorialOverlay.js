import { t } from "./i18n/index.js";
/**
 * TutorialOverlay - the visual half of the onboarding mechanic: a raw DOM
 * overlay (not a window, mounted once directly onto document.body exactly
 * like the legacy `js/desktop/TutorialOverlay.js`) that highlights a
 * CSS-selector `target` and shows a title/text card with "知道了"/"以后不
 * 再提示" buttons. Ported near-verbatim from legacy (same class names, same
 * queueing/positioning/auto-close behavior) so a data-driven hint looks and
 * behaves the same as the old engine's hardcoded ones; only the data
 * source (the data-driven event-state registry, driven by `data/onboarding.json` instead
 * of a hardcoded HINTS constant) is new.
 */
export class TutorialOverlay {
  constructor({ eventBus, onboardingManager, root } = {}) {
    this.eventBus = eventBus;
    this.manager = onboardingManager;
    this.root = root || document.createElement("div");
    if (!root) document.body.appendChild(this.root);
    this.root.className = "tutorial-overlay hidden";
    this.root.innerHTML = `<div class="tutorial-highlight" aria-hidden="true"></div><div class="tutorial-card" role="dialog" aria-live="polite"><strong class="tutorial-title"></strong><p class="tutorial-text"></p><div class="tutorial-actions"><button type="button" class="win95-btn bevel-out tutorial-ok">${t("legacy.cb63c62e50f8")}</button><button type="button" class="win95-btn bevel-out tutorial-dismiss">${t("legacy.446ddd6f97e8")}</button></div></div>`;
    this.highlight = this.root.querySelector(".tutorial-highlight");
    this.card = this.root.querySelector(".tutorial-card");
    this.title = this.root.querySelector(".tutorial-title");
    this.text = this.root.querySelector(".tutorial-text");
    this._hint = null;
    this._pendingHints = [];
    this.root.querySelector(".tutorial-ok").addEventListener("click", () => {
      if (this._hint) this.manager.acknowledgeHint(this._hint.id);
      this.close();
    });
    this.root.querySelector(".tutorial-dismiss").addEventListener("click", () => {
      if (this._hint) this.manager.dismissHint(this._hint.id);
      this.close();
    });
    this._unsubscribers = [
      this.eventBus.on("onboarding:hint_requested", (hint) => this.show(hint)),
      this.eventBus.on("onboarding:hint_closed", ({ id }) => { if (this._hint && this._hint.id === id) this.close(); }),
    ];
    this._onResize = () => this._position();
    window.addEventListener("resize", this._onResize);
  }

  show(hint) {
    if (!this.root.classList.contains("hidden")) {
      if (!this._pendingHints.some((queued) => queued.id === hint.id)) this._pendingHints.push(hint);
      return;
    }
    this._hint = hint;
    this.title.textContent = hint.title || "";
    this.text.textContent = hint.text || "";
    this.root.classList.remove("hidden");
    this._position();
  }

  _position() {
    if (!this._hint || !this._hint.target) return;
    const target = document.querySelector(this._hint.target);
    if (!target || !target.getBoundingClientRect().width) {
      this.highlight.classList.add("hidden");
      this.card.classList.add("tutorial-card-centered");
      return;
    }
    const rect = target.getBoundingClientRect();
    this.highlight.classList.remove("hidden");
    this.card.classList.remove("tutorial-card-centered");
    Object.assign(this.highlight.style, { left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` });
    this.card.style.left = `${Math.min(window.innerWidth - 320, Math.max(12, rect.left))}px`;
    this.card.style.top = `${Math.min(window.innerHeight - 150, rect.bottom + 12)}px`;
  }

  _showNextPending() {
    const next = this._pendingHints.shift();
    if (next) this.show(next);
  }

  close() {
    this.root.classList.add("hidden");
    this._hint = null;
    this._showNextPending();
  }

  destroy() {
    this._unsubscribers.forEach((off) => off());
    window.removeEventListener("resize", this._onResize);
  }
}

export default TutorialOverlay;
