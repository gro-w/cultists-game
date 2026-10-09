import assert from "node:assert/strict";
import { BgmManager } from "../framework/BgmManager.js";
import { getActivityNodeDefinition } from "../core/ActivityNodeRegistry.js";

const listeners = new Map();
const eventBus = { on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); } };
const variables = new Map([["gameState:sanity", 40]]);
const manager = new BgmManager({
  eventBus,
  variableStore: { get: (key) => variables.get(key), set: (key, value) => variables.set(key, value) },
  stateBoundary: { snapshot: () => ({ day: 1, phase: "day" }) },
  baseUrl: "http://localhost/",
});
manager.tracks = new Map([
  ["high", { id: "high", src: "audio/high.ogg" }],
  ["low", { id: "low", src: "audio/low.ogg" }],
]);
manager.defaultRules = [
  { id: "high-rule", sanMin: 50, bgmId: "high", priority: 1 },
  { id: "low-rule", sanMax: 50, bgmId: "low", priority: 1 },
];
assert.equal(manager.resolve(), "low");
variables.set("gameState:sanity", 80);
assert.equal(manager.resolve(), "high");
manager.applyLayer("play", "low");
assert.equal(manager.resolve(), "low");
manager.applyLayer("restore");
assert.equal(manager.resolve(), "high");
assert.equal(getActivityNodeDefinition("playBgm").valueInputs[0].name, "bgmId");
assert.equal(getActivityNodeDefinition("stopBgm").flowOutputs[0].name, "flowOut");
assert.equal(getActivityNodeDefinition("setBgmVolume").valueInputs[0].type, "number");
console.log("bgm manager and core node probe passed");
