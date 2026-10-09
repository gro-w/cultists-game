import { t as translate } from "./i18n/index.js";

function t(key, values = {}) {
  const text = String(translate(key, key));
  return Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), text);
}

/**
 * Generic core capabilities for virtual filesystem access and terminal output.
 * Blueprint nodes and registered command Activities use these APIs so neither
 * UI widgets nor game/framework data need direct filesystem implementation.
 */
export function registerVirtualFileSystemCapabilities({ apiGateway, eventBus, virtualFileSystem } = {}) {
  if (!apiGateway?.register || !eventBus?.emit || !virtualFileSystem) {
    throw new Error("Virtual filesystem capabilities require an API gateway, event bus, and VFS");
  }

  apiGateway.register("vfs.execute", ({ operation, arguments: args = [], path, source, destination, content = "", cwd = "/home/desktop", terminalInstanceId } = {}) => {
    const values = Array.isArray(args) ? args.map((value) => String(value ?? "")) : [];
    const names = (directory) => virtualFileSystem.list(directory, cwd).map((entry) => {
      const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      return `${name}${entry.type === "directory" ? "/" : ""}`;
    });
    const result = (ok, output = "") => {
      const value = { ok, output };
      if (terminalInstanceId && output) eventBus.emit("terminal:write", { instanceId: terminalInstanceId, text: output });
      return value;
    };
    try {
      let output = "";
      switch (operation) {
        case "cat":
          if (!values.length) return result(false, t("terminal.vfs.usage.cat"));
          output = values.map((value) => virtualFileSystem.readFile(value, cwd)).join("\n");
          break;
        case "ls": {
          const targets = values.length ? values : [path || cwd];
          output = targets.map((value) => {
            const entry = virtualFileSystem.get(value, cwd);
            if (!entry) throw new Error(t("terminal.vfs.notFound", { path: value }));
            return entry.type === "file"
              ? entry.path.slice(entry.path.lastIndexOf("/") + 1)
              : names(value).join("  ");
          }).filter(Boolean).join("\n");
          break;
        }
        case "cp": case "mv": {
          const from = values[0] || source;
          const to = values[1] || destination;
          if (values.length > 0 && values.length !== 2) return result(false, t("terminal.vfs.usage.copy", { command: operation }));
          if (!from || !to) return result(false, t("terminal.vfs.usage.copy", { command: operation }));
          if (operation === "cp") virtualFileSystem.copy(from, to, cwd);
          else virtualFileSystem.move(from, to, cwd);
          break;
        }
        case "touch": {
          const paths = values.length ? values : (path ? [path] : []);
          if (!paths.length) return result(false, t("terminal.vfs.usage.touch"));
          for (const value of paths) {
            const entry = virtualFileSystem.get(value, cwd);
            if (!entry) virtualFileSystem.createFile(value, "", { cwd });
            else if (entry.type !== "file") throw new Error(t("terminal.vfs.notFile", { path: entry.path }));
          }
          break;
        }
        case "read": output = virtualFileSystem.readFile(path, cwd); break;
        case "write": virtualFileSystem.writeFile(path, String(content), { cwd, create: true }); break;
        case "list": output = names(path || cwd).join("  "); break;
        case "copy": virtualFileSystem.copy(source, destination, cwd); break;
        case "move": virtualFileSystem.move(source, destination, cwd); break;
        case "mkdir": virtualFileSystem.mkdir(path, { cwd }); break;
        case "remove": virtualFileSystem.remove(path, cwd); break;
        default: throw new Error(t("terminal.vfs.unknownOperation", { operation }));
      }
      return result(true, output);
    } catch (error) {
      return result(false, error?.message || String(error));
    }
  });

  apiGateway.register("terminal.write", ({ instanceId, text } = {}) => {
    if (typeof instanceId !== "string" || !instanceId) return { ok: false, reason: "missing-terminal-instance" };
    const output = Array.isArray(text) ? text.join("  ")
      : text && typeof text === "object" ? JSON.stringify(text)
        : String(text ?? "");
    if (output) eventBus.emit("terminal:write", { instanceId, text: output });
    return { ok: true, instanceId };
  });
}
