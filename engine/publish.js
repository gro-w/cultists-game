/* eslint-env node */
/**
 * Build a player-only distribution by removing every DEV-TOOLS block.
 * Usage: node publish.js
 */
const fs = require("node:fs");
const path = require("node:path");

const engineRoot = path.resolve(__dirname);
const projectRoot = path.resolve(engineRoot, "..");
const root = fs.existsSync(path.join(projectRoot, "index.html")) ? projectRoot : engineRoot;
const output = path.join(root, "publish");
const START = /^(\s*)(?:\/\/|\/\*|<!--)\s*DEV-TOOLS:START.*$/;
const END = /^(\s*)(?:\/\/|\/\*|<!--)\s*DEV-TOOLS:END.*$/;
const TEXT_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".md", ".txt"]);

function stripDeveloperBlocks(text, fileName) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let inside = false;
  for (const line of lines) {
    if (START.test(line)) {
      if (inside) throw new Error(`Nested DEV-TOOLS block in ${fileName}`);
      inside = true;
      continue;
    }
    if (END.test(line)) {
      if (!inside) throw new Error(`Unmatched DEV-TOOLS end in ${fileName}`);
      inside = false;
      continue;
    }
    if (!inside) result.push(line);
  }
  if (inside) throw new Error(`Unclosed DEV-TOOLS block in ${fileName}`);
  return result.join("\n");
}

function copyTree(source, destination) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    // Documentation and agent instructions are not player assets and may
    // intentionally mention development-only tools or markers.
    const from = path.join(source, entry.name);
    const relative = path.relative(root, from).replaceAll(path.sep, "/");
    if (relative.split("/").length === 1 && [".git", "publish", "publish.js", "dev-server.js", "editors", "node_modules", ".hermes", "AGENTS.md", "README.md", "copying.txt", "agent-notes.md", "docs", "legacy", "reports", "media", "tools", "probes", "dev"].includes(entry.name)) continue;
    // NG tooling, probes, migration inventories, and developer-only modules
    // are source-maintenance assets, never player assets. Keeping them out of
    // the copy also prevents their documentation strings from tripping the
    // player-build safety scan.
    if (relative === "engine/AGENTS.md" || relative === "engine/README.md" || relative === "engine/copying.txt"
      || relative === "engine/publish.js" || relative === "engine/verify-publish.js"
      || relative === "engine/dev-server.js" || relative === "engine/index.html"
      || relative === "engine/example.data" || relative.startsWith("engine/example.data/")
      || relative === "engine/docs" || relative.startsWith("engine/docs/")
      || relative === "engine/dev" || relative.startsWith("engine/dev/")
      || relative === "engine/tools" || relative.startsWith("engine/tools/")
      || relative === "engine/probes" || relative.startsWith("engine/probes/")
      || relative === "dev-server.js"
      || relative === "dev" || relative.startsWith("dev/")
      || relative === "tools" || relative.startsWith("tools/")
      || relative === "probes" || relative.startsWith("probes/")
      || relative === "MIGRATION-TODO.md" || relative === "LEGACY-NG-MIGRATION-INVENTORY.md"
      || relative === "LEGACY-RETIREMENT-AUDIT.md") continue;
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTree(from, to);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      fs.copyFileSync(from, to);
      continue;
    }
    const content = stripDeveloperBlocks(fs.readFileSync(from, "utf8"), path.relative(root, from));
    // A file containing only a DEV-TOOLS block is not part of the player build.
    if (content.trim()) {
      fs.writeFileSync(to, content);
    }
  }
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
copyTree(root, output);
console.log(`Published player build to ${path.relative(root, output)}`);
