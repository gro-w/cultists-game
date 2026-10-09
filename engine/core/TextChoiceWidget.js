import { t } from "./i18n/index.js";
import { DisplayReceiverRegistry } from "./DisplayReceiverRegistry.js";
import { resolveAssetPath } from "./AssetPath.js";

/**
 * Generic text/choice display widget. It knows only the opaque display
 * receiver protocol; content packages decide the target and payload fields.
 */
export class TextChoiceWidget {
  constructor({ eventBus, variableStore, displayReceiverRegistry, displayTo = "default", displayAliases = [], keywordResolver = null, onKeywordCollect = null, portraitResolver = null, onEndingComplete = null } = {}) {
    this.eventBus = eventBus;
    this.variableStore = variableStore;
    this.displayTo = String(displayTo || "default").trim();
    this.displayAliases = (Array.isArray(displayAliases) ? displayAliases : [displayAliases])
      .map((target) => String(target || "").trim())
      .filter((target) => target && target !== this.displayTo);
    this.keywordResolver = keywordResolver;
    this.onKeywordCollect = onKeywordCollect;
    this.portraitResolver = portraitResolver;
    this.onEndingComplete = onEndingComplete;
    this.registry = displayReceiverRegistry || new DisplayReceiverRegistry();
    this._buildDom();
    this._receiver = { handle: (payload) => this._handle(payload) };
    this._receiverUnsubscribers = [this.registry.register(this.displayTo, this._receiver)];
    this.displayAliases.forEach((target) => this._receiverUnsubscribers.push(this.registry.register(target, this._receiver)));
    this._unsubscribe = () => this._receiverUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this._eventUnsubscribe = this.eventBus?.on?.("display:text", (payload) => this._handle({ ...payload, type: "text" }));
    this._choiceEventUnsubscribe = this.eventBus?.on?.("display:choice", (payload) => this._handle({ ...payload, type: "choice" }));
    this._mediaEventUnsubscribe = this.eventBus?.on?.("display:media", (payload) => this._handle({ ...payload, type: "media" }));
    this._mediaEndEventUnsubscribe = this.eventBus?.on?.("display:media-end", (payload) => this._handle({ ...payload, type: "media-end" }));
    this._completeEventUnsubscribe = this.eventBus?.on?.("display:complete", (payload) => this._onComplete(payload));
    this._replayResetUnsubscribe = this.eventBus?.on?.("display:reset", (payload) => {
      if (this._accepts(payload)) this.reset();
    });
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-dialogue-view";
    const portraits = this.displayTo === "ending-screen"
      ? '<div class="ng-ending-portraits"><div class="ng-ending-portrait ng-ending-portrait-player"></div><div class="ng-ending-portrait ng-ending-portrait-npc"></div></div>'
      : "";
    this.el.innerHTML = `${portraits}<div class="ng-dialogue-transcript"></div><div class="ng-dialogue-controls"></div>`;
    this.transcriptEl = this.el.querySelector(".ng-dialogue-transcript");
    this.controlsEl = this.el.querySelector(".ng-dialogue-controls");
  }

  _accepts(payload = {}) {
    const target = String(payload.displayTo || "default").trim() || "default";
    return target === this.displayTo || this.displayAliases.includes(target);
  }

  _handle(payload = {}) {
    if (!this._accepts(payload)) return;
    if (payload.type === "reset") this.reset();
    else if (payload.type === "text") this._onText(payload);
    else if (payload.type === "choice") this._onChoice(payload);
    else if (payload.type === "media") this._onMedia(payload);
    else if (payload.type === "media-end") this._onMediaEnd();
    else if (payload.type === "complete") this._onComplete(payload);
  }

  reset() {
    this.transcriptEl.replaceChildren();
    this.controlsEl.replaceChildren();
    this.el.classList.remove("has-content");
    this._lastEventKey = null;
    this._endingSessionKind = null;
  }

  addAliases(aliases = []) {
    for (const target of (Array.isArray(aliases) ? aliases : [aliases])) {
      const alias = String(target || "").trim();
      if (!alias || alias === this.displayTo || this.displayAliases.includes(alias)) continue;
      this.displayAliases.push(alias);
      this._receiverUnsubscribers.push(this.registry.register(alias, this._receiver));
    }
  }

  _onText(payload) {
    const eventKey = `text:${payload.instanceId || ""}:${payload.continueKey || ""}:${payload.text || ""}`;
    if (this._lastEventKey === eventKey) return;
    this._lastEventKey = eventKey;
    this._activeInstanceId = payload.instanceId || null;
    if (payload.sessionKind) this._endingSessionKind = payload.sessionKind;
    this.el.classList.add("has-content");
    if (this.displayTo === "ending-screen") this._updateEndingPortraits(payload.speaker);
    const line = document.createElement("p");
    line.className = "ng-dialogue-line";
    if (payload.speaker) {
      const speaker = document.createElement("span");
      speaker.className = "ng-dialogue-speaker";
      speaker.textContent = `${payload.speaker}：`;
      line.appendChild(speaker);
    }
    this._appendTextWithKeywords(line, payload.text, payload.keywordIds);
    // Ending dialogue is a single galgame line, not a running transcript.
    // Ordinary dialogue keeps its transcript history for activity replay.
    if (this.displayTo === "ending-screen") this.transcriptEl.replaceChildren();
    this.transcriptEl.appendChild(line);
    this.controlsEl.replaceChildren();
    if (payload.continueKey) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ng-dialogue-continue";
      button.textContent = t("legacy.1fc1afc5c55e");
      button.addEventListener("click", () => this.variableStore?.set(payload.continueKey, true));
      this.controlsEl.appendChild(button);
    }
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  _updateEndingPortraits(speaker) {
    const player = this.el.querySelector(".ng-ending-portrait-player");
    const npc = this.el.querySelector(".ng-ending-portrait-npc");
    const speakerText = String(speaker || "");
    if (!speakerText || speakerText.toLowerCase() === "narrator") return;
    const isPlayer = ["player", "主控"].includes(speakerText.toLowerCase());
    player?.classList.toggle("is-active", isPlayer);
    npc?.classList.toggle("is-active", !isPlayer && String(speaker || "") !== "narrator");
    const target = isPlayer ? player : npc;
    if (!target || target.dataset.speaker === speakerText) return;
    const imageData = this.portraitResolver?.(speaker);
    if (!imageData) return;
    const image = document.createElement("img");
    image.src = resolveAssetPath(imageData);
    image.alt = String(speaker || "角色");
    image.draggable = false;
    target.replaceChildren(image);
    target.dataset.loaded = "true";
    target.dataset.speaker = speakerText;
  }

  _appendTextWithKeywords(parent, text, keywordIds = []) {
    const source = String(text || "");
    const allowed = new Set(Array.isArray(keywordIds) ? keywordIds.map((id) => String(id)) : []);
    const marker = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let cursor = 0;
    let match;
    while ((match = marker.exec(source))) {
      if (match.index > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const id = String(match[1]).trim();
      const resolved = this.keywordResolver?.(id);
      const label = match[2] === undefined ? (resolved || id) : match[2];
      const keyword = document.createElement("span");
      keyword.className = "keyword-highlight";
      keyword.dataset.keywordId = id;
      keyword.title = id;
      if (allowed.size && !allowed.has(id)) keyword.classList.add("is-unlisted");
      keyword.textContent = label;
      keyword.addEventListener("click", () => {
        const result = this.onKeywordCollect?.(id);
        if (result !== undefined) keyword.classList.add("keyword-highlight-collected");
      });
      parent.appendChild(keyword);
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) parent.appendChild(document.createTextNode(source.slice(cursor)));
  }

  _onChoice(payload) {
    const eventKey = `choice:${payload.instanceId || ""}:${payload.selectionKey || ""}:${JSON.stringify(payload.options || [])}`;
    if (this._lastEventKey === eventKey) return;
    this._lastEventKey = eventKey;
    this._activeInstanceId = payload.instanceId || this._activeInstanceId;
    this.controlsEl.replaceChildren();
    const list = document.createElement("div");
    list.className = "ng-dialogue-choices";
    (payload.options || []).forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ng-dialogue-choice";
      button.textContent = option?.label ?? String(option);
      button.addEventListener("click", () => this.variableStore?.set(payload.selectionKey, index));
      list.appendChild(button);
    });
    this.controlsEl.appendChild(list);
  }

  _onMedia(payload = {}) {
    this.el.classList.add("has-media");
    this.el.querySelector(".ng-dialogue-media")?.remove();
    const media = document.createElement(payload.imageData ? "img" : "div");
    media.className = "ng-dialogue-media";
    if (payload.imageData) {
      media.src = resolveAssetPath(payload.imageData);
      media.alt = payload.cgId || payload.imageId || payload.mediaKind || "media";
    } else {
      media.textContent = `${t("legacy.a50e2b80c5ef")}${payload.cgId || payload.imageId || ""}`;
    }
    this.el.insertBefore(media, this.transcriptEl);
  }

  _onMediaEnd() {
    this.el.querySelector(".ng-dialogue-media")?.remove();
    this.el.classList.remove("has-media");
  }

  _onComplete(payload = {}) {
    if (!this._accepts(payload)) return;
    if (payload.instanceId && payload.instanceId !== this._activeInstanceId) return;
    this.controlsEl.replaceChildren();
    if (this.displayTo !== "ending-screen" || this._endingSessionKind !== "roommate") return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ng-dialogue-continue";
    button.textContent = t("legacy.1fc1afc5c55e");
    button.addEventListener("click", () => this.onEndingComplete?.());
    this.controlsEl.appendChild(button);
  }

  destroy() {
    this._unsubscribe?.();
    this._eventUnsubscribe?.();
    this._choiceEventUnsubscribe?.();
    this._mediaEventUnsubscribe?.();
    this._mediaEndEventUnsubscribe?.();
    this._completeEventUnsubscribe?.();
    this._replayResetUnsubscribe?.();
  }
}

export default TextChoiceWidget;
