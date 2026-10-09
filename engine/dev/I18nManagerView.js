// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { downloadTextFile } from "./devApi.js";

/** Developer editor for the core-supported language set and active language. */
export class I18nManagerView {
  constructor({ i18n } = {}) {
    this.i18n = i18n;
    this.el = document.createElement("div");
    this.el.className = "ng-i18n-manager";
    this.render();
  }

  render(status = "") {
    const locales = this.i18n.listLocales();
    this.el.innerHTML = `
      <h3>${this.i18n.translate("i18n.manager.title")}</h3>
      <label>${this.i18n.translate("i18n.manager.currentLanguage")}
        <select data-role="current"></select>
      </label>
      <fieldset><legend>${this.i18n.translate("i18n.manager.supportedLanguages")}</legend>
        <div data-role="languages"></div>
      </fieldset>
      <div class="ng-list-manager-toolbar">
        <button type="button" data-action="apply">${this.i18n.translate("i18n.manager.save")}</button>
        <button type="button" data-action="download">${t("legacy.06d9489bc31f")}</button>
        <span data-role="status">${status}</span>
      </div>`;
    const current = this.el.querySelector('[data-role="current"]');
    locales.filter((locale) => locale.supported).forEach((locale) => {
      const option = document.createElement("option");
      option.value = locale.id;
      option.textContent = `${locale.name} (${locale.id})`;
      option.selected = locale.id === this.i18n.getLanguage();
      current.appendChild(option);
    });
    const languages = this.el.querySelector('[data-role="languages"]');
    locales.forEach((locale) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" data-language="${locale.id}" ${locale.supported ? "checked" : ""}> ${locale.name} (${locale.id})`;
      languages.appendChild(label);
    });
    this.el.querySelector('[data-action="apply"]').addEventListener("click", () => {
      try {
        const ids = [...this.el.querySelectorAll("[data-language]:checked")].map((input) => input.dataset.language);
        this.i18n.setSupportedLanguages(ids);
        this.i18n.setLanguage(current.value);
        this.render(this.i18n.translate("i18n.manager.saved"));
      } catch (error) {
        this.render(error.message);
      }
    });
    const payload = () => `${JSON.stringify(this.i18n.snapshot(), null, 2)}\n`;
    this.el.querySelector('[data-action="download"]').addEventListener("click", () => downloadTextFile("i18n-settings.json", payload()));
  }
}

export default I18nManagerView;
// DEV-TOOLS:END
