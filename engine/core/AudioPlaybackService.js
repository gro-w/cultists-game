const DEFAULT_VOLUME = 100;

/** Generic core audio host. It knows tracks as opaque IDs and URLs, not game rules. */
export class AudioPlaybackService {
  constructor({ dataLoader, variableStore, baseUrl = typeof document !== "undefined" ? document.baseURI : "" } = {}) {
    this.dataLoader = dataLoader;
    this.variableStore = variableStore;
    this.baseUrl = baseUrl;
    this.tracks = new Map();
    this.audio = null;
    this.currentTrackId = null;
    this.layerStack = [];
  }

  async mount(trackDocument = "bgm.json") {
    if (typeof document !== "undefined" && !this.audio) {
      this.audio = document.createElement("audio");
      this.audio.loop = true;
      this.audio.dataset.ngRole = "audio-loop-player";
      document.body.appendChild(this.audio);
    }
    const data = await this.dataLoader.loadJSON(trackDocument, { optional: true }) || {};
    this.tracks = new Map((data.tracks || []).map((track) => [track.id, track]));
    this.setVolume(this.variableStore?.get("settings:bgmVolume") ?? DEFAULT_VOLUME);
    return this;
  }

  play(trackId) {
    if (trackId != null && !this.tracks.has(trackId)) throw new Error(`Unknown audio track: ${trackId}`);
    if (!this.audio) return { ok: false, reason: "not-mounted" };
    if (trackId === this.currentTrackId) return { ok: true, trackId };
    this.audio.pause();
    if (!trackId) {
      this.audio.removeAttribute("src");
      this.currentTrackId = null;
      return { ok: true, trackId: null };
    }
    this.audio.src = new URL(this.tracks.get(trackId).src, this.baseUrl).href;
    this.audio.load();
    this.audio.play().catch(() => {});
    this.currentTrackId = trackId;
    return { ok: true, trackId };
  }

  stop() { return this.play(null); }

  setVolume(volume) {
    const value = Math.max(0, Math.min(100, Number(volume) || 0));
    this.variableStore?.set("settings:bgmVolume", value);
    if (this.audio) this.audio.volume = value / 100;
    return value;
  }

  applyLayer(action, trackId = null) {
    if (action === "restore") this.layerStack.pop();
    else this.layerStack.push(action === "stop" ? null : trackId);
    return this.play(this.layerStack.length ? this.layerStack[this.layerStack.length - 1] : null);
  }
  snapshot() { return { currentTrackId: this.currentTrackId, layerStack: [...this.layerStack] }; }
  restore(snapshot = {}) { this.layerStack = Array.isArray(snapshot.layerStack) ? [...snapshot.layerStack] : []; return this.play(snapshot.currentTrackId || null); }
  destroy() { this.audio?.pause(); this.audio?.remove(); this.audio = null; }
}

export default AudioPlaybackService;
