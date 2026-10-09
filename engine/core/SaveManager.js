import { t } from "./i18n/index.js";
import { VirtualFileSystem } from "./VirtualFileSystem.js";
/**
 * SaveManager - the single owner of the save/restore boundary (plan §12
 * "存档系统"). Produces/consumes a versioned envelope:
 *
 *   { format: "cultists-ng-save", version, engineVersion,
 *     createdAtGameTime, state: {...} }
 *
 * `state` holds a deep-cloned, DOM/function/Promise-free snapshot of only
 * save-scoped runtime state (plan §12.2): public + generic variables,
 * Activity queues (which already embed each
 * instance's currentNodeId/waiting condition/status, so "Activity 实例"
 * and "Activity 队列" from the plan's illustrative schema are one and the
 * same object here), open window instances/geometry and desktop icon
 * layout. Definition files (activities/windows/structures/databases) are
 * project data, reloaded on boot - never copied into a save.
 *
 * Restore safety (plan §12.3), enforced centrally here rather than by each
 * caller remembering the right order:
 *   1. Validate the envelope *before* touching any live state - a bad
 *      save must never leave the game half-mutated.
 *   2. Stop every running Activity runner (`activityExecutionService.clear()`).
 *   3. Replace every manager's snapshot.
 *   4. Re-scan queues for pending (unresolved) instances and resume their
 *      runners exactly once, only after every snapshot has been replaced.
 *   5. A `restoring` guard (released in `finally`) rejects re-entrant
 *      restores instead of corrupting state with two restores racing.
 */
const SAVE_FORMAT = "cultists-ng-save";
// v2 (plan §8 "关键词的收集"): adds `state.keywords` (KeywordManager's
// collected-set). v3 (Phase 8 新手引导): adds `state.onboarding`
// (the event-state registry's marked/requested/dismissed sets). Bumped
// rather than silently defaulting missing entries on load (AGENTS.md: "改
// 变 payload...要评估是否提升版本；旧版本不应静默迁移") - an older save is
// explicitly rejected by `_validate`, not migrated.
// v5 added the authoritative GameState snapshot. v6 removes database records
// from saves. v7 replaces hard-coded keyword/game-state fields with generic
// content state providers; canonical content remains outside player saves.
// v8 persists Activity execution progress, trace, breakpoints, and pause location.
// v9 embeds the mutable virtual filesystem; launcher/layout state now belongs to its .lnk files.
const SAVE_FORMAT_VERSION = 9;

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function defaultSaveableVariable(key, value) {
  return !String(key).startsWith("__")
    && (value === null || ["boolean", "number", "string"].includes(typeof value));
}

export class SaveManager {
  constructor({
    gameClock,
    variableStore,
    publicVariableManager,

    activityQueueRegistry,
    windowManager,
    virtualFileSystem,
    eventStateRegistry,
    onboardingManager = eventStateRegistry,
    stateProviders = {},
    runtimeStores = {},
    saveableVariable = defaultSaveableVariable,
    windowStateFilter = () => true,
    activityExecutionService,
    resumePendingActivities,
    engineVersion = "0.1.0",
  } = {}) {
    this.gameClock = gameClock;
    this.variableStore = variableStore;
    this.publicVariableManager = publicVariableManager;
    this.activityQueueRegistry = activityQueueRegistry;
    this.windowManager = windowManager;
    this.virtualFileSystem = virtualFileSystem;
    this.eventStateRegistry = eventStateRegistry || onboardingManager;
    this.stateProviders = stateProviders;
    this.runtimeStores = runtimeStores;
    this.saveableVariable = saveableVariable;
    this.windowStateFilter = windowStateFilter;
    this.activityExecutionService = activityExecutionService;
    this.resumePendingActivities = resumePendingActivities || (() => {});
    this.engineVersion = engineVersion;
    this._restoring = false;
  }

  /** Builds a fresh, deep-copied save envelope from every live manager's current state. */
  snapshot() {
    const clockState = this.gameClock.snapshot();
    return {
      format: SAVE_FORMAT,
      version: SAVE_FORMAT_VERSION,
      engineVersion: this.engineVersion,
      createdAtGameTime: (clockState.day - 1) * 1440 + clockState.minutes,
      state: {
        gameClock: clockState,
        variables: this.variableStore.snapshot({ include: this.saveableVariable }),
        publicVariables: this.publicVariableManager.snapshot(),

        queues: this.activityQueueRegistry.snapshot(),
        windows: this.windowManager.snapshotInstances().filter((window) => this.windowStateFilter(window)),
        virtualFileSystem: this.virtualFileSystem.snapshot(),
        onboarding: this.eventStateRegistry.snapshot(),
        providers: Object.fromEntries(Object.entries(this.stateProviders).map(([id, provider]) => [id, provider.snapshot()])),
        runtime: Object.fromEntries(Object.entries(this.runtimeStores).map(([id, store]) => [id, store.snapshot()])),
      },
    };
  }

  /** Validates envelope shape/format/version without mutating anything; throws with a descriptive message on any problem. */
  _validate(envelope) {
    if (!isPlainObject(envelope)) throw new Error(t("error.8a863f4231ae"));
    if (envelope.format !== SAVE_FORMAT) throw new Error(`Unknown save format: ${envelope.format}`);
    if (envelope.version !== SAVE_FORMAT_VERSION) throw new Error(`Unsupported save version: ${envelope.version} (expected ${SAVE_FORMAT_VERSION})`);
    const state = envelope.state;
    if (!isPlainObject(state)) throw new Error(t("error.811f3d654c18"));
    if (!isPlainObject(state.gameClock)) throw new Error(t("error.cf1f3decd914"));

    if (!isPlainObject(state.variables)) throw new Error(t("error.327d0229944f"));
    if (!isPlainObject(state.publicVariables)) throw new Error(t("error.8927e49fb766"));

    if (!isPlainObject(state.queues)) throw new Error(t("error.a102f79c5ad2"));
    if (!Array.isArray(state.windows)) throw new Error(t("error.efa8dccb1c3c"));
    VirtualFileSystem.validateDocument(state.virtualFileSystem);
    if (!isPlainObject(state.onboarding)) throw new Error(t("error.9473c8d9f55e"));
    if (!isPlainObject(state.providers)) throw new Error(t("error.259ba6024a9a"));
    if (!isPlainObject(state.runtime)) throw new Error(t("error.898897bbe786"));
    return state;
  }

  /**
   * Restores every manager from `envelope`. Throws (without leaving any
   * live state corrupted) if the envelope is malformed, an unsupported
   * version, or carries an internally-inconsistent snapshot (e.g.
   * duplicate window instance ids): a full pre-restore snapshot is taken
   * first and re-applied if anything in `_applyState` throws partway
   * through, so a bad save can never leave a half-mutated session (plan
   * §12.3 "恢复失败不覆盖当前有效状态").
   */
  restore(envelope) {
    if (this._restoring) throw new Error(t("error.316eef60ff1e"));
    const state = this._validate(envelope);
    this._restoring = true;
    try {
      const rollback = this.snapshot();
      this.activityExecutionService.clear();
      try {
        this._applyState(state);
      } catch (err) {
        this._applyState(rollback.state);
        this.resumePendingActivities();
        throw err;
      }
      // Single post-restore scan (plan §12.3 "恢复成功后只扫描一次待启动
      // 项"): resume every queue's still-unresolved instance now that every
      // manager's state is consistent, not incrementally per-manager.
      this.resumePendingActivities();
    } finally {
      this._restoring = false;
    }
  }

  /** Replaces every manager's state from a validated `state` object; the one and only mutation point, shared by both the normal and rollback paths of `restore()`. */
  _applyState(state) {
    this.gameClock.restore(state.gameClock);
    const currentVariables = this.variableStore.snapshot();
    const preservedVariables = Object.keys(currentVariables).filter((key) => !this.saveableVariable(key, currentVariables[key]));
    this.variableStore.restore(state.variables, { preserve: preservedVariables });
    this.publicVariableManager.restore(state.publicVariables);

    this.activityQueueRegistry.restore(state.queues);
    this.windowManager.restoreInstances(state.windows.filter((window) => this.windowStateFilter(window)));
    this.virtualFileSystem.restore(state.virtualFileSystem);
    this.eventStateRegistry.restore(state.onboarding);
    for (const [id, provider] of Object.entries(this.stateProviders)) provider.restore(state.providers[id] || {});
    for (const [id, store] of Object.entries(this.runtimeStores)) store.restore(state.runtime[id] || {});
  }
}

export default SaveManager;
