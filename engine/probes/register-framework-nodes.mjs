import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isEngineActivityNode, registerCustomActivityNode } from "../core/ActivityNodeRegistry.js";
import { decodeCl2Blueprints } from "../core/Cl2Embedded.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const definitions = decodeCl2Blueprints(JSON.parse(fs.readFileSync(path.join(here, "../../data/blueprint-nodes.framework.json"), "utf8")), "data/blueprint-nodes.framework.json");
for (const definition of definitions) {
  if (!isEngineActivityNode(definition.id)) registerCustomActivityNode(definition);
}
