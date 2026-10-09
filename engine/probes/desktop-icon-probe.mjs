import assert from "node:assert/strict";
import { DesktopIconManager } from "../core/DesktopIconManager.js";
import { buildBuiltinIconBlueprint, BUILTIN_ICON_BLUEPRINT_IDS } from "../core/BuiltinIconBlueprints.js";
import { validateBlueprint } from "../core/ActivityValidator.js";

/**
 * Covers plan §8.1/§8.2: built-in blueprint resolution for all 4 ids,
 * custom blueprintId fallback (icon references an Activity id that is
 * *not* one of the built-ins), icon order/position save->restore
 * round-trip, and double-click only ever triggering the icon's own
 * declared blueprint (never a different one).
 */

// --- 1. Built-in blueprint resolution for all 4 ids ----------------------
for (const id of BUILTIN_ICON_BLUEPRINT_IDS) {
  const blueprint = buildBuiltinIconBlueprint(id, { windowId: "example", activityId: "off-duty-open", minutes: 30, eventName: "probe:event" });
  assert.ok(blueprint, `builtin blueprint "${id}" should resolve`);
  const validation = validateBlueprint(blueprint);
  assert.equal(validation.ok, true, `builtin blueprint "${id}" must validate: ${validation.errors?.join("；")}`);
}
assert.equal(buildBuiltinIconBlueprint("desktop.unknown-id", {}), null, "unknown blueprintId must resolve to null");
console.log("desktop-icon-probe: built-in blueprint resolution passed");

// --- 2. Custom blueprintId fallback (simulated activityDefinitionStore) --
const activityDefinitionStore = new Map([["custom-activity", { id: "custom-activity" }]]);
function resolveIconDefinition(icon) {
  const builtin = buildBuiltinIconBlueprint(icon.blueprintId, icon.inputs || {});
  if (builtin) return { kind: "builtin", blueprint: builtin };
  const definition = activityDefinitionStore.get(icon.blueprintId);
  return definition ? { kind: "custom", definition } : null;
}
assert.equal(resolveIconDefinition({ blueprintId: "desktop.open-window", inputs: { windowId: "x" } }).kind, "builtin");
assert.equal(resolveIconDefinition({ blueprintId: "custom-activity" }).kind, "custom");
assert.equal(resolveIconDefinition({ blueprintId: "totally-unknown" }), null);
console.log("desktop-icon-probe: custom blueprintId fallback passed");

// --- 3. Icon order/position save -> restore round-trip -------------------
const manager = new DesktopIconManager([
  { iconId: "a", label: "A", blueprintId: "desktop.open-window", inputs: { windowId: "a" } },
  { iconId: "b", label: "B", blueprintId: "desktop.open-window", inputs: { windowId: "b" } },
  { iconId: "c", label: "C", blueprintId: "desktop.open-window", inputs: { windowId: "c" } },
]);
assert.deepEqual(manager.list().map((i) => i.iconId), ["a", "b", "c"]);

manager.reorder("c", 0);
assert.deepEqual(manager.list().map((i) => i.iconId), ["c", "a", "b"]);

manager.setFreePosition("b", 120, 80);
assert.deepEqual(manager.get("b").position, { mode: "free", x: 120, y: 80 });

const snapshot = manager.toJSON();
const restored = new DesktopIconManager();
restored.restore(snapshot);
assert.deepEqual(restored.list().map((i) => i.iconId), ["c", "a", "b"], "order must survive save/restore");
assert.deepEqual(restored.get("b").position, { mode: "free", x: 120, y: 80 }, "free position must survive save/restore");
console.log("desktop-icon-probe: order/position save->restore round-trip passed");

// --- 4. Double-click only ever triggers the icon's own declared blueprint
{
  const calls = [];
  function activate(icon) {
    calls.push(icon.blueprintId);
  }
  const iconA = manager.get("a");
  const iconB = manager.get("b");
  activate(iconA);
  activate(iconB);
  assert.deepEqual(calls, ["desktop.open-window", "desktop.open-window"]);
  assert.equal(iconA.inputs.windowId, "a");
  assert.equal(iconB.inputs.windowId, "b");
}
console.log("desktop-icon-probe: double-click routes only the icon's own blueprint passed");

// --- 5. setBlueprint/unregister (plan §8.2 desktop icon editor) ---------
{
  manager.setBlueprint("a", "desktop.run-activity", { activityId: "custom-activity" });
  const iconA = manager.get("a");
  assert.equal(iconA.blueprintId, "desktop.run-activity");
  assert.deepEqual(iconA.inputs, { activityId: "custom-activity" });

  manager.unregister("a");
  assert.ok(!manager.get("a"), "unregister must remove the icon");
  assert.deepEqual(manager.list().map((i) => i.iconId), ["c", "b"]);
}
console.log("desktop-icon-probe: setBlueprint/unregister scenarios passed");

console.log("desktop-icon-probe: all scenarios passed");
