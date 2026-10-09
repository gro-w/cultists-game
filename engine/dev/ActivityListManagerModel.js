// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { serializeCl2 } from "../core/Cl2Serializer.js";
/**
 * ActivityListManagerModel - DOM-independent state for the "Activity 列表
 * 管理器" developer window (plan §6.1). Owns Activity *lists* (which
 * activities belong to which list, and per-activity `timeLoaded`/`autoRun`
 * flags) plus an in-memory registry of loaded Activity definitions
 * (id + blueprint + displayName). This is a developer-only bookkeeping
 * layer: it never touches ActivityDefinitionStore/ActivityQueueRegistry,
 * which stay owned by the runtime (engine.js).
 */
const DEFAULT_LIST_ID = "default";

function cloneJSON(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createActivityListManagerModel() {
  const lists = new Map(); // listId -> { id, activityIds: string[] }
  const activities = new Map(); // activityId -> { id, displayName, blueprint, timeLoaded, autoRun, listId }

  function registerList(list) {
    if (!list || !list.id) throw new Error(t("error.00706e81f518"));
    lists.set(list.id, { id: list.id, activityIds: [...(list.activityIds || [])] });
    return lists.get(list.id);
  }

  function registerActivity(listId, definition, meta = {}) {
    if (!definition || !definition.id) throw new Error(t("error.6ce7ea0c5850"));
    activities.set(definition.id, {
      id: definition.id,
      displayName: definition.displayName || definition.id,
      blueprint: cloneJSON(definition.blueprint),
      timeLoaded: Boolean(meta.timeLoaded),
      autoRun: Boolean(meta.autoRun),
      listId,
    });
    const list = lists.get(listId);
    if (list && !list.activityIds.includes(definition.id)) list.activityIds.push(definition.id);
    return activities.get(definition.id);
  }

  /** Lists ordered with the built-in `default` list pinned first (§6.1 "内置 default 列表置顶且不可删除"). */
  function listLists() {
    const entries = [...lists.values()];
    entries.sort((a, b) => {
      if (a.id === DEFAULT_LIST_ID) return -1;
      if (b.id === DEFAULT_LIST_ID) return 1;
      return a.id.localeCompare(b.id);
    });
    return entries;
  }

  function isBuiltInList(listId) {
    return listId === DEFAULT_LIST_ID;
  }

  function createList(listId) {
    if (lists.has(listId)) throw new Error(`Activity list "${listId}" already exists`);
    return registerList({ id: listId, activityIds: [] });
  }

  function duplicateList(sourceListId, newListId) {
    const source = lists.get(sourceListId);
    if (!source) throw new Error(`Unknown activity list: ${sourceListId}`);
    if (lists.has(newListId)) throw new Error(`Activity list "${newListId}" already exists`);
    return registerList({ id: newListId, activityIds: [...source.activityIds] });
  }

  function renameList(listId, newListId) {
    if (isBuiltInList(listId)) throw new Error(t("legacy.6048ce671500"));
    const list = lists.get(listId);
    if (!list) throw new Error(`Unknown activity list: ${listId}`);
    if (lists.has(newListId)) throw new Error(`Activity list "${newListId}" already exists`);
    lists.delete(listId);
    list.id = newListId;
    lists.set(newListId, list);
    for (const activity of activities.values()) {
      if (activity.listId === listId) activity.listId = newListId;
    }
    return list;
  }

  function removeList(listId) {
    if (isBuiltInList(listId)) throw new Error(t("legacy.81774c11020e"));
    return lists.delete(listId);
  }

  function listActivities(listId) {
    const list = lists.get(listId);
    if (!list) return [];
    return list.activityIds.map((id) => activities.get(id)).filter(Boolean);
  }

  function createActivity(listId, activityId, blueprint) {
    if (activities.has(activityId)) throw new Error(`Activity "${activityId}" already exists`);
    return registerActivity(listId, { id: activityId, blueprint });
  }

  function duplicateActivity(listId, sourceActivityId, newActivityId) {
    const source = activities.get(sourceActivityId);
    if (!source) throw new Error(`Unknown activity: ${sourceActivityId}`);
    if (activities.has(newActivityId)) throw new Error(`Activity "${newActivityId}" already exists`);
    return registerActivity(listId, { id: newActivityId, displayName: source.displayName, blueprint: source.blueprint }, source);
  }

  /** Removes the activity id from a list's membership only; the activity definition itself is untouched (§6.1 "从列表移除"). */
  function removeFromList(listId, activityId) {
    const list = lists.get(listId);
    if (!list) return false;
    const before = list.activityIds.length;
    list.activityIds = list.activityIds.filter((id) => id !== activityId);
    return list.activityIds.length !== before;
  }

  /** Deletes the activity definition itself, and removes it from every list referencing it (§6.1 "删除文件"). */
  function deleteActivityDefinition(activityId) {
    const existed = activities.delete(activityId);
    for (const list of lists.values()) {
      list.activityIds = list.activityIds.filter((id) => id !== activityId);
    }
    return existed;
  }

  /** Renames an activity's stable id in place (plan follow-up: "蓝图id可以编辑") - keeps its blueprint/displayName/listId/meta, and rewrites every list's `activityIds` membership entry so the rename is invisible to list ordering. */
  function renameActivity(activityId, newActivityId) {
    if (!activities.has(activityId)) throw new Error(`Unknown activity: ${activityId}`);
    if (activityId === newActivityId) return activities.get(activityId);
    if (activities.has(newActivityId)) throw new Error(`Activity "${newActivityId}" already exists`);
    const activity = activities.get(activityId);
    activities.delete(activityId);
    activity.id = newActivityId;
    activities.set(newActivityId, activity);
    for (const list of lists.values()) {
      list.activityIds = list.activityIds.map((id) => (id === activityId ? newActivityId : id));
    }
    return activity;
  }

  function setActivityMeta(activityId, meta = {}) {
    const activity = activities.get(activityId);
    if (!activity) return false;
    if ("timeLoaded" in meta) activity.timeLoaded = Boolean(meta.timeLoaded);
    if ("autoRun" in meta) activity.autoRun = Boolean(meta.autoRun);
    if ("displayName" in meta) activity.displayName = meta.displayName;
    return true;
  }

  function getActivity(activityId) {
    const activity = activities.get(activityId);
    return activity ? { ...activity, blueprint: cloneJSON(activity.blueprint) } : null;
  }

  /** Commit a draft blueprint (e.g. from an ActivityEditorModel) into memory - "保存到内存" (§6.1). */
  function saveActivityBlueprint(activityId, blueprint) {
    const activity = activities.get(activityId);
    if (!activity) return false;
    activity.blueprint = cloneJSON(blueprint);
    return true;
  }

  function exportListJSON(listId) {
    const list = lists.get(listId);
    if (!list) return null;
    return JSON.stringify({ id: list.id, activityIds: [...list.activityIds] }, null, 2);
  }

  function exportActivityJSON(activityId) {
    const activity = getActivity(activityId);
    if (!activity) return null;
    return JSON.stringify({ id: activity.id, displayName: activity.displayName, blueprint: activity.blueprint }, null, 2);
  }

  function exportActivityCL2(activityId) {
    const activity = getActivity(activityId);
    return activity ? serializeCl2(activity.blueprint, { activityId }) : null;
  }

  return {
    registerList,
    registerActivity,
    listLists,
    isBuiltInList,
    createList,
    duplicateList,
    renameList,
    removeList,
    listActivities,
    createActivity,
    duplicateActivity,
    removeFromList,
    deleteActivityDefinition,
    renameActivity,
    setActivityMeta,
    getActivity,
    saveActivityBlueprint,
    exportListJSON,
    exportActivityJSON,
    exportActivityCL2,
  };
}

export default createActivityListManagerModel;
// DEV-TOOLS:END
