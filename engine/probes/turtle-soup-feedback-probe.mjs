import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data/game-manifest.json"), "utf8"));
const success = JSON.parse(fs.readFileSync(path.join(root, "data/activities/event__binbin_turtle_success.json"), "utf8"));
const routes = new Map(manifest.eventRoutes.map((route) => [route.event, route.actions]));

const question = routes.get("turtleSoup:question");
assert.ok(question, "question route is registered");
assert.deepEqual(
  question.slice(0, 2),
  [
    { type: "variable.set", key: "turtleSoup:message", value: { path: "answer" } },
    { type: "variable.set", key: "turtleSoup:progress", value: { path: "questionId" } },
  ],
  "question route exposes answer and question id to the window",
);
assert.ok(question.some((action) => action.type === "collection.set" && action.collectionId === "turtleSoupState"), "question route persists state");
assert.ok(question.some((action) => action.type === "collection.append" && action.collectionId === "eventHistory"), "question route records history");

const failed = routes.get("turtleSoup:guess-fail");
assert.ok(failed, "guess failure route is registered");
assert.deepEqual(
  failed.slice(0, 2),
  [
    { type: "variable.set", key: "turtleSoup:message", value: "彬彬摇了摇头：还差一点。" },
    { type: "variable.set", key: "turtleSoup:progress", value: "猜谜失败：可以继续提问。" },
  ],
  "guess failure route exposes a deterministic message",
);

const nodes = success.blueprint.nodes;
const connections = success.blueprint.connections;
assert.equal(nodes.status.inputs.key, "turtleSoup:message", "success writes the message variable");
assert.equal(nodes.progress.inputs.key, "turtleSoup:progress", "success writes the progress variable");
assert.equal(nodes.reward.inputs.id, 42, "success keeps Binbin affinity variable id");
assert.equal(nodes.reward.inputs.delta, 15, "success keeps the +15 reward");
assert.ok(connections.some((edge) => edge.fromNodeId === "status" && edge.toNodeId === "progress"), "success status precedes progress");
assert.ok(connections.some((edge) => edge.fromNodeId === "progress" && edge.toNodeId === "text"), "success feedback precedes story text");

console.log("turtle-soup-feedback-probe: ok");
