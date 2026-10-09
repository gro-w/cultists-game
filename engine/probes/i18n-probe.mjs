import assert from "node:assert/strict";
import { I18nManager } from "../core/i18n/I18nManager.js";
import { evaluateValueOutput, createActivityRunner } from "../core/ActivityRunner.js";
import { VariableStore } from "../core/VariableStore.js";
import { ActivityQueue } from "../core/ActivityQueue.js";
import { eventBus } from "../core/EventBus.js";

const i18n = new I18nManager({ eventBus, language: "zh-cn" });
assert.equal(i18n.getLanguage(), "zh-cn");
assert.equal(i18n.translate("node.getLanguage"), "获取语言");
i18n.setLanguage("en-us");
assert.equal(i18n.translate("node.getLanguage"), "Get language");
i18n.setSupportedLanguages(["zh-cn", "en-us"]);
assert.equal(i18n.getLanguage(), "en-us");
assert.throws(() => i18n.setLanguage("xx-xx"), /Unsupported language/);
i18n.setLanguage("zh-cn");

const variables = new VariableStore(eventBus);
const valueBlueprint = { nodes: { language: { id: "language", type: "getLanguage", inputs: {}, next: {} } } };
const gateway = { getLanguage: () => i18n.getLanguage(), setLanguage: (language) => i18n.setLanguage(language) };
assert.equal(evaluateValueOutput(valueBlueprint, "language", "value", variables, new Set(), null, null, gateway), "zh-cn");
const queue = new ActivityQueue("probe");
const instance = queue.append({ activityId: "i18n" });
const definition = { id: "i18n", blueprint: {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "set", port: "flowIn" } } },
    set: { id: "set", type: "setLanguage", inputs: { language: "en-us" }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
    end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
  },
} };
createActivityRunner({ definition, instance, variableStore: variables, eventBus, runtimeGateway: gateway }).start();
assert.equal(i18n.getLanguage(), "en-us");
console.log("i18n-probe: ok");
