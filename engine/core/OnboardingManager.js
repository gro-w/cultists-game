import EventStateRegistry from "../core/EventStateRegistry.js";
export class OnboardingManager extends EventStateRegistry {
  constructor({ eventBus } = {}) {
    super({ eventBus, events: { changed: "onboarding:changed", request: "onboarding:hint_requested", close: "onboarding:hint_closed" }, stateKeys: { marked: "milestones", requested: "shownHintIds", dismissed: "dismissedHintIds" } });
  }
  get hints() { return this.definitions; }
  get milestones() { return this.marked; }
  get shownHintIds() { return this.requested; }
  get dismissedHintIds() { return this.dismissed; }
}
export default OnboardingManager;
