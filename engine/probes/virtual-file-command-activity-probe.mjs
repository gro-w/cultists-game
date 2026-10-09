import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { ActivityQueue } from "../core/ActivityQueue.js";
import { AppProgramRegistry } from "../core/AppProgramRegistry.js";
import { DesktopIconManager } from "../core/DesktopIconManager.js";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { VirtualFileSystem } from "../core/VirtualFileSystem.js";
import { registerVirtualFileSystemCapabilities } from "../core/VirtualFileSystemCapabilities.js";

const eventBus = new EventBus();
const filesystemDefaults = JSON.parse(await readFile(new URL("../../data/virtual-filesystem.json", import.meta.url), "utf8"));
const virtualFileSystem = new VirtualFileSystem(filesystemDefaults, eventBus);
const appDefinitions = JSON.parse(await readFile(new URL("../../data/app-definitions.json", import.meta.url), "utf8"));
const appRegistry = new AppProgramRegistry(appDefinitions);
assert.equal(appRegistry.getDefaultProgram().target, "terminal", "unknown program fallback is configurable");
assert.deepEqual(appRegistry.getWindowParameters("document", ["/home/desktop/notes.txt"]), ["/home/desktop/notes.txt"]);
for (const command of ["cat", "cp", "ls", "mv", "touch"]) {
  assert.equal(appRegistry.get(command)?.target, `system:${command}`, `${command} resolves to its own Activity`);
}

virtualFileSystem.createFile("/home/desktop/command-test.sh", "#!/usr/bin/sh\necho ok");
virtualFileSystem.createFile("/home/desktop/unknown.exec", "unregistered-program");
const iconManager = new DesktopIconManager([], { virtualFileSystem, appRegistry });
const desktopIcons = new Map(iconManager.listDirectory("/home/desktop").map((icon) => [icon.sourcePath, icon]));
assert.equal(desktopIcons.get("/home/desktop/command-test.sh")?.blueprintId, "desktop.open-script");
assert.equal(desktopIcons.get("/home/desktop/unknown.exec")?.glyph, appRegistry.getDefaultProgram().icon, "unknown programs use the fallback app icon");
assert.equal(desktopIcons.get("/home/desktop/文档.lnk")?.targetPath, "/opt/document", "shortcuts resolve to their declared target before open dispatch");

const handlers = new Map();
const apiGateway = {
  register(id, handler) { handlers.set(id, handler); },
  call(id, payload, ...rest) {
    const handler = handlers.get(id);
    if (!handler) throw new Error(`unregistered API: ${id}`);
    return handler(payload, ...rest);
  },
};
registerVirtualFileSystemCapabilities({ apiGateway, eventBus, virtualFileSystem });
const activityDefinitions = new ActivityDefinitionStore();
for (const command of ["cat", "cp", "ls", "mv", "touch"]) {
  const source = await readFile(new URL(`../../data/activities/${command}.CL2.txt`, import.meta.url), "utf8");
  activityDefinitions.registerCl2({ id: `system:${command}`, source, sourcePath: `data/activities/${command}.CL2.txt` });
}
const terminalOutputSource = `
start: flowStart();
write: terminalOutput("terminal-probe", "blueprint output") {
  default end;
};
end: end();
`;
activityDefinitions.registerCl2({ id: "terminal-output-probe", source: terminalOutputSource });
const execution = new ActivityExecutionService(eventBus, { activityDefinitionStore: activityDefinitions });
const variableStore = new VariableStore(eventBus);
const terminalWrites = [];
eventBus.on("terminal:write", (event) => terminalWrites.push(event));
let terminalOutputCount = 0;
function runCommand(command, args, cwd = "/home/desktop") {
  const queue = new ActivityQueue("main");
  const instance = queue.append({
    activityId: `system:${command}`,
    currentNodeId: "start",
    parameters: [{ arguments: args, cwd, terminalInstanceId: "terminal-probe" }],
  });
  execution.run({
    queue,
    definition: activityDefinitions.get(`system:${command}`),
    instance,
    variableStore,
    apiGateway,
  });
  assert.equal(queue.get(instance.instanceId).status, "resolved", `${command} Activity resolves`);
  return instance;
}

virtualFileSystem.createFile("/home/desktop/a.txt", "alpha");
virtualFileSystem.createFile("/home/desktop/b.txt", "beta");
runCommand("cat", ["a.txt", "b.txt"]);
assert.equal(terminalWrites.at(-1)?.text, "alpha\nbeta", "cat outputs all requested files in order");
runCommand("ls", []);
assert.match(terminalWrites.at(-1)?.text || "", /a\.txt/);
runCommand("cp", ["a.txt", "copied.txt"]);
assert.equal(virtualFileSystem.readFile("/home/desktop/copied.txt"), "alpha");
runCommand("mv", ["copied.txt", "moved.txt"]);
assert.equal(virtualFileSystem.exists("/home/desktop/copied.txt"), false);
assert.equal(virtualFileSystem.readFile("/home/desktop/moved.txt"), "alpha");
runCommand("touch", ["new-one", "new-two"]);
assert.equal(virtualFileSystem.get("/home/desktop/new-one")?.type, "file");
assert.equal(virtualFileSystem.get("/home/desktop/new-two")?.type, "file");
runCommand("cp", ["only-one"]);
assert.match(terminalWrites.at(-1)?.text || "", /Usage: cp|用法：cp/);
runCommand("cat", ["missing.txt"]);
assert.match(terminalWrites.at(-1)?.text || "", /找不到路径/);

const outputQueue = new ActivityQueue("main");
const outputInstance = outputQueue.append({ activityId: "terminal-output-probe", currentNodeId: "start" });
execution.run({
  queue: outputQueue,
  definition: activityDefinitions.get("terminal-output-probe"),
  instance: outputInstance,
  variableStore,
  apiGateway,
});
terminalOutputCount += 1;
assert.equal(terminalWrites.at(-1)?.text, "blueprint output", "terminalOutput blueprint node sends its text to the addressed terminal");
assert.equal(terminalWrites.at(-1)?.instanceId, "terminal-probe");
assert.equal(terminalOutputCount, 1);

console.log("virtual-file-command-activity-probe: fallback app, .sh icon, shortcut, window parameters, CL2 file commands and terminal output passed");
