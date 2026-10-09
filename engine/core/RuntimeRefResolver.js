import { t } from "./i18n/index.js";
/**
 * RuntimeRefResolver - plan §10.1's "受注册引用" resolver for `object`-typed
 * public variables. Domains (Activity instances, Activity queues, custom
 * structure database records, other global variables, window instances,
 * ...) each register a resolver function under a stable `objectType` key;
 * `resolve({objectType, objectId})` looks the ref up on demand and returns
 * an explicit `{resolved:false, value:null}` result for anything it can't
 * find - a stale/invalidated ref must never silently resolve to some other
 * object (plan: "失效引用必须变成明确的 unresolved 状态，不静默指向其他对
 * 象").
 */
export class RuntimeRefResolver {
  constructor() {
    this.resolvers = new Map(); // objectType -> (objectId) => value|null|undefined
  }

  /** Registers (or replaces) the resolver function for one `objectType`. */
  register(objectType, resolveFn) {
    if (!objectType) throw new Error(t("error.aa84c8e7f191"));
    if (typeof resolveFn !== "function") throw new Error(`RuntimeRefResolver resolver for "${objectType}" must be a function`);
    this.resolvers.set(objectType, resolveFn);
  }

  unregister(objectType) {
    return this.resolvers.delete(objectType);
  }

  /** Resolves a `{objectType, objectId}` ref. Never throws for an unknown/stale ref - always the explicit unresolved shape instead. */
  resolve(ref) {
    if (!ref || typeof ref !== "object" || !ref.objectType) return { resolved: false, value: null };
    const resolveFn = this.resolvers.get(ref.objectType);
    if (!resolveFn) return { resolved: false, value: null };
    let value;
    try {
      value = resolveFn(ref.objectId);
    } catch {
      return { resolved: false, value: null };
    }
    if (value === null || value === undefined) return { resolved: false, value: null };
    return { resolved: true, value };
  }
}

export default RuntimeRefResolver;
