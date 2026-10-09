import { serializeCl2 } from "./Cl2Serializer.js";

export function compactCl2Source(source) {
  let output = "";
  let quote = null;
  let escaped = false;
  let comment = false;
  let space = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (comment) {
      if (source.startsWith("*/", index)) { output += " */"; comment = false; index += 1; }
      else if (/\s/.test(char)) space = true;
      else { if (space) output += " "; space = false; output += char; }
      continue;
    }
    if (quote) { output += char; if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === quote) quote = null; continue; }
    if (source.startsWith("/*", index)) { if (space) output += " "; space = false; output += "/*"; comment = true; index += 1; continue; }
    if (char === '"' || char === "'") { if (space) output += " "; space = false; quote = char; output += char; continue; }
    if (/\s/.test(char)) { space = true; continue; }
    if (space && output && !/[([ ]$/.test(output)) output += " ";
    space = false;
    output += char;
  }
  return output.trim();
}

export function encodeCl2Blueprints(value, sourcePath = "<embedded>") {
  if (Array.isArray(value)) return value.map((item, index) => encodeCl2Blueprints(item, `${sourcePath}[${index}]`));
  if (!value || typeof value !== "object") return value;
  if (value.startNodeId && value.nodes && typeof value.nodes === "object") return { cl2: compactCl2Source(serializeCl2(value, { includeHeader: true })) };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeCl2Blueprints(item, `${sourcePath}.${key}`)]));
}

export default encodeCl2Blueprints;
