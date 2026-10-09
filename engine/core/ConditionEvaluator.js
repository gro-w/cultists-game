/** Generic declarative condition evaluator shared by windows and Activities. */
const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte"]);

function compare(actual, expected, op = "eq") {
  if (!OPS.has(op)) return false;
  if (op === "eq") return actual === expected;
  if (op === "neq") return actual !== expected;
  if (op === "gt") return actual > expected;
  if (op === "gte") return actual >= expected;
  if (op === "lt") return actual < expected;
  return actual <= expected;
}

function activityMatches(condition, context) {
  const id = condition.id || condition.activityId;
  const definition = id && context.activityDefinitionStore?.get(id);
  if (!definition) return false;
  if (definition.condition && !evaluateCondition(definition.condition, context)) return false;
  if (definition.day != null && context.gameClock?.day !== definition.day) return false;
  const entries = context.activityQueueRegistry?.list?.().flatMap((queue) => queue.entries || []) || [];
  const resolved = entries.some((entry) => entry.activityId === id && entry.status === "resolved");
  if (condition.completed === true) return resolved;
  if (condition.completed === false || condition.available === true) return !resolved;
  return true;
}

export function evaluateCondition(condition, context = {}) {
  if (condition == null || condition === true) return true;
  if (condition === false) return false;
  if (Array.isArray(condition)) return condition.every((item) => evaluateCondition(item, context));
  if (condition.all) return condition.all.every((item) => evaluateCondition(item, context));
  if (condition.any) return condition.any.some((item) => evaluateCondition(item, context));
  if (condition.not) return !evaluateCondition(condition.not, context);
  if (condition.activity) return activityMatches(condition.activity, context);
  if (condition.gameClock) {
    const clock = context.gameClock?.snapshot?.() || {};
    return Object.entries(condition.gameClock).every(([key, expected]) => {
      if (key === "totalMinutes") return compare((clock.day - 1) * 1440 + clock.minutes, expected.value, expected.op);
      return compare(clock[key], expected.value ?? expected, expected.op);
    });
  }
  if (condition.variable) return compare(context.variableStore?.get(condition.variable), condition.value, condition.op);
  const publicCondition = condition.publicVariableCondition || condition.globalVariables;
  if (publicCondition && !condition.publicVariableCondition) {
    const leaves = Array.isArray(publicCondition) ? publicCondition : [publicCondition];
    return leaves.every((leaf) => evaluateCondition({ publicVariableCondition: leaf }, context));
  }
  if (condition.publicVariableCondition) {
    const gateway = context.publicVariableManager || context.pvGateway;
    if (!gateway) return false;
    return compare(gateway.get(condition.publicVariableCondition.id), condition.publicVariableCondition.value, condition.publicVariableCondition.op);
  }
  return false;
}

export default evaluateCondition;