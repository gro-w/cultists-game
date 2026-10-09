import { t as translate } from "./i18n/index.js";

function t(key, values = {}) {
  const text = String(translate(key, key));
  return Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), text);
}

const DEFAULT_ENV = Object.freeze({ PATH: "/usr/bin:/opt", HOME: "/home/desktop", PWD: "/home/desktop", OLDPWD: "/home/desktop" });
const BUILTINS = new Set([":", "[", "break", "case", "cd", "command", "continue", "do", "done", "echo", "elif", "else", "esac", "eval", "exit", "export", "false", "fi", "for", "if", "in", "printf", "pwd", "return", "set", "shift", "test", "then", "true", "type", "until", "unset", "while", "which"]);
const MAX_LOOP_ITERATIONS = 256;
const VFS_COMMANDS = new Set(["rm"]);

function ensureState(state = {}) {
  state.cwd ||= "/home/desktop";
  state.env ||= { ...DEFAULT_ENV };
  for (const [key, value] of Object.entries(DEFAULT_ENV)) if (state.env[key] === undefined) state.env[key] = value;
  state.positionals ||= [];
  state.scriptName ||= "sh";
  state.lastStatus = Number.isInteger(state.lastStatus) ? state.lastStatus : 0;
  state.env.PWD = state.cwd;
  return state;
}

function tokenize(source) {
  const tokens = [];
  const input = String(source ?? "");
  let index = 0, parts = [], text = "", quote = null, hadQuote = false;
  const pushText = (expand) => {
    if (!text) return;
    const last = parts.at(-1);
    if (last?.expand === expand) last.text += text;
    else parts.push({ text, expand });
    text = "";
  };
  const pushWord = () => {
    pushText(quote !== "'");
    if (parts.length) tokens.push({ type: "word", parts, raw: parts.map((part) => part.text).join(""), quoted: hadQuote });
    parts = []; hadQuote = false;
  };
  const pushOp = (value) => { pushWord(); tokens.push({ type: "op", value }); };
  while (index < input.length) {
    const char = input[index];
    if (quote === "'") {
      if (char === "'") { pushText(false); quote = null; } else text += char;
      index += 1; continue;
    }
    if (quote === '"') {
      if (char === '"') { pushText(true); quote = null; index += 1; continue; }
      if (char === "\\" && index + 1 < input.length && ['"', "\\", "$", "`", "\n"].includes(input[index + 1])) {
        if (input[index + 1] !== "\n") text += input[index + 1]; index += 2; continue;
      }
      text += char; index += 1; continue;
    }
    if (char === "'" || char === '"') { pushText(true); quote = char; hadQuote = true; index += 1; continue; }
    if (char === "\\" && index + 1 < input.length) { if (input[index + 1] !== "\n") text += input[index + 1]; index += 2; continue; }
    if (char === "#" && !parts.length && !text) { while (index < input.length && input[index] !== "\n") index += 1; continue; }
    if (/\s/.test(char)) { pushWord(); if (char === "\n") pushOp(";"); index += 1; continue; }
    const pair = input.slice(index, index + 2);
    if ([";;", "&&", "||"].includes(pair)) { pushOp(pair); index += 2; continue; }
    if ([";", "|", "(", ")"].includes(char)) { pushOp(char); index += 1; continue; }
    text += char; index += 1;
  }
  if (quote) throw new SyntaxError("sh: unterminated quoted string");
  pushWord();
  return tokens;
}

function expandText(text, state) {
  return String(text).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+|#|\?|@|\*)\}|\$([A-Za-z_][A-Za-z0-9_]*|[0-9]+|#|\?|@|\*)/g, (_m, a, b) => {
    const name = a || b;
    if (name === "#") return String(state.positionals.length);
    if (name === "?") return String(state.lastStatus);
    if (name === "0") return String(state.scriptName || "sh");
    if (name === "@" || name === "*") return state.positionals.join(" ");
    if (/^[1-9]\d*$/.test(name)) return String(state.positionals[Number(name) - 1] ?? "");
    return String(state.env[name] ?? "");
  });
}
function wordValue(word, state) { return word.parts.map(({ text, expand }) => expand ? expandText(text, state) : text).join(""); }
function isWord(token, value) { return token?.type === "word" && !token.quoted && token.raw === value; }

class Parser {
  constructor(tokens) { this.tokens = tokens; this.index = 0; }
  peek() { return this.tokens[this.index] || null; }
  take() { return this.tokens[this.index++] || null; }
  expectWord(value) { if (!isWord(this.peek(), value)) throw new SyntaxError(`sh: expected '${value}'`); return this.take(); }
  expectOp(value) { if (this.peek()?.type !== "op" || this.peek().value !== value) throw new SyntaxError(`sh: expected '${value}'`); return this.take(); }
  skipSeparators() { while (this.peek()?.type === "op" && this.peek().value === ";") this.take(); }
  atStop(words, ops) { const token = this.peek(); return !token || words.some((word) => isWord(token, word)) || (token.type === "op" && ops.includes(token.value)); }
  parseList(stopWords = [], stopOps = []) {
    const nodes = []; this.skipSeparators();
    while (!this.atStop(stopWords, stopOps)) {
      nodes.push(this.parseAndOr());
      if (this.peek()?.type === "op" && [";", ";;"].includes(this.peek().value)) {
        if (stopOps.includes(this.peek().value)) break;
        this.take();
      }
      else if (!this.atStop(stopWords, stopOps)) throw new SyntaxError(`sh: unexpected token '${this.peek()?.raw || this.peek()?.value}'`);
      this.skipSeparators();
    }
    return nodes;
  }
  parseAndOr() {
    const terms = [{ operator: null, command: this.parseCommand() }];
    while (this.peek()?.type === "op" && ["&&", "||"].includes(this.peek().value)) {
      const operator = this.take().value; terms.push({ operator, command: this.parseCommand() });
    }
    return { type: "andOr", terms };
  }
  parseCommand() {
    if (isWord(this.peek(), "if")) return this.parseIf();
    if (isWord(this.peek(), "case")) return this.parseCase();
    if (isWord(this.peek(), "for")) return this.parseFor();
    if (isWord(this.peek(), "while") || isWord(this.peek(), "until")) return this.parseWhile();
    return this.parseSimple();
  }
  parseIf() {
    this.take(); const branches = [];
    let condition = this.parseList(["then"]); this.expectWord("then");
    branches.push({ condition, body: this.parseList(["elif", "else", "fi"]) });
    while (isWord(this.peek(), "elif")) { this.take(); condition = this.parseList(["then"]); this.expectWord("then"); branches.push({ condition, body: this.parseList(["elif", "else", "fi"]) }); }
    let otherwise = []; if (isWord(this.peek(), "else")) { this.take(); otherwise = this.parseList(["fi"]); }
    this.expectWord("fi"); return { type: "if", branches, otherwise };
  }
  parseCase() {
    this.take(); const subject = this.take(); if (subject?.type !== "word") throw new SyntaxError("sh: case requires a word");
    this.expectWord("in"); this.skipSeparators(); const arms = [];
    while (!isWord(this.peek(), "esac")) {
      const patterns = [[]];
      while (this.peek() && !(this.peek().type === "op" && this.peek().value === ")")) {
        const part = this.take();
        if (part.type === "op" && part.value === "|") patterns.push([]);
        else if (part.type === "word") patterns.at(-1).push(part);
        else throw new SyntaxError("sh: invalid case pattern");
      }
      this.expectOp(")"); const body = this.parseList(["esac"], [";;"]); arms.push({ patterns, body });
      if (this.peek()?.type === "op" && this.peek().value === ";;") { this.take(); this.skipSeparators(); }
      else if (!isWord(this.peek(), "esac")) throw new SyntaxError("sh: case arm must end with ';;'");
    }
    this.expectWord("esac"); return { type: "case", subject, arms };
  }
  parseFor() {
    this.take(); const variable = this.take();
    if (variable?.type !== "word" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.raw)) throw new SyntaxError("sh: invalid for variable");
    let words = null;
    if (isWord(this.peek(), "in")) {
      this.take(); words = [];
      while (this.peek() && !isWord(this.peek(), "do") && !(this.peek().type === "op" && this.peek().value === ";")) {
        if (this.peek().type !== "word") throw new SyntaxError("sh: invalid for list"); words.push(this.take());
      }
    }
    this.skipSeparators(); this.expectWord("do"); const body = this.parseList(["done"]); this.expectWord("done");
    return { type: "for", variable: variable.raw, words, body };
  }
  parseWhile() {
    const mode = this.take().raw; const condition = this.parseList(["do"]); this.expectWord("do");
    const body = this.parseList(["done"]); this.expectWord("done"); return { type: "while", mode, condition, body };
  }
  parseSimple() {
    const words = [];
    while (this.peek() && !(this.peek().type === "op" && [";", ";;", "&&", "||", "|", "(", ")"].includes(this.peek().value))) {
      if (this.peek().type !== "word") break; words.push(this.take());
    }
    if (!words.length) { const token = this.peek(); throw new SyntaxError(`sh: unexpected token '${token?.raw || token?.value || "end of input"}'`); }
    return { type: "simple", words };
  }
}

function pathFor(value, state, vfs) { return vfs.constructor.normalizePath(String(value ?? ""), state.cwd); }
function resolveExecutable(command, state, context) {
  const vfs = context.virtualFileSystem; if (!vfs) return null;
  if (command.includes("/")) { try { const path = pathFor(command, state, vfs); return vfs.get(path)?.type === "file" ? path : null; } catch { return null; } }
  for (const directory of String(state.env.PATH || "").split(":")) {
    if (!directory) continue;
    try { const path = vfs.constructor.normalizePath(`${directory}/${command}`); if (vfs.get(path)?.type === "file") return path; } catch { /* Ignore invalid PATH components. */ }
  }
  return null;
}
function patternRegex(pattern) {
  let source = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*") source += ".*";
    else if (c === "?") source += ".";
    else if (c === "[" && pattern.indexOf("]", i + 1) !== -1) { const end = pattern.indexOf("]", i + 1); source += pattern.slice(i, end + 1); i = end; }
    else source += c.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}
function testStatus(args, state, context) {
  const a = [...args]; if (a.at(-1) === "]") a.pop();
  if (a[0] === "!") return testStatus(a.slice(1), state, context) ? 0 : 1;
  if (!a.length) return 1;
  if (a.length === 2 && ["-n", "-z", "-e", "-f", "-d"].includes(a[0])) {
    if (a[0] === "-n") return a[1].length ? 0 : 1;
    if (a[0] === "-z") return a[1].length ? 1 : 0;
    const entry = context.virtualFileSystem.get(pathFor(a[1], state, context.virtualFileSystem));
    return entry && (a[0] !== "-f" || entry.type === "file") && (a[0] !== "-d" || entry.type === "directory") ? 0 : 1;
  }
  if (a.length === 1) return a[0] ? 0 : 1;
  const [left, op, right] = a;
  switch (op) {
    case "=": case "==": return left === right ? 0 : 1;
    case "!=": return left !== right ? 0 : 1;
    case "-n": return right.length ? 0 : 1;
    case "-z": return right.length ? 1 : 0;
    case "-eq": return Number(left) === Number(right) ? 0 : 1;
    case "-ne": return Number(left) !== Number(right) ? 0 : 1;
    case "-lt": return Number(left) < Number(right) ? 0 : 1;
    case "-le": return Number(left) <= Number(right) ? 0 : 1;
    case "-gt": return Number(left) > Number(right) ? 0 : 1;
    case "-ge": return Number(left) >= Number(right) ? 0 : 1;
    default:
      if (a.length === 2 && ["-e", "-f", "-d"].includes(left)) { const entry = context.virtualFileSystem.get(pathFor(right, state, context.virtualFileSystem)); return entry && (left !== "-f" || entry.type === "file") && (left !== "-d" || entry.type === "directory") ? 0 : 1; }
      return 2;
  }
}
function executeBuiltin(command, args, state, context) {
  const vfs = context.virtualFileSystem, write = context.write || (() => {});
  const usage = (form) => { throw new Error(`Usage: ${command} ${form}`); };
  switch (command) {
    case ":": case "true": return 0;
    case "false": return 1;
    case "pwd": write(state.cwd); return 0;
    case "cd": {
      const target = args[0] || state.env.HOME;
      if (target === "-") { const old = state.cwd; state.cwd = state.env.OLDPWD || "/home/desktop"; state.env.OLDPWD = old; write(state.cwd); }
      else { const path = pathFor(target, state, vfs); if (vfs.get(path)?.type !== "directory") throw new Error(`cd: not a directory: ${path}`); state.env.OLDPWD = state.cwd; state.cwd = path; }
      state.env.PWD = state.cwd; return 0;
    }
    case "which": {
      if (!args.length) { write("Usage: which <command>"); return 2; }
      let status = 0;
      for (const name of args) {
        if (BUILTINS.has(name)) write(`${name}: shell built-in`);
        else { const path = resolveExecutable(name, state, context); if (path) write(path); else { write(`${name}: not found`); status = 1; } }
      }
      return status;
    }
    case "export": {
      if (!args.length || args[0] === "-p") { Object.keys(state.env).sort().forEach((key) => write(`export ${key}=${JSON.stringify(state.env[key])}`)); return 0; }
      for (const arg of args) { const match = arg.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/s); if (!match) { write(`export: invalid identifier: ${arg}`); return 2; } if (match[2] !== undefined) state.env[match[1]] = match[2]; else if (state.env[match[1]] === undefined) state.env[match[1]] = ""; }
      return 0;
    }
    case "set": if (args[0] === "--") { state.positionals = args.slice(1); return 0; } return args.length ? 2 : 0;
    case "shift": { const count = args.length ? Number(args[0]) : 1; if (!Number.isInteger(count) || count < 0 || count > state.positionals.length) return 1; state.positionals = state.positionals.slice(count); return 0; }
    case "unset": for (const name of args) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) delete state.env[name]; return 0;
    case "eval": return args.length ? executeSource(args.join(" "), state, context) : 0;
    case "command": if (!args.length) return 0; return BUILTINS.has(args[0]) ? executeBuiltin(args[0], args.slice(1), state, context) : executeExternal(args[0], args.slice(1), state, context);
    case "type": case "which": {
      if (!args.length) { write(`Usage: ${command} <command>`); return 2; }
      let status = 0;
      for (const name of args) {
        if (BUILTINS.has(name)) write(command === "type" ? `${name} is a shell builtin` : `${name}: shell built-in`);
        else { const path = resolveExecutable(name, state, context); if (path) write(command === "type" ? `${name} is ${path}` : path); else { write(`${name}: not found`); status = 1; } }
      }
      return status;
    }
    case "echo": { let newline = true, out = [...args]; if (out[0] === "-n") { newline = false; out.shift(); } write(`${out.join(" ")}${newline ? "\n" : ""}`.replace(/\n$/, "")); return 0; }
    case "printf": { let index = 1; write((args[0] || "").replace(/\\([nrt\\])|%([sdif%])/g, (m, e, c) => { if (e) return ({ n: "\n", r: "\r", t: "\t", "\\": "\\" })[e]; if (c === "%") return "%"; const value = args[index++] ?? ""; return c === "d" || c === "i" ? String(Number.parseInt(value, 10) || 0) : String(value); })); return 0; }
    case "test": case "[": return testStatus(args, state, context);
    case "rm": if (!args.length) usage("<path>"); args.forEach((p) => vfs.moveToTrash(pathFor(p, state, vfs))); return 0;
    case "sh": return executeShell(args, state, context);
    case "exit": if (context.interactiveTerminal && state.interactiveShellDepth > 0) throw { shellControl: "exit-shell", status: Number(args[0] ?? state.lastStatus) || 0 }; throw { shellControl: command, status: Number(args[0] ?? state.lastStatus) || 0 };
    case "return": throw { shellControl: command, status: Number(args[0] ?? state.lastStatus) || 0 };
    case "break": case "continue": { const signal = new Error(`sh: ${command}: only valid inside a loop`); signal.shellControl = command; signal.depth = Number(args[0]) || 1; throw signal; }
    default: return null;
  }
}
function childShellContext(context) {
  const depth = Number(context.depth || 0) + 1;
  if (depth > 8) throw new Error("sh: maximum nesting depth exceeded");
  return { ...context, depth, interactiveTerminal: false };
}
function runSubshell(source, state, context, overrides = {}) {
  const childState = {
    ...state,
    env: { ...state.env },
    positionals: [...state.positionals],
    scriptName: state.scriptName,
    shellStack: [],
    interactiveShellDepth: 0,
  };
  const status = executeSource(source, childState, childShellContext(context), overrides);
  state.lastStatus = status;
  return status;
}
function enterInteractiveShell(state) {
  state.shellStack ||= [];
  state.shellStack.push({ cwd: state.cwd, env: structuredClone(state.env), positionals: [...state.positionals], scriptName: state.scriptName });
  state.env = { ...state.env };
  state.positionals = [];
  state.scriptName = "sh";
  state.interactiveShellDepth = state.shellStack.length;
}
function leaveInteractiveShell(state, status) {
  const parent = state.shellStack?.pop();
  if (!parent) return status;
  state.cwd = parent.cwd;
  state.env = parent.env;
  state.positionals = parent.positionals;
  state.scriptName = parent.scriptName;
  state.interactiveShellDepth = state.shellStack.length;
  state.lastStatus = status;
  return status;
}
function executeScriptFile(path, source, args, state, context) {
  let body = String(source ?? "");
  if (body.startsWith("#!")) {
    const newline = body.indexOf("\n");
    const shebang = (newline === -1 ? body.slice(2) : body.slice(2, newline)).replace(/\r$/, "").trim();
    const words = shebang.split(/\s+/).filter(Boolean);
    let interpreter = words.shift() || "";
    let interpreterArguments = words;
    if (interpreter.endsWith("/env")) {
      if (interpreterArguments[0] === "-S") interpreterArguments = interpreterArguments.slice(1);
      interpreter = interpreterArguments.shift() || "";
    }
    let interpreterPath = resolveExecutable(interpreter, state, context);
    if (!interpreterPath && interpreter.split("/").at(-1) === "sh") interpreterPath = resolveExecutable("sh", state, context);
    if (!interpreterPath) {
      (context.write || (() => {}))(t("terminal.script.interpreterNotFound", { path, interpreter: interpreter || "(empty)" }));
      return 127;
    }
    const interpreterName = interpreterPath.slice(interpreterPath.lastIndexOf("/") + 1);
    if (interpreterName !== "sh") {
      const launched = context.openVirtualPath?.(interpreterPath, context.terminalInstanceId, [...interpreterArguments, path, ...args], { cwd: state.cwd });
      if (launched == null) {
        (context.write || (() => {}))(t("terminal.script.cannotLaunchInterpreter", { interpreter: interpreterPath }));
        return 126;
      }
      return 0;
    }
    body = newline === -1 ? "" : body.slice(newline + 1);
  }
  return runSubshell(body, state, context, { scriptName: path, positionals: args });
}
function executeExternal(command, args, state, context) {
  const path = resolveExecutable(command, state, context);
  if (!path) { (context.write || (() => {}))(`sh: ${command}: command not found`); return 127; }
  const entry = context.virtualFileSystem.get(path);
  if (path.endsWith(".sh") || entry.content.startsWith("#!")) return executeScriptFile(path, entry.content, args, state, context);
  const content = entry.content.trim();
  if (content === "sh") return executeShell(args, state, context);
  if (VFS_COMMANDS.has(content)) return executeBuiltin(content, args, state, context);
  const launched = context.openVirtualPath?.(path, context.terminalInstanceId, args, { cwd: state.cwd });
  if (launched == null) { (context.write || (() => {}))(`sh: cannot launch ${command}`); return 127; }
  return 0;
}
function executeSimple(node, state, context) {
  const words = node.words.map((word) => wordValue(word, state)), assignments = [];
  while (words.length) { const match = words[0].match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s); if (!match) break; assignments.push([match[1], match[2]]); words.shift(); }
  assignments.forEach(([key, value]) => { state.env[key] = value; });
  if (!words.length) return 0;
  const [command, ...args] = words;
  return BUILTINS.has(command) ? executeBuiltin(command, args, state, context) : executeExternal(command, args, state, context);
}
function executeList(nodes, state, context) { for (const node of nodes) state.lastStatus = executeNode(node, state, context); return state.lastStatus; }
function executeNode(node, state, context) {
  if (node.type === "andOr") { let status = 0; for (const [i, term] of node.terms.entries()) { if (i && term.operator === "&&" && status !== 0) continue; if (i && term.operator === "||" && status === 0) continue; status = executeNode(term.command, state, context); } return status; }
  if (node.type === "simple") return executeSimple(node, state, context);
  if (node.type === "if") { for (const branch of node.branches) if (executeList(branch.condition, state, context) === 0) return executeList(branch.body, state, context); return executeList(node.otherwise, state, context); }
  if (node.type === "case") { const subject = wordValue(node.subject, state); for (const arm of node.arms) if (arm.patterns.some((pattern) => patternRegex(pattern.map((w) => wordValue(w, state)).join("")).test(subject))) return executeList(arm.body, state, context); return 0; }
  if (node.type === "for") { const values = node.words ? node.words.map((w) => wordValue(w, state)) : [...state.positionals]; for (const value of values) { state.env[node.variable] = value; try { executeList(node.body, state, context); } catch (signal) { if (signal?.shellControl === "break") { if (--signal.depth <= 0) return state.lastStatus; throw signal; } if (signal?.shellControl === "continue") { if (--signal.depth <= 0) continue; throw signal; } throw signal; } } return state.lastStatus; }
  if (node.type === "while") { for (let i = 0; i < MAX_LOOP_ITERATIONS; i += 1) { const pass = executeList(node.condition, state, context) === 0; if (node.mode === "while" ? !pass : pass) return state.lastStatus; try { executeList(node.body, state, context); } catch (signal) { if (signal?.shellControl === "break") { if (--signal.depth <= 0) return state.lastStatus; throw signal; } if (signal?.shellControl === "continue") { if (--signal.depth <= 0) continue; throw signal; } throw signal; } } throw new Error(`sh: loop exceeded ${MAX_LOOP_ITERATIONS} iterations`); }
  throw new Error(`sh: unsupported syntax: ${node.type}`);
}
function executeSource(source, state, context, overrides = {}) {
  const previous = { positionals: state.positionals, scriptName: state.scriptName };
  state.positionals = overrides.positionals ?? state.positionals; state.scriptName = overrides.scriptName ?? state.scriptName;
  let exitShellStatus;
  try { return executeList(new Parser(tokenize(source)).parseList(), state, context); }
  catch (signal) {
    if (signal?.shellControl === "exit-shell") exitShellStatus = signal.status;
    else if (["exit", "return"].includes(signal?.shellControl)) { state.lastStatus = signal.status; return signal.status; }
    else throw signal;
  } finally { state.positionals = previous.positionals; state.scriptName = previous.scriptName; }
  if (exitShellStatus !== undefined) return leaveInteractiveShell(state, exitShellStatus);
  return state.lastStatus;
}
function executeShell(args, state, context) {
  if (!args.length) { enterInteractiveShell(state); return 0; }
  if (args[0] === "-c") { if (args.length < 2) { (context.write || (() => {}))("Usage: sh -c <command>"); return 2; } return runSubshell(args[1], state, context, { scriptName: args[2] || "sh", positionals: args.slice(args.length > 2 ? 3 : 2) }); }
  const path = pathFor(args[0], state, context.virtualFileSystem);
  return executeScriptFile(path, context.virtualFileSystem.readFile(path), args.slice(1), state, context);
}
export function runVirtualShellCommand(commandLine, context = {}, state = {}, depth = 0) {
  const shellState = ensureState(state);
  if (depth > 8) throw new Error("sh: maximum nesting depth exceeded");
  const source = Array.isArray(commandLine) ? commandLine.map(String).join(" ") : String(commandLine ?? "");
  return executeSource(source, shellState, { ...context, depth, interactiveTerminal: true }, { scriptName: shellState.scriptName, positionals: shellState.positionals });
}
export { DEFAULT_ENV, tokenize as tokenizeVirtualShell };
