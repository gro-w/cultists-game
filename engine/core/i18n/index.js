import { CORE_LOCALES } from "./I18nManager.js";

let activeManager = null;

export function setActiveI18nManager(manager) {
  activeManager = manager || null;
}

export function t(key, fallback = key) {
  if (activeManager) return activeManager.translate(key, fallback);
  return CORE_LOCALES.get("zh-cn")?.messages?.[key] ?? fallback;
}

export function getActiveI18nManager() {
  return activeManager;
}

export default t;
