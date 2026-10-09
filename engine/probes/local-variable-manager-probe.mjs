import assert from "node:assert/strict";
import { LocalVariableManager } from "../core/LocalVariableManager.js";
import { createActivityInstance } from "../core/ActivityInstance.js";

const manager = new LocalVariableManager();
manager.loadDefinitions([{ id: "answer", name: "答案", type: "integer", defaultValue: 0 }]);
const first = createActivityInstance({ instanceId: "a:1", activityId: "a", queueId: "q", localVariables: { answer: 1 } });
const second = createActivityInstance({ instanceId: "a:2", activityId: "a", queueId: "q", localVariables: { answer: 2 } });
first.localVariables.answer = 9;
assert.equal(manager.definition("answer").name, "答案");
assert.equal(first.localVariables.answer, 9);
assert.equal(second.localVariables.answer, 2);
assert.deepEqual(manager.toJSON()[0].defaultValue, 0);
console.log("local-variable-manager-probe: ok");
