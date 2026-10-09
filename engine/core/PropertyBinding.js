import { evaluateValueOutput } from "./ActivityRunner.js";

/**
 * PropertyBinding - lets a window/widget property be either a plain
 * literal or a wire-ref computed via a small value-only Blueprint attached
 * to the window definition ("窗口属性和组件属性也都可以通过蓝图指定，即不
 * 是固定值而是可以通过蓝图运算取值"). Reuses the exact same
 * `evaluateValueOutput` pure-value-node evaluator ActivityRunner uses for
 * blueprint value inputs (`arithmetic`/`getVariable`), so there is a single
 * source of truth for what a "value node graph" means in this engine - the
 * window's `valueGraph.nodes` bag is shaped identically to an Activity
 * blueprint's `nodes` map, just without flow nodes.
 *
 * The wire-ref shapes accepted mirror ActivityRunner's `resolveInput`:
 *   - `{ nodeId, port }` - pulls a value node's output from `valueGraph`
 *   - `{ variable }` - reads a global variable directly (no graph needed)
 *   - anything else - a plain literal, returned as-is
 */
export function isBoundValue(raw) {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && ("nodeId" in raw || "variable" in raw));
}

export function resolvePropertyValue(raw, { valueGraph, variableStore, pvGateway, dbGateway, runtimeGateway } = {}, fallback) {
  if (isBoundValue(raw)) {
    if ("nodeId" in raw) {
      if (!valueGraph || !variableStore) return fallback;
      // Runtime render contexts are rebuilt during window refreshes. Keep a
      // second reference on the shared VariableStore so a rebuilt/legacy
      // context cannot silently lose the public-variable gateway.
      const runtimePvGateway = pvGateway || variableStore.publicVariableGateway || null;
      return evaluateValueOutput(valueGraph, raw.nodeId, raw.port || "value", variableStore, new Set(), runtimePvGateway, dbGateway, runtimeGateway);
    }
    if ("variable" in raw) {
      const value = variableStore ? variableStore.get(raw.variable) : undefined;
      return value ?? fallback;
    }
  }
  return raw === undefined ? fallback : raw;
}

export default resolvePropertyValue;
