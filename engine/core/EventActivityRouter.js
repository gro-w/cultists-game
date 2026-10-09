import { t } from "./i18n/index.js";
/**
 * Generic data-driven event router.
 *
 * Core only routes opaque event names to declared Activities and performs
 * generic runtime-collection mutations. Domain names, payload paths, and
 * collection IDs are supplied by Framework/Game data.
 */
function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function readPath(value, path) {
  if (!path) return value;
  return String(path).split(".").reduce((current, key) => current == null ? undefined : current[key], value);
}

function resolve(value, payload, variableStore, resources = {}) {
  if (Array.isArray(value)) return value.map((item) => resolve(item, payload, variableStore, resources));
  if (!value || typeof value !== "object") return value;
  if (Object.keys(value).length === 1 && typeof value.path === "string") return clone(readPath(payload, value.path));
  if (Object.keys(value).length === 1 && typeof value.variable === "string") return clone(variableStore?.get(value.variable));
  if (typeof value.resource === "string") {
    const id = resolve(value.id, payload, variableStore, resources);
    const record = resources[value.resource]?.get(String(id));
    return clone(value.field ? record?.[value.field] : record);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child, payload, variableStore, resources)]));
}

function matchesCondition(condition, payload) {
  if (!condition) return true;
  for (const [key, expected] of Object.entries(condition)) {
    if (key === "path" || key === "op" || key === "value" || key === "in") continue;
    if (typeof expected === "boolean" && Boolean(payload[key]) !== expected) return false;
    if (expected && typeof expected === "object" && payload[key] !== undefined) {
      const operator = Object.keys(expected)[0];
      const actual = payload[key];
      const target = expected[operator];
      if (operator === "eq" && actual !== target) return false;
      if (operator === "gte" && !(actual >= target)) return false;
      if (operator === "gt" && !(actual > target)) return false;
      if (operator === "lte" && !(actual <= target)) return false;
      if (operator === "lt" && !(actual < target)) return false;
      if (!["eq", "gte", "gt", "lte", "lt"].includes(operator) && !matchesCondition({ path: key, ...expected }, payload)) return false;
    }
  }
  if (condition.value && typeof condition.value === "object" && condition.path === undefined) {
    const actual = payload.value;
    const operator = Object.keys(condition.value)[0];
    const expected = condition.value[operator];
    if (operator === "eq" && actual !== expected) return false;
    if (operator === "gte" && !(actual >= expected)) return false;
    if (operator === "gt" && !(actual > expected)) return false;
    if (operator === "lte" && !(actual <= expected)) return false;
    if (operator === "lt" && !(actual < expected)) return false;
  }
  if (condition.allAbove !== undefined && !(payload.allAbove >= condition.allAbove)) return false;
  if (condition.path === undefined && condition.op === undefined && condition.in === undefined) return true;
  const actual = readPath(payload, condition.path || "");
  if (Array.isArray(condition.in)) return condition.in.includes(actual);
  if (condition.op === "gt") return actual > condition.value;
  if (condition.op === "gte") return actual >= condition.value;
  if (condition.op === "lt") return actual < condition.value;
  if (condition.op === "lte") return actual <= condition.value;
  if (condition.op === "neq") return actual !== condition.value;
  return actual === condition.value;
}

export class EventActivityRouter {
  constructor({ eventBus, variableStore, runtimeGateway, displayRegistry, stateBoundary = null, resources = {}, runActivity, windowGateway = null, routes = [] } = {}) {
    this.eventBus = eventBus;
    this.variableStore = variableStore;
    this.runtimeGateway = runtimeGateway;
    this.displayRegistry = displayRegistry;
    this.stateBoundary = stateBoundary;
    this.resources = resources;
    this.runActivity = runActivity;
    this.windowGateway = windowGateway;
    this.routes = Array.isArray(routes) ? routes : [];
    this.unsubscribers = [];
  }

  start() {
    this.stop();
    for (const route of this.routes) {
      if (!route?.event) continue;
      this.unsubscribers.push(this.eventBus.on(route.event, (payload) => this.handle(route, payload || {})));
    }
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  }

  handle(route, payload = {}) {
    if (!matchesCondition(route.condition, payload)) return false;
    this.variableStore?.set("event:name", route.event);
    this.variableStore?.set("event:payload", clone(payload));
    for (const action of route.actions || []) this.applyAction(action, payload);
    if (route.activityId && this.runActivity) return this.runActivity(route.activityId, route.queueId || "main");
    return true;
  }

  applyAction(action, payload) {
    const value = resolve(action.value, payload, this.variableStore, this.resources);
    switch (action.type) {
      case "collection.set":
        return this.runtimeGateway.setCollectionValue(action.collectionId, resolve(action.recordId, payload, this.variableStore, this.resources), value);
      case "collection.mutate":
        return this.runtimeGateway.mutateCollection(action.collectionId, resolve(action.recordId, payload, this.variableStore, this.resources), action.operation || "delta", value);
      case "collection.incrementField": {
        const next = this.runtimeGateway.incrementField(
          action.collectionId,
          resolve(action.recordId, payload, this.variableStore, this.resources),
          action.field,
          action.absolute ? Math.abs(Number(value || 0)) : value,
        );
        if (action.unlockAt !== undefined && Number(next?.[action.field] || 0) >= Number(resolve(action.unlockAt, payload, this.variableStore, this.resources))) {
          const unlockValue = resolve(action.unlockValue || { unlocked: true }, payload, this.variableStore, this.resources);
          this.runtimeGateway.mutateCollection(
            action.collectionId,
            resolve(action.recordId, payload, this.variableStore, this.resources),
            "merge",
            unlockValue,
          );
        }
        return next;
      }
      case "collection.operation":
        return this.runtimeGateway.operateCollection(action.collectionId, resolve(action.recordId, payload, this.variableStore, this.resources), { operation: action.operation || "delta", value, minimum: resolve(action.minimum, payload, this.variableStore, this.resources) });
      case "collection.append":
        return this.runtimeGateway.appendCollectionValue(action.collectionId, value);
      case "variable.set":
        this.variableStore.set(action.key, value);
        return value;
      case "stateBoundary.requestLocation":
        if (!this.stateBoundary?.requestLocation) throw new Error(t("error.32015cd92a9d"));
        return this.stateBoundary.requestLocation(value);
      case "event.emit":
        this.eventBus.emit(action.event, value);
        return value;
      case "window.open":
        if (!this.windowGateway) throw new Error(t("error.0167a8164d4d"));
        return this.windowGateway(resolve(action.windowId, payload, this.variableStore, this.resources));
      case "display.dispatch": {
        const displayPayload = { ...(value || {}), type: action.displayType || value?.type };
        return this.displayRegistry?.dispatch(resolve(action.target || "default", payload, this.variableStore, this.resources), displayPayload);
      }
      default:
        throw new Error(`Unknown event route action: ${action.type}`);
    }
  }
}

export default EventActivityRouter;
