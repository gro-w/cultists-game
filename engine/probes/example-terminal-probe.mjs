import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { ActivityQueue } from "../core/ActivityQueue.js";
import { AppProgramRegistry } from "../core/AppProgramRegistry.js";
import EventBus from "../core/EventBus.js";
import { VirtualFileSystem } from "../core/VirtualFileSystem.js";
import { registerVirtualFileSystemCapabilities } from "../core/VirtualFileSystemCapabilities.js";
import { VariableStore } from "../core/VariableStore.js";
import { runVirtualTerminalCommand } from "../core/VirtualFileWidgets.js";

const root = new URL("../example.data/", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const [filesystemData, appData, activityManifest, activityList, dataFiles] = await Promise.all([
  readJson("virtual-filesystem.json"),
  readJson("app-definitions.json"),
  readJson("activity-manifest.json"),
  readJson("activity-lists/default.json"),
  readJson("data-files.json"),
]);
const filesystem = new VirtualFileSystem(filesystemData);
const registry = new AppProgramRegistry(appData);
const activityDefinitions = new ActivityDefinitionStore();
for (const command of ["cp", "mv"]) {
  const source = await readFile(new URL(`activities/system-${command}.CL2.txt`, root), "utf8");
  activityDefinitions.registerCl2({ id: `system:${command}`, source, sourcePath: `activities/system-${command}.CL2.txt` });
}
const eventBus = new EventBus();
const handlers = new Map();
const apiGateway = {
  register(id, handler) { handlers.set(id, handler); },
  call(id, payload, ...rest) {
    const handler = handlers.get(id);
    if (!handler) throw new Error(`unregistered API: ${id}`);
    return handler(payload, ...rest);
  },
};
registerVirtualFileSystemCapabilities({ apiGateway, eventBus, virtualFileSystem: filesystem });
const execution = new ActivityExecutionService(eventBus, { activityDefinitionStore: activityDefinitions });
const variableStore = new VariableStore(eventBus);

for (const command of ["cp", "mv", "rm"]) {
  assert.ok(filesystem.exists(`/usr/bin/${command}`), `${command} must be executable through PATH in the example VFS`);
}
for (const command of ["cp", "mv"]) {
  assert.equal(registry.get(command)?.target, `system:${command}`, `${command} must launch its command Activity`);
  assert.ok(activityManifest.activityIds.some((entry) => entry.id === `system:${command}`));
  assert.ok(activityList.activityIds.includes(`system:${command}`));
  assert.ok(dataFiles.files.includes(`activities/system-${command}.CL2.txt`));
  const source = await readFile(new URL(`activities/system-${command}.CL2.txt`, root), "utf8");
  assert.match(source, new RegExp(`virtualFileSystem\\(\\"${command}\\"`));
}

const launched = [];
const state = { cwd: "/home/desktop" };
const run = (command) => runVirtualTerminalCommand(command, {
  virtualFileSystem: filesystem,
  write() {},
  openVirtualPath: (...args) => { launched.push(args); return { opened: true }; },
}, state);
const runLaunchedActivity = (command) => {
  const [path, terminalInstanceId, args, options] = launched.at(-1);
  assert.equal(path, `/usr/bin/${command}`);
  const activityId = registry.get(command).target;
  const queue = new ActivityQueue("main");
  const instance = queue.append({
    activityId,
    currentNodeId: "start",
    parameters: [{ arguments: args, cwd: options.cwd, terminalInstanceId }],
  });
  execution.run({
    queue,
    definition: activityDefinitions.get(activityId),
    instance,
    variableStore,
    apiGateway,
  });
  assert.equal(queue.get(instance.instanceId).status, "resolved", `${command} command Activity resolves`);
};
run("cp 演示文档.txt copy.txt");
assert.equal(launched.at(-1)[0], "/usr/bin/cp");
assert.deepEqual(launched.at(-1)[2], ["演示文档.txt", "copy.txt"]);
assert.equal(launched.at(-1)[3].cwd, "/home/desktop");
runLaunchedActivity("cp");
assert.equal(filesystem.readFile("/home/desktop/copy.txt"), filesystem.readFile("/home/desktop/演示文档.txt"));
run("mv copy.txt moved.txt");
assert.equal(launched.at(-1)[0], "/usr/bin/mv");
assert.deepEqual(launched.at(-1)[2], ["copy.txt", "moved.txt"]);
runLaunchedActivity("mv");
assert.equal(filesystem.exists("/home/desktop/copy.txt"), false);
assert.equal(filesystem.readFile("/home/desktop/moved.txt"), filesystem.readFile("/home/desktop/演示文档.txt"));

filesystem.createFile("/home/desktop/remove-me.txt", "trash me");
run("rm remove-me.txt");
assert.equal(filesystem.exists("/home/desktop/remove-me.txt"), false);
assert.equal(filesystem.readFile("/trash/remove-me.txt"), "trash me");

console.log("example-terminal-probe: terminal commands dispatch through the package Activities and shared VFS; rm trash behavior passed");
