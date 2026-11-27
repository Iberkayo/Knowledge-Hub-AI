// Persistent editorial audio player with queue, Media Session API, progress sync, and transcript sync.

import { icon } from "./icons.js";
import { getOfflineAudioUrl } from "./offline.js";

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export class PersistentPlayer {
  constructor({ onTimeUpdate, onQueueChange, onToast }) {
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.current = null;
    this.queue = [];
    this.browserSpeechActive = false;
    this.onTimeUpdate = onTimeUpdate || (() => {});
    this.onQueueChange = onQueueChange || (() => {});
    this.onToast = onToast || (() => {});
    this._lastSync = 0;

    this.bar = document.getElementById("playerBar");
    this.titleEl = document.getElementById("playerTitle");
    this.subEl = document.getElementById("playerSub");
    this.playBtn = document.getElementById("playerPlay");
    this.backBtn = document.getElementById("playerBack15");
    this.fwdBtn = document.getElementById("playerFwd30");
    this.seekEl = document.getElementById("playerSeek");
    this.curTimeEl = document.getElementById("playerCurrentTime");
    this.remTimeEl = document.getElementById("playerRemainingTime");
    this.speedEl = document.getElementById("playerSpeed");
    this.dlBtn = document.getElementById("playerDownload");
    this.closeBtn = document.getElementById("playerClose");

    this._bind();
    this._updatePlayIcon();
  }

  _bind() {
    this.playBtn.onclick = () => this.togglePlay();
    this.backBtn.onclick = () => this.seekBy(-15);
    this.fwdBtn.onclick = () => this.seekBy(30);
    this.seekEl.oninput = () => {
      if (this.audio.duration) {
        this.audio.currentTime = (Number(this.seekEl.value) / 1000) * this.audio.duration;
      }
    };
    this.speedEl.onchange = () => {
      this.audio.playbackRate = Number(this.speedEl.value);
    };
    this.dlBtn.onclick = () => {
      if (this.current?.id && !this.browserSpeechActive) {
        window.location.href = `/api/items/${this.current.id}/audio`;
      }
    };
    this.closeBtn.onclick = () => this.stop();

    this.audio.addEventListener("play", () => this._updatePlayIcon());
    this.audio.addEventListener("pause", () => {
      this._updatePlayIcon();
      this._syncProgress(true);
    });
    this.audio.addEventListener("ended", () => {
      this._syncProgress(true);
      this.playNextInQueue();
    });
    this.audio.addEventListener("timeupdate", () => {
      const cur = this.audio.currentTime || 0;
      const dur = this.audio.duration || this.current?.audio_duration_sec || 0;
      this.curTimeEl.textContent = formatTime(cur);
      this.remTimeEl.textContent = dur ? `-${formatTime(Math.max(0, dur - cur))}` : "0:00";
      if (dur > 0) {
        this.seekEl.value = String(Math.min(1000, Math.round((cur / dur) * 1000)));
      }
      this.onTimeUpdate(this.current?.id, cur, dur);
      const now = Date.now();
      if (now - this._lastSync > 5000) {
        this._lastSync = now;
        this._syncProgress(false);
      }
    });
  }

  _updatePlayIcon() {
    const isPaused = this.browserSpeechActive
      ? (!("speechSynthesis" in window) || speechSynthesis.paused || !speechSynthesis.speaking)
      : this.audio.paused;
    this.playBtn.replaceChildren(icon(isPaused ? "play" : "pause", 16));
    this.playBtn.setAttribute("aria-label", isPaused ? "Oynat" : "Duraklat");
    this.playBtn.setAttribute("title", isPaused ? "Oynat" : "Duraklat");
  }

  async _syncProgress(force) {
    if (!this.current?.id || this.browserSpeechActive) return;
    if (!force && this.audio.paused) return;
    try {
      await fetch(`/api/items/${this.current.id}/audio-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position_sec: this.audio.currentTime || 0,
          duration_sec: this.audio.duration || this.current.audio_duration_sec || 0,
        }),
      });
    } catch {
      // Offline or transient network error; ignore silently.
    }
  }

  _setupMediaSession(item) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title || "Knowledge Hub",
        artist: item.author || item.audio_provider || "Knowledge Hub",
        album: item.category || "Kütüphanem",
      });
      navigator.mediaSession.setActionHandler("play", () => this.audio.play().catch(() => {}));
      navigator.mediaSession.setActionHandler("pause", () => this.audio.pause());
      navigator.mediaSession.setActionHandler("seekbackward", () => this.seekBy(-15));
      navigator.mediaSession.setActionHandler("seekforward", () => this.seekBy(30));
    } catch {
      // MediaSession not supported in this context.
    }
  }

  async playItem(item, { preferOffline = true } = {}) {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.browserSpeechActive = false;
    this.current = item;
    this.bar.classList.remove("hidden");
    this.titleEl.textContent = item.title;
    this.subEl.textContent = `${item.author || item.kind} · ${item.audio_provider || "Ses"}`;
    this.dlBtn.disabled = false;

    let src = `/api/items/${item.id}/audio`;
    if (preferOffline) {
      try {
        const offlineUrl = await getOfflineAudioUrl(item.id);
        if (offlineUrl) src = offlineUrl;
      } catch {
        // fallback to server stream
      }
    }

    if (this.audio.src !== new URL(src, window.location.origin).href) {
      this.audio.src = src;
    }
    this.audio.playbackRate = Number(this.speedEl.value || 1);
    if (item.audio_position_sec && item.audio_position_sec > 2) {
      this.audio.currentTime = item.audio_position_sec;
    }
    this._setupMediaSession(item);
    try {
      await this.audio.play();
    } catch {
      this.onToast("Ses oynatmak için Oynat butonuna dokunun.");
    }
    this._updatePlayIcon();
  }

  playBrowserTTS(item, text) {
    if (!("speechSynthesis" in window)) {
      this.onToast("Tarayıcı seslendirmeyi desteklemiyor.");
      return;
    }
    this.audio.pause();
    speechSynthesis.cancel();
    this.browserSpeechActive = true;
    this.current = item;
    this.bar.classList.remove("hidden");
    this.titleEl.textContent = item.title;
    this.subEl.textContent = "Tarayıcı Türkçe Seslendirme";
    this.dlBtn.disabled = true;

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "tr-TR";
    utter.rate = Number(this.speedEl.value || 1);
    utter.onend = () => {
      this.browserSpeechActive = false;
      this._updatePlayIcon();
      this.playNextInQueue();
    };
    speechSynthesis.speak(utter);
    this._updatePlayIcon();
  }

  togglePlay() {
    if (this.browserSpeechActive && "speechSynthesis" in window) {
      if (speechSynthesis.paused) speechSynthesis.resume();
      else speechSynthesis.pause();
      this._updatePlayIcon();
      return;
    }
    if (!this.audio.src) return;
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  seekTo(seconds) {
    if (this.browserSpeechActive || !this.audio.src) return;
    this.audio.currentTime = Math.max(0, Number(seconds) || 0);
    if (this.audio.paused) this.audio.play().catch(() => {});
  }

  seekBy(delta) {
    if (this.browserSpeechActive || !this.audio.src) return;
    const dur = this.audio.duration || Infinity;
    this.audio.currentTime = Math.max(0, Math.min(dur, (this.audio.currentTime || 0) + delta));
  }

  enqueue(item) {
    if (!this.queue.some((q) => q.id === item.id)) {
      this.queue.push(item);
      this.onQueueChange(this.queue);
      this.onToast(`Kuyruğa eklendi: ${item.title}`);
    }
  }

  removeFromQueue(id) {
    this.queue = this.queue.filter((q) => q.id !== id);
    this.onQueueChange(this.queue);
  }

  playNextInQueue() {
    if (!this.queue.length) return;
    const next = this.queue.shift();
    this.onQueueChange(this.queue);
    if (next) this.playItem(next);
  }

  stop() {
    this.audio.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.browserSpeechActive = false;
    this.current = null;
    this.bar.classList.add("hidden");
    this._updatePlayIcon();
  }
}
