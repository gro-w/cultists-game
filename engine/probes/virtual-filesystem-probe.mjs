import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import EventBus from "../core/EventBus.js";
import { VirtualFileSystem } from "../core/VirtualFileSystem.js";
import { AppProgramRegistry } from "../core/AppProgramRegistry.js";
import { DesktopIconManager } from "../core/DesktopIconManager.js";
import { isDevEntry } from "../core/engine-bootstrap.js";

const defaults = JSON.parse(await readFile(new URL("../../data/virtual-filesystem.json", import.meta.url), "utf8"));
const appDefinitions = JSON.parse(await readFile(new URL("../../data/app-definitions.json", import.meta.url), "utf8"));
assert.equal(isDevEntry("?dev"), true);
for (const search of ["", "?dev=1", "?dev&test", "?mode=dev"]) assert.equal(isDevEntry(search), false, `only exact ?dev enables developer mode (${search})`);
assert.equal(appDefinitions.programs.some((program) => program.id === "dev-mode-launcher"), false, "developer program is absent from data definitions");
assert.throws(() => AppProgramRegistry.validateDocument({
  ...appDefinitions,
  programs: [...appDefinitions.programs, { id: "dev-mode-launcher", title: "Dev", icon: "🛠️", kind: "window", target: "dev-mode-launcher" }],
}), "developer program IDs cannot be declared by app data");
assert.throws(() => AppProgramRegistry.validateDocument({
  ...appDefinitions,
  programs: [...appDefinitions.programs, { id: "extra-tool", title: "Dev", icon: "🛠️", kind: "window", target: "dev-window-debugger" }],
}), "developer window targets cannot be declared by app data");
const dataRoot = new URL("../../data/", import.meta.url);
async function listDataFiles(directory = dataRoot) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await listDataFiles(path));
    else if (/\.(?:json|txt|md|csv|ya?ml|xml|html|css|js)$/i.test(entry.name)) files.push(path);
  }
  return files;
}
for (const file of await listDataFiles()) {
  const content = await readFile(file, "utf8");
  assert.doesNotMatch(content, /dev-[A-Za-z0-9_-]+|\/home\/desktop\/开发人员模式\.lnk/i, `developer-only app data must not be declared in ${file.pathname}`);
}
const appRegistry = new AppProgramRegistry(appDefinitions);
for (const program of appDefinitions.programs) {
  const executable = defaults.entries.find((entry) => entry.type === "file" && entry.content === program.id && (entry.path.startsWith("/opt/") || entry.path.startsWith("/usr/bin/")));
  assert.ok(executable, `program ${program.id} has an ID-only executable file`);
  if (!executable.path.startsWith("/usr/bin/")) {
    const shortcuts = defaults.entries.filter((entry) => entry.path.endsWith(".lnk") && entry.content === executable.path);
    assert.ok(shortcuts.length > 0, `program ${program.id} has a desktop/start-menu shortcut`);
    assert.ok(shortcuts.every((entry) => !Object.hasOwn(entry.metadata || {}, "icon")), "icons are app-manager settings, not shortcut data");
  }
  assert.equal(appRegistry.getIcon(program.id), program.icon);
}
assert.deepEqual(
  ["cat", "cp", "ls", "mv", "touch"].map((id) => [id, appRegistry.get(id)?.kind, appRegistry.get(id)?.target]),
  [["cat", "activity", "system:cat"], ["cp", "activity", "system:cp"], ["ls", "activity", "system:ls"], ["mv", "activity", "system:mv"], ["touch", "activity", "system:touch"]],
  "file commands are registered Activity applications",
);
assert.equal(appRegistry.getDefaultProgram().target, "terminal", "unmatched programs use the configured fallback app");
const events = new EventBus();
let changes = 0;
events.on("vfs:changed", () => { changes += 1; });
const fs = new VirtualFileSystem(defaults, events);
assert.throws(() => fs.createFile("/home/desktop/not-core.txt", "x", { metadata: { coreOnly: false } }), "only the core injection API may own the coreOnly metadata key");
assert.throws(() => fs.updateMetadata("/home/desktop/HIS.lnk", { coreOnly: true }));
assert.equal(fs.readFile("/opt/his"), "his", "application executable contains only its program id");
assert.equal(fs.exists("/usr/bin/cd"), false, "shell built-ins are not duplicated as executable files");
assert.equal(fs.exists("/usr/bin/pwd"), false, "shell built-ins are not duplicated as executable files");
assert.equal(fs.readFile("/usr/bin/sh"), "sh", "sh is represented by its executable file");
assert.equal(fs.readFile("/home/desktop/HIS.lnk"), "/opt/his", "desktop shortcut points to the executable");
assert.equal(fs.exists("/OPT/his"), false, "paths are case-sensitive");
assert.deepEqual(fs.list("/home/desktop").filter((entry) => entry.path.endsWith(".lnk")).length, 15);
assert.equal(fs.list("/home/menu").length, 15);
assert.equal(fs.get("/trash").type, "directory");

fs.mkdir("/home/desktop/Notes");
fs.createFile("/home/desktop/Notes/readme.txt", "hello");
assert.equal(fs.readFile("readme.txt", "/home/desktop/Notes"), "hello");
assert.throws(() => fs.get("../../../escape", "/home/desktop"));
assert.throws(() => fs.createFile("/home/desktop/missing/file.txt", "x"));

fs.copy("/home/desktop/Notes/readme.txt", "/home/menu");
assert.equal(fs.readFile("/home/menu/readme.txt"), "hello");
fs.move("/home/menu/readme.txt", "/home/desktop/Notes/renamed.txt");
assert.equal(fs.readFile("/home/desktop/Notes/renamed.txt"), "hello");
assert.equal(fs.exists("/home/menu/readme.txt"), false);

fs.clipboard = { path: "/home/desktop/Notes/renamed.txt", operation: "copy" };
fs.createShortcut("/home/desktop/Notes/renamed.txt", "/home/menu", "Note");
assert.equal(fs.resolveShortcut("/home/menu/Note.lnk").target.content, "hello");
fs.moveToTrash("/home/desktop/Notes");
assert.equal(fs.exists("/home/desktop/Notes"), false);
assert.equal(fs.readFile("/trash/Notes/renamed.txt"), "hello");

const snapshot = fs.snapshot();
const restored = new VirtualFileSystem(defaults);
restored.restore(snapshot);
assert.deepEqual(restored.snapshot(), snapshot, "full filesystem including text and directory structure round-trips");
const before = restored.snapshot();
assert.throws(() => restored.restore({ version: 1, entries: [{ path: "/", type: "directory" }, { path: "/bad/child", type: "file", content: "x" }] }));
assert.deepEqual(restored.snapshot(), before, "an invalid restore must not mutate the live tree");
assert.ok(changes >= 7, "mutations publish filesystem change events");

const developer = new VirtualFileSystem(defaults);
developer.allowCoreOnlyEntries = true;
developer.injectCoreEntries([
  { path: "/home/desktop/开发人员模式", type: "file", content: "dev-mode-launcher", metadata: { coreOnly: true, position: { x: 172, y: 8 } } },
]);
const developerSave = developer.snapshot();
const developerEntry = developerSave.entries.find((entry) => entry.path === "/home/desktop/开发人员模式");
assert.equal(developerEntry.metadata.coreOnly, true);
assert.equal(developerEntry.content, "dev-mode-launcher");
assert.equal(developerSave.entries.some((entry) => entry.path === "/opt/dev-mode-launcher"), false, "developer launcher is not installed under /opt");
const developerAppRegistry = new AppProgramRegistry(appDefinitions);
developerAppRegistry.registerCoreProgram({ id: "dev-mode-launcher", title: "开发人员模式", icon: "🛠️", kind: "window", target: "dev-mode-launcher" });
const developerIcon = new DesktopIconManager([], { virtualFileSystem: developer, appRegistry: developerAppRegistry })
  .list().find((icon) => icon.sourcePath === "/home/desktop/开发人员模式");
assert.equal(developerIcon?.programId, "dev-mode-launcher", "the direct desktop entry resolves as the developer-mode app");
assert.equal(developerIcon?.blueprintId, "desktop.launch-program");
developer.updateMetadata("/home/desktop/开发人员模式", { position: { x: 240, y: 32 } });
const positionedDeveloperSave = developer.snapshot();
developer.createFile("/home/desktop/FakeDev.lnk", "/home/desktop/开发人员模式");
const saveWithUserShortcut = developer.snapshot();
assert.throws(() => developer.writeFile("/home/desktop/开发人员模式", "other-program"));
assert.throws(() => developer.rename("/home/desktop/开发人员模式", "/home/desktop/renamed"));
assert.throws(() => developer.copy("/home/desktop/开发人员模式", "/home/desktop"));
assert.throws(() => developer.moveToTrash("/home/desktop/开发人员模式"));
assert.throws(() => developer.createShortcut("/home/desktop/开发人员模式", "/home/desktop"));
const regular = new VirtualFileSystem(defaults);
assert.throws(() => regular.injectCoreEntries([{ path: "/home/desktop/开发人员模式", type: "file", content: "dev-mode-launcher" }]));
regular.restore(positionedDeveloperSave);
assert.equal(regular.exists("/home/desktop/开发人员模式"), false, "ordinary mode strips the injected core-only developer desktop entry from restored saves");
regular.restore(saveWithUserShortcut);
assert.equal(regular.exists("/home/desktop/FakeDev.lnk"), false, "ordinary restore removes user shortcuts targeting the core-only desktop entry");
const developerReload = new VirtualFileSystem(defaults);
developerReload.allowCoreOnlyEntries = true;
developerReload.injectCoreEntries([
  { path: "/home/desktop/开发人员模式", type: "file", content: "dev-mode-launcher", metadata: { position: { x: 172, y: 8 } } },
]);
developerReload.restore(positionedDeveloperSave);
assert.equal(developerReload.readFile("/home/desktop/开发人员模式"), "dev-mode-launcher", "developer mode retains the injected desktop app in its save");
assert.deepEqual(developerReload.get("/home/desktop/开发人员模式").metadata.position, { x: 240, y: 32 }, "core injection retains user layout metadata on developer restore");
const forgedDeveloperSave = { ...positionedDeveloperSave, entries: [...positionedDeveloperSave.entries, { path: "/home/desktop/forged-dev-tool", type: "file", content: "dev", metadata: { coreOnly: true } }] };
developerReload.restore(forgedDeveloperSave);
assert.equal(developerReload.exists("/home/desktop/forged-dev-tool"), false, "restore only retains core-only entries registered by core");
assert.throws(() => VirtualFileSystem.validateDefaultDocument(positionedDeveloperSave), "the defaults editor rejects core-injected entries");
assert.throws(() => VirtualFileSystem.validateDocument({ version: 1, entries: [...defaults.entries, { path: "/home/desktop/bad-position", type: "file", content: "x", metadata: { position: { x: -1, y: 0 } } }] }));
assert.throws(() => VirtualFileSystem.validateDefaultDocument({ version: 1, entries: [...defaults.entries, { path: "/home/desktop/forged-core-flag", type: "file", content: "x", metadata: { coreOnly: false } }] }));

console.log("virtual-filesystem-probe: defaults, path rules, case sensitivity, file operations, trash, shortcut and save round-trip passed");
