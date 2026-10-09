import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { GameClock } from "../core/GameClock.js";
import { RuntimeRefResolver } from "../core/RuntimeRefResolver.js";
import { PublicVariableManager } from "../core/PublicVariableManager.js";

const eventBus = new EventBus();
const clock = new GameClock(eventBus, { day: 1, minutes: 480 });
const manager = new PublicVariableManager(new RuntimeRefResolver(), eventBus);
manager.loadDefinitions([{ id: 1000, name: "gameTimeMinutes", type: "integer", defaultValue: 0, syncSource: "gameClock.totalMinutes" }]);
manager.registerSyncSource("gameClock.totalMinutes", () => (clock.day - 1) * 1440 + clock.minutes);
manager.syncFromSources();
assert.equal(manager.get(1000), 480);
clock.advance(20);
manager.syncFromSources();
assert.equal(manager.get(1000), 500);
console.log("game-clock-public-variable-probe: ok");
