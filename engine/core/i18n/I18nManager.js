import zhCN from "./zh-cn.js";
import enUS from "./en-us.js";

const LOCALES = new Map([
  [zhCN.id, zhCN],
  [enUS.id, enUS],
]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

/**
 * Core language state. Locale modules are the only source of engine-owned
 * strings; content packages may register their own locale modules separately.
 */
export class I18nManager {
  constructor({ eventBus = null, locales = LOCALES, language = "zh-cn", supportedLanguages = null } = {}) {
    this.eventBus = eventBus;
    this.locales = new Map(locales);
    this.supportedLanguages = new Set(supportedLanguages || this.locales.keys());
    this.currentLanguage = this._validLanguage(language) || this._firstSupported();
  }

  _firstSupported() {
    return [...this.supportedLanguages].find((id) => this.locales.has(id)) || [...this.locales.keys()][0] || "en-us";
  }

  _validLanguage(language) {
    const id = String(language || "").toLowerCase();
    return this.locales.has(id) && this.supportedLanguages.has(id) ? id : null;
  }

  listLocales() {
    return [...this.locales.values()].map((locale) => ({ id: locale.id, name: locale.name, supported: this.supportedLanguages.has(locale.id) }));
  }

  listSupportedLanguages() {
    return this.listLocales().filter((locale) => locale.supported);
  }

  getLanguage() {
    return this.currentLanguage;
  }

  setLanguage(language) {
    const id = this._validLanguage(language);
    if (!id) throw new Error(`Unsupported language: ${language}`);
    if (id === this.currentLanguage) return id;
    const previous = this.currentLanguage;
    this.currentLanguage = id;
    this.eventBus?.emit("i18n:changed", { previous, language: id });
    return id;
  }

  setSupportedLanguages(languages) {
    const next = new Set((Array.isArray(languages) ? languages : []).map((id) => String(id).toLowerCase()).filter((id) => this.locales.has(id)));
    if (!next.size) throw new Error("At least one supported language is required");
    if (!next.has(this.currentLanguage)) this.currentLanguage = [...next][0];
    this.supportedLanguages = next;
    this.eventBus?.emit("i18n:supported-changed", { languages: [...next], currentLanguage: this.currentLanguage });
  }

  translate(key, fallback = key, language = this.currentLanguage) {
    return this.locales.get(language)?.messages?.[key]
      ?? this.locales.get(this._firstSupported())?.messages?.[key]
      ?? fallback;
  }

  snapshot() {
    return { language: this.currentLanguage, supportedLanguages: [...this.supportedLanguages] };
  }

  restore(snapshot = {}) {
    if (Array.isArray(snapshot.supportedLanguages)) this.setSupportedLanguages(snapshot.supportedLanguages);
    if (snapshot.language) this.setLanguage(snapshot.language);
  }

  locale(id) {
    return clone(this.locales.get(String(id).toLowerCase()) || null);
  }
}

export const CORE_LOCALES = LOCALES;
export default I18nManager;
