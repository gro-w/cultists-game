import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { VirtualFileSystem } from "../core/VirtualFileSystem.js";
import { DesktopIconManager } from "../core/DesktopIconManager.js";
import { runVirtualTerminalCommand } from "../core/VirtualFileWidgets.js";

const defaults = JSON.parse(await readFile(new URL("../../data/virtual-filesystem.json", import.meta.url), "utf8"));
const virtualFileSystem = new VirtualFileSystem(defaults);
const output = [];
const launched = [];
const state = { cwd: "/home/desktop" };
const run = (command) => runVirtualTerminalCommand(command, {
  virtualFileSystem,
  write: (text) => output.push(String(text)),
  openVirtualPath: (...args) => { launched.push(args); return { opened: true }; },
}, state);

run("pwd");
assert.equal(output.at(-1), "/home/desktop");
run("which cd");
assert.match(output.at(-1), /cd: shell built-in/);
run("which pwd");
assert.match(output.at(-1), /pwd: shell built-in/);
run("which sh");
assert.equal(output.at(-1), "/usr/bin/sh", "sh resolves to its executable in PATH, not a shell built-in");
run("type sh");
assert.equal(output.at(-1), "sh is /usr/bin/sh");
assert.equal(virtualFileSystem.exists("/usr/bin/cd"), false, "cd is not duplicated in /usr/bin");
assert.equal(virtualFileSystem.exists("/usr/bin/pwd"), false, "pwd is not duplicated in /usr/bin");
run("which ls");
assert.equal(output.at(-1), "/usr/bin/ls");
run("export TEST_VALUE=hello");
run("echo $TEST_VALUE");
assert.equal(output.at(-1), "hello");
assert.equal(state.env.PATH, "/usr/bin:/opt");
run("cd /opt");
assert.equal(state.cwd, "/opt");
run("pwd");
assert.equal(output.at(-1), "/opt");
run("ls");
assert.equal(launched.at(-1)[0], "/usr/bin/ls", "ls is dispatched through its registered application");
assert.deepEqual(launched.at(-1)[2], []);
assert.equal(launched.at(-1)[3].cwd, "/opt");
run("ls /home/desktop");
assert.equal(launched.at(-1)[2][0], "/home/desktop");
run("cat his");
assert.equal(launched.at(-1)[0], "/usr/bin/cat");
assert.deepEqual(launched.at(-1)[2], ["his"]);
run("/opt/his");
assert.deepEqual(launched.at(-1), ["/opt/his", undefined, [], { cwd: "/opt" }]);
run("his one two");
assert.deepEqual(launched.at(-1), ["/opt/his", undefined, ["one", "two"], { cwd: "/opt" }]);
run("which his");
assert.equal(output.at(-1), "/opt/his");
run("sh");
assert.equal(state.interactiveShellDepth, 1, "bare sh enters a nested interactive shell");
run("export TEST_VALUE=nested");
run("cd /home");
run("exit");
assert.equal(state.interactiveShellDepth, 0, "exit returns from the nested shell");
assert.equal(state.cwd, "/opt", "nested-shell directory changes do not leak to its parent");
assert.equal(state.env.TEST_VALUE, "hello", "nested-shell environment changes do not leak to its parent");
run("touch /home/desktop/terminal-probe.txt");
assert.equal(launched.at(-1)[0], "/usr/bin/touch");
assert.deepEqual(launched.at(-1)[2], ["/home/desktop/terminal-probe.txt"]);
run("cp his /home/desktop/terminal-copy.txt");
assert.equal(launched.at(-1)[0], "/usr/bin/cp");
assert.deepEqual(launched.at(-1)[2], ["his", "/home/desktop/terminal-copy.txt"]);
run("mv /home/desktop/terminal-copy.txt /home/desktop/terminal-moved.txt");
assert.equal(launched.at(-1)[0], "/usr/bin/mv");
assert.deepEqual(launched.at(-1)[2], ["/home/desktop/terminal-copy.txt", "/home/desktop/terminal-moved.txt"]);
virtualFileSystem.createFile("/home/desktop/terminal-moved.txt", "his");
run("rm /home/desktop/terminal-moved.txt");
assert.equal(virtualFileSystem.exists("/home/desktop/terminal-moved.txt"), false);
assert.equal(virtualFileSystem.readFile("/trash/terminal-moved.txt"), "his");
virtualFileSystem.createFile("/home/desktop/pwd-script.sh", "pwd");
run("sh /home/desktop/pwd-script.sh");
assert.equal(output.at(-1), "/opt", "sh executes command-file contents");
run('sh -c "pwd"');
assert.equal(output.at(-1), "/opt", "sh -c executes one quoted command");
run('command sh -c "pwd"');
assert.equal(output.at(-1), "/opt", "command invokes sh through PATH as an external command");
run('sh -c "cd /home; pwd"');
assert.equal(output.at(-1), "/home");
assert.equal(state.cwd, "/opt", "sh -c runs in an isolated child shell");
virtualFileSystem.createFile("/home/desktop/script.sh", [
  "export SCRIPT_WORD=hello",
  'if [ "$1" = "ok" ]; then',
  '  echo "$SCRIPT_WORD $1"',
  "elif [ -n \"$1\" ]; then",
  '  echo "other $1"',
  "else",
  '  echo "empty"',
  "fi",
  'case "$2" in',
  "  alpha|beta)",
  '    echo "matched $2" ;;',
  "  *) echo unmatched ;;",
  "esac",
  "for item in one two; do",
  '  echo "$item"',
  "done",
  "count=0",
  'while [ "$count" -lt 2 ]; do',
  '  echo "loop $count"',
  "  count=2",
  "done",
  "set -- first second",
  "shift",
  'echo "shift $1"',
  "eval 'echo eval-ok'",
].join("\n"));
run("sh /home/desktop/script.sh ok alpha");
assert.ok(output.includes("hello ok"));
assert.ok(output.includes("matched alpha"));
assert.ok(output.includes("one"));
assert.ok(output.includes("two"));
assert.ok(output.includes("loop 0"));
assert.ok(output.includes("shift second"));
assert.ok(output.includes("eval-ok"));
assert.equal(state.env.SCRIPT_WORD, undefined, "script exports do not leak into the parent shell");
assert.equal(state.env.count, undefined, "script variables do not leak into the parent shell");
virtualFileSystem.createFile("/home/desktop/script-if-else.sh", 'if false; then echo bad; else echo good; fi');
run("sh /home/desktop/script-if-else.sh");
assert.equal(output.at(-1), "good");
run("cp only-one-argument");
assert.deepEqual(launched.at(-1)[2], ["only-one-argument"], "command argument validation belongs to the registered app Activity");
virtualFileSystem.createFile("/home/desktop/shebang.sh", "#!/usr/bin/sh\necho shebang-$1");
run("/home/desktop/shebang.sh works");
assert.equal(output.at(-1), "shebang-works", "absolute /usr/bin/sh shebangs dispatch to the POSIX shell");
virtualFileSystem.createFile("/home/desktop/env-shebang.sh", "#!/usr/bin/env sh\necho env-shebang-$1");
run("/home/desktop/env-shebang.sh works");
assert.equal(output.at(-1), "env-shebang-works", "env sh shebangs resolve the shell interpreter");
virtualFileSystem.createFile("/usr/bin/python", "python");
virtualFileSystem.createFile("/home/desktop/python-script.py", "#!/usr/bin/python -u\nprint('ignored by shell')");
assert.equal(new DesktopIconManager([], { virtualFileSystem }).listDirectory("/home/desktop").find((icon) => icon.sourcePath === "/home/desktop/python-script.py")?.blueprintId, "desktop.open-script", "any shebang file opens through its interpreter, not as a program ID");
run("/home/desktop/python-script.py one two");
assert.deepEqual(launched.at(-1), ["/usr/bin/python", undefined, ["-u", "/home/desktop/python-script.py", "one", "two"], { cwd: "/opt" }], "a non-shell shebang launches its named interpreter application with interpreter and script arguments");
virtualFileSystem.createFile("/home/desktop/env-python-script.py", "#!/usr/bin/env python -u\nprint('ignored by shell')");
run("/home/desktop/env-python-script.py");
assert.deepEqual(launched.at(-1)[2], ["-u", "/home/desktop/env-python-script.py"], "env shebang resolves the named interpreter through PATH");
virtualFileSystem.createFile("/home/desktop/unsupported-shebang.sh", "#!/usr/bin/ruby\necho wrong");
run("/home/desktop/unsupported-shebang.sh");
assert.match(output.at(-1), /找不到解释器/);
virtualFileSystem.createFile("/home/desktop/recursive.sh", "sh /home/desktop/recursive.sh");
assert.throws(() => run("sh /home/desktop/recursive.sh"), /sh: maximum nesting depth exceeded/);
run("not-a-command");
assert.match(output.at(-1), /not-a-command: command not found/);

console.log("virtual-terminal-probe: POSIX paths, shell built-ins, PATH/export/which, app launch, sh -c/scripts, if/case/for/while, file commands and error paths passed");
