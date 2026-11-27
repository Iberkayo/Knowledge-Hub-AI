// Knowledge Hub — Main SPA Controller (Editorial Library, Reader, Discover, Listen, Settings).

import { icon } from "./icons.js";
import { renderRichText } from "./render.js";
import { PersistentPlayer, formatTime } from "./player.js";
import { saveItemOffline, getOfflineItem, listOfflineItems, clearOfflineStore } from "./offline.js";

const state = {
  view: "library", // library | reader | discover | listen | settings
  items: [],
  activeItem: null,
  filter: "all",
  categoryFilter: "",
  search: "",
  readerTab: "tr", // tr | original | bilingual
  readerFontSize: 18.5,
  readerFontFamily: "serif", // serif | sans
  readerWidth: "medium", // narrow | medium | wide
  translationMode: "faithful",
  settingsTab: "translation", // translation | narration | whisper | glossary | system
  settings: {},
  secrets: {},
  sources: [],
  entries: [],
  discoverSourceId: "",
  discoverUnreadOnly: false,
  jobs: [],
  glossary: [],
  openrouterModels: [],
  elevenVoices: [],
  elevenModels: [],
  elevenSub: null,
  elevenWarning: "",
  systemInfo: null,
  listenItemId: null,
  offlineMode: false,
};

const viewRoot = document.getElementById("viewRoot");
const jobsBanner = document.getElementById("jobsBanner");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const toastEl = document.getElementById("toast");
const progressBar = document.getElementById("readingProgressBar");
const progressFill = document.getElementById("readingProgressFill");

function hydrateStaticIcons() {
  document.querySelectorAll("[data-icon]").forEach((slot) => {
    const name = slot.getAttribute("data-icon");
    if (name) slot.replaceChildren(icon(name, 16));
  });
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 3800);
}

async function api(path, { method = "GET", body, isForm = false } = {}) {
  const opts = { method };
  if (body !== undefined) {
    if (isForm) {
      opts.body = body;
    } else {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
  }
  let resp;
  try {
    resp = await fetch(path, opts);
  } catch {
    throw new Error("Yerel sunucuya (127.0.0.1:8000) ulaşılamıyor. Lütfen start.bat veya start.ps1 penceresinin açık olduğundan emin olun.");
  }
  if (!resp.ok) {
    let detail = `İşlem başarısız (${resp.status})`;
    try {
      const err = await resp.json();
      if (err?.detail) detail = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
    } catch {
      // keep generic
    }
    throw new Error(detail);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node[k.toLowerCase()] = v;
    else if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
  return node;
}

function openModal(title, contentNode) {
  modalTitle.textContent = title;
  modalBody.replaceChildren(contentNode);
  modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  modalBody.replaceChildren();
}

document.getElementById("modalCloseBtn").onclick = closeModal;
modalBackdrop.onclick = (e) => { if (e.target === modalBackdrop) closeModal(); };
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    closePopovers();
  }
});

function closePopovers() {
  document.querySelectorAll(".popover-menu").forEach((m) => m.classList.add("hidden"));
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".popover-anchor")) closePopovers();
});

// Reading scroll progress bar
function updateReadingProgress() {
  if (state.view !== "reader") {
    progressBar.classList.add("hidden");
    return;
  }
  progressBar.classList.remove("hidden");
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const pct = Math.max(0, Math.min(100, (window.scrollY / maxScroll) * 100));
  progressFill.style.width = `${pct.toFixed(1)}%`;
}
window.addEventListener("scroll", updateReadingProgress, { passive: true });

// Persistent Player
const player = new PersistentPlayer({
  onTimeUpdate: (itemId, currentSec) => {
    if (state.view === "listen" && state.listenItemId === itemId) {
      highlightActiveTranscriptLine(currentSec);
    }
  },
  onQueueChange: () => {
    if (state.view === "listen") renderCurrentView();
  },
  onToast: toast,
});

function highlightActiveTranscriptLine(currentSec) {
  const lines = document.querySelectorAll(".transcript-line[data-start]");
  for (const ln of lines) {
    const start = Number(ln.dataset.start);
    const end = Number(ln.dataset.end);
    ln.classList.toggle("active", currentSec >= start && currentSec < end);
  }
}

// Theme (warm paper light / warm graphite dark)
function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  const meta = document.getElementById("themeColorMeta");
  if (meta) meta.setAttribute("content", t === "dark" ? "#141311" : "#F8F5EF");
  const iconSlot = document.getElementById("themeToggleIcon");
  const labelSlot = document.getElementById("themeToggleLabel");
  if (iconSlot) iconSlot.replaceChildren(icon(t === "dark" ? "sun" : "moon", 15));
  if (labelSlot) labelSlot.textContent = t === "dark" ? "Kağıt Teması" : "Koyu Tema";
}

document.getElementById("themeToggleBtn").onclick = async () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    state.settings = await api("/api/settings", { method: "PATCH", body: { theme: next } });
  } catch {
    // ignore offline
  }
};

// Navigation
function setNav(view) {
  state.view = view;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === (view === "reader" ? "library" : view));
  });
  window.scrollTo({ top: 0, behavior: "instant" });
  renderCurrentView();
  updateReadingProgress();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.onclick = () => {
    const target = btn.dataset.nav;
    if (target === "discover") loadDiscover().then(() => setNav("discover"));
    else if (target === "settings") loadSettingsData().then(() => setNav("settings"));
    else if (target === "listen") loadLibrary().then(() => setNav("listen"));
    else loadLibrary().then(() => setNav("library"));
  };
});

document.getElementById("openAddModalBtn").onclick = () => showAddContentModal();

// Data loaders
async function loadLibrary() {
  try {
    state.items = await api("/api/items");
    state.offlineMode = false;
  } catch {
    state.offlineMode = true;
    try {
      state.items = await listOfflineItems();
      toast("Çevrimdışı mod: yerelde kayıtlı içerikler gösteriliyor.");
    } catch {
      state.items = [];
    }
  }
}

async function openReader(itemId) {
  try {
    state.activeItem = await api(`/api/items/${itemId}`);
  } catch {
    const cached = await getOfflineItem(itemId);
    if (!cached) {
      toast("İçerik çevrimdışı önbellekte bulunamadı.");
      return;
    }
    state.activeItem = cached;
  }
  const hasRealTr = Boolean(state.activeItem.translated && state.activeItem.mode !== "demo");
  state.readerTab = hasRealTr ? "tr" : "original";
  state.translationMode = state.activeItem.translation_mode || state.settings.default_translation_mode || "faithful";
  setNav("reader");
}

async function loadDiscover() {
  try {
    const [sources, entries] = await Promise.all([
      api("/api/sources"),
      api(`/api/discover/entries?unread_only=${state.discoverUnreadOnly ? "true" : "false"}${state.discoverSourceId ? `&source_id=${encodeURIComponent(state.discoverSourceId)}` : ""}`),
    ]);
    state.sources = sources;
    state.entries = entries;
  } catch (e) {
    toast(e.message);
  }
}

async function loadSettingsData() {
  try {
    const [settings, secrets, glossary, systemInfo, elevenModels] = await Promise.all([
      api("/api/settings"),
      api("/api/secrets/status"),
      api("/api/glossary"),
      api("/api/system/info"),
      api("/api/providers/elevenlabs/models"),
    ]);
    state.settings = settings;
    state.secrets = secrets;
    state.glossary = glossary;
    state.systemInfo = systemInfo;
    state.elevenModels = elevenModels;
    applyTheme(settings.theme || "light");
  } catch (e) {
    toast(e.message);
  }
}

// Live Job Polling
let jobPollTimer = null;
async function pollJobs() {
  try {
    const jobs = await api("/api/jobs");
    const prevRunning = new Set(state.jobs.filter((j) => j.status === "RUNNING" || j.status === "QUEUED").map((j) => j.id));
    state.jobs = jobs;
    const active = jobs.filter((j) => j.status === "RUNNING" || j.status === "QUEUED");
    renderJobsBanner(active);

    const justFinished = jobs.filter((j) => prevRunning.has(j.id) && (j.status === "COMPLETED" || j.status === "FAILED" || j.status === "CANCELLED"));
    if (justFinished.length) {
      for (const jf of justFinished) {
        if (jf.status === "COMPLETED") toast(`İşlem tamamlandı (${jf.job_type}).`);
        else if (jf.status === "FAILED") toast(`İşlem hatası: ${jf.error_message || "Bilinmeyen hata"}`);
      }
      await loadLibrary();
      if (state.view === "reader" && state.activeItem) {
        state.activeItem = await api(`/api/items/${state.activeItem.id}`).catch(() => state.activeItem);
        if (state.activeItem.translated && state.activeItem.mode !== "demo") state.readerTab = "tr";
      }
      renderCurrentView();
    }

    if (active.length) {
      jobPollTimer = setTimeout(pollJobs, 1500);
    } else {
      jobPollTimer = null;
    }
  } catch {
    jobPollTimer = null;
  }
}

function ensureJobPolling() {
  if (!jobPollTimer) pollJobs();
}

function renderJobsBanner(activeJobs) {
  if (!activeJobs.length) {
    jobsBanner.classList.add("hidden");
    jobsBanner.replaceChildren();
    return;
  }
  jobsBanner.classList.remove("hidden");
  jobsBanner.replaceChildren(
    ...activeJobs.map((j) => {
      const pct = Math.round((Number(j.progress) || 0) * 100);
      const segInfo = j.total_segments ? ` (${j.processed_segments}/${j.total_segments})` : "";
      const typeLabel = { translate: "Çeviri", narrate: "Seslendirme", transcribe: "Transkripsiyon" }[j.job_type] || j.job_type;
      return el(
        "div",
        { className: "job-row" },
        el("strong", {}, `${typeLabel} · ${j.stage}${segInfo}`),
        el("span", { className: "badge info" }, `${j.provider || "yerel"}${j.model ? ` / ${j.model}` : ""}`),
        el("div", { className: "progress-track" }, el("div", { className: "progress-fill", style: { width: `${pct}%` } })),
        el("span", { className: "tabular" }, `%${pct}`),
        el("button", {
          className: "btn-sm btn-danger",
          onclick: async () => {
            await api(`/api/jobs/${j.id}/cancel`, { method: "POST" });
            toast("İptal isteği gönderildi.");
            pollJobs();
          },
        }, "İptal")
      );
    })
  );
}

// =========================================================================
// ADD CONTENT MODAL
// =========================================================================
function showAddContentModal() {
  let tab = "url";
  const wrap = el("div");
  const tabs = el("div", { className: "segmented", style: { marginBottom: "16px" } });
  const body = el("div");

  function renderTab() {
    tabs.replaceChildren(
      ...[
        ["url", "link", "Makale URL"],
        ["file", "file", "Dosya / Ses"],
        ["paste", "alignLeft", "Metin Yapıştır"],
      ].map(([k, ic, label]) =>
        el("button", { className: tab === k ? "active" : "", onclick: () => { tab = k; renderTab(); } }, icon(ic, 14), label)
      )
    );
    body.replaceChildren();

    if (tab === "url") {
      const urlInput = el("input", { type: "url", placeholder: "https://hamel.dev/evals/" });
      const statusMsg = el("p", { className: "help-text" }, "Yalnızca erişim izniniz olan herkese açık HTTPS makale adreslerini girin. Başlık, yazar ve metin otomatik çıkarılır.");
      const submitBtn = el("button", {
        className: "btn-primary",
        onclick: async () => {
          if (!urlInput.value.trim()) return toast("Lütfen geçerli bir HTTPS adresi girin.");
          submitBtn.disabled = true;
          submitBtn.textContent = "Getiriliyor...";
          try {
            const item = await api("/api/import-url", { method: "POST", body: { url: urlInput.value.trim() } });
            closeModal();
            await loadLibrary();
            await openReader(item.id);
            toast("Makale kütüphaneye eklendi.");
          } catch (e) {
            toast(e.message);
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "Makaleyi Getir";
          }
        },
      }, "Makaleyi Getir");

      body.append(
        el("div", { className: "field", style: { marginBottom: "14px" } }, el("label", {}, "Makale Adresi (HTTPS)"), urlInput, statusMsg),
        el("div", { className: "actions-row" }, submitBtn)
      );
    } else if (tab === "file") {
      const fileInput = el("input", { type: "file", accept: ".txt,.md,.html,.htm,.pdf,.epub,.srt,.vtt,.mp3,.wav,.m4a,.ogg,.webm,.flac" });
      const titleInput = el("input", { placeholder: "İsteğe bağlı özel başlık" });
      const catInput = el("input", { placeholder: "Kategori (örn. ML, İstatistik, Podcast)" });
      const uploadBtn = el("button", {
        className: "btn-primary",
        onclick: async () => {
          const f = fileInput.files?.[0];
          if (!f) return toast("Lütfen bir dosya seçin.");
          const isAudio = /\.(mp3|wav|m4a|ogg|webm|flac)$/i.test(f.name);
          const fd = new FormData();
          fd.append("file", f);
          fd.append("title", titleInput.value.trim());
          fd.append("category", catInput.value.trim());
          uploadBtn.disabled = true;
          uploadBtn.textContent = "Yükleniyor...";
          try {
            const item = await api(isAudio ? "/api/upload/audio" : "/api/upload/document", { method: "POST", body: fd, isForm: true });
            closeModal();
            await loadLibrary();
            if (isAudio) {
              state.listenItemId = item.id;
              setNav("listen");
            } else {
              await openReader(item.id);
            }
            toast("Dosya başarıyla eklendi.");
          } catch (e) {
            toast(e.message);
          } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = "Yükle ve Ekle";
          }
        },
      }, "Yükle ve Ekle");

      body.append(
        el("div", { className: "field", style: { marginBottom: "12px" } }, el("label", {}, "Belge veya Ses Dosyası (TXT, HTML, PDF, EPUB, SRT/VTT, MP3/WAV/M4A)"), fileInput),
        el("div", { className: "form-grid", style: { marginBottom: "14px" } },
          el("div", { className: "field" }, el("label", {}, "Başlık"), titleInput),
          el("div", { className: "field" }, el("label", {}, "Kategori"), catInput)
        ),
        uploadBtn
      );
    } else {
      const titleInput = el("input", { placeholder: "İçerik başlığı" });
      const sourceInput = el("input", { placeholder: "Kaynak URL (isteğe bağlı)" });
      const kindSel = el("select", {},
        el("option", { value: "article" }, "Makale"),
        el("option", { value: "podcast" }, "Podcast"),
        el("option", { value: "document" }, "Belge")
      );
      const fmtSel = el("select", {},
        el("option", { value: "text" }, "Düz Metin / Markdown"),
        el("option", { value: "html" }, "HTML"),
        el("option", { value: "transcript" }, "SRT / VTT Transkript")
      );
      const contentTa = el("textarea", { placeholder: "Metni buraya yapıştırın...", style: { minHeight: "150px" } });
      const saveBtn = el("button", {
        className: "btn-primary",
        onclick: async () => {
          if (!titleInput.value.trim() || !contentTa.value.trim()) return toast("Başlık ve içerik zorunludur.");
          try {
            const item = await api("/api/items", {
              method: "POST",
              body: { title: titleInput.value.trim(), source: sourceInput.value.trim(), kind: kindSel.value, format: fmtSel.value, content: contentTa.value },
            });
            closeModal();
            await loadLibrary();
            await openReader(item.id);
            toast("İçerik kaydedildi.");
          } catch (e) {
            toast(e.message);
          }
        },
      }, "Kütüphaneye Kaydet");

      body.append(
        el("div", { className: "field", style: { marginBottom: "10px" } }, el("label", {}, "Başlık"), titleInput),
        el("div", { className: "field", style: { marginBottom: "10px" } }, el("label", {}, "Kaynak"), sourceInput),
        el("div", { className: "form-grid", style: { marginBottom: "10px" } },
          el("div", { className: "field" }, el("label", {}, "Tür"), kindSel),
          el("div", { className: "field" }, el("label", {}, "Biçim"), fmtSel)
        ),
        el("div", { className: "field", style: { marginBottom: "14px" } }, el("label", {}, "İçerik"), contentTa),
        saveBtn
      );
    }
  }

  renderTab();
  wrap.append(tabs, body);
  openModal("Yeni İçerik Ekle", wrap);
}

// =========================================================================
// TRANSLATION & NARRATION TRIGGERS
// =========================================================================
async function triggerTranslation(item, { mode = "faithful", force = false } = {}) {
  const provider = state.settings.translation_provider || "openrouter";
  const model = state.settings.translation_model || "openai/gpt-4o-mini";
  const keyMap = { openrouter: "openrouter_api_key", openai: "openai_api_key" };
  const needsKey = keyMap[provider] && !state.secrets[keyMap[provider]]?.configured;

  if (needsKey) {
    const msg = el("div", {},
      el("p", {}, `Seçili çeviri sağlayıcısı (${provider}) için API anahtarı henüz tanımlanmamış.`),
      el("p", { className: "help-text" }, "Gerçek Türkçe çeviri için Ayarlar sayfasından OpenRouter veya OpenAI API anahtarınızı ekleyebilirsiniz. Dilerseniz kredi harcamadan akışı Mock ile test edebilirsiniz."),
      el("div", { className: "actions-row", style: { marginTop: "16px" } },
        el("button", {
          className: "btn-primary",
          onclick: () => { closeModal(); state.settingsTab = "translation"; loadSettingsData().then(() => setNav("settings")); },
        }, icon("settings", 14), "Ayarlara Git"),
        el("button", {
          onclick: async () => {
            closeModal();
            try {
              await api(`/api/items/${item.id}/translate`, { method: "POST", body: { mode, provider: "mock", model: "mock-tr-v1", force, async_job: true } });
              toast("Mock test çevirisi başlatıldı.");
              ensureJobPolling();
            } catch (e) { toast(e.message); }
          },
        }, "Mock ile Akışı Test Et")
      )
    );
    openModal("Çeviri Sağlayıcısı Gerekli", msg);
    return;
  }

  try {
    await api(`/api/items/${item.id}/translate`, {
      method: "POST",
      body: { mode, provider, model, force, async_job: true },
    });
    toast("Türkçe çeviri kuyruğa alındı.");
    ensureJobPolling();
  } catch (e) {
    toast(e.message);
  }
}

async function triggerNarration(item) {
  if (item.audio_path && item.audio_status === "ready") {
    player.playItem(item);
    return;
  }

  const ttsProvider = state.settings.tts_provider || "supertonic";
  if (ttsProvider === "browser") {
    const text = item.translated || item.original;
    if (!text) return toast("Seslendirilecek metin yok.");
    player.playBrowserTTS(item, text);
    return;
  }

  try {
    const est = await api(`/api/items/${item.id}/narrate/estimate`, {
      method: "POST",
      body: { provider: ttsProvider },
    });
    const box = el("div", {},
      el("p", {}, `Sağlayıcı: ${est.provider} · Model: ${est.model || "varsayılan"}`),
      el("p", { className: "help-text" }, `Toplam parça: ${est.total_chunks} (Önbellekten: ${est.cached_chunks || 0}, Yeni: ${est.new_chunks ?? est.total_chunks})`),
      el("p", { className: "help-text" }, `Faturalanacak tahmini yeni karakter: ${est.new_characters_to_bill ?? 0} · Tahmini süre: ~${est.estimated_minutes || 1} dk`),
      el("div", { className: "actions-row", style: { marginTop: "16px" } },
        el("button", {
          className: "btn-primary",
          onclick: async () => {
            closeModal();
            try {
              await api(`/api/items/${item.id}/narrate`, { method: "POST", body: { provider: ttsProvider, async_job: true } });
              toast("Seslendirme başlatıldı.");
              ensureJobPolling();
            } catch (e) { toast(e.message); }
          },
        }, icon("headphones", 14), "Seslendirmeyi Başlat"),
        el("button", {
          onclick: () => {
            closeModal();
            player.playBrowserTTS(item, item.translated || item.original);
          },
        }, "Tarayıcı Sesiyle Dinle")
      )
    );
    openModal("Türkçe Seslendirme Onayı", box);
  } catch (e) {
    toast(e.message);
  }
}

// =========================================================================
// VIEW 1: LIBRARY (EDİTORYAL OKUMA LİSTESİ)
// =========================================================================
function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || "Yerel"; }
}

function getFilteredItems() {
  const q = state.search.trim().toLocaleLowerCase("tr");
  return state.items.filter((x) => {
    if (state.filter === "favorites" && !x.favorite) return false;
    if (state.filter === "unread" && x.is_read) return false;
    if (state.filter === "continue" && !(x.audio_position_sec > 5 || (x.position > 0.02 && x.position < 0.95))) return false;
    if (["article", "podcast", "document"].includes(state.filter) && x.kind !== state.filter) return false;
    if (state.categoryFilter && x.category !== state.categoryFilter) return false;
    if (q) {
      const hay = [x.title, x.author, x.category, x.source].join(" ").toLocaleLowerCase("tr");
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderLibraryListInto(container) {
  const filtered = getFilteredItems();
  if (!filtered.length) {
    container.replaceChildren(
      el("div", { className: "empty-state" },
        el("h3", {}, state.items.length ? "Eşleşen içerik bulunamadı" : "Kütüphaneniz henüz boş"),
        el("p", {}, "Bir makale adresi yapıştırarak, PDF/EPUB/ses dosyası yükleyerek veya Keşfet ekranından yayın ekleyerek başlayın."),
        el("button", { className: "btn-primary", onclick: () => showAddContentModal() }, icon("plus", 15), "İlk İçeriği Ekle")
      )
    );
    return;
  }

  const list = el("div", { className: "library-list" },
    ...filtered.map((item) => {
      const trDone = item.status === "processed" && item.mode !== "demo";
      const audioReady = item.audio_status === "ready" || Boolean(item.source_audio_path);
      const kindTr = { article: "Makale", podcast: "Podcast", document: "Belge" }[item.kind] || item.kind;
      const kickerParts = [kindTr, item.category].filter(Boolean).join(" · ");
      const metaParts = [
        item.author || null,
        getDomain(item.source),
        item.published_at ? String(item.published_at).slice(0, 10) : null,
        `${item.reading_minutes || 1} dk okuma`,
      ].filter(Boolean);

      return el("article", { className: "lib-row" },
        el("div", { className: "lib-row-main", onclick: () => openReader(item.id) },
          el("div", { className: "lib-kicker" },
            el("span", {}, kickerParts),
            trDone
              ? el("span", { className: "status-dot ok" }, "Türkçe hazır")
              : el("span", { className: "status-dot warn" }, "Çevrilmedi"),
            audioReady ? el("span", { className: "status-dot accent" }, "Ses hazır") : null
          ),
          el("h2", { className: "lib-title" }, item.title),
          el("div", { className: "lib-meta tabular" }, metaParts.join(" · "))
        ),
        el("div", { className: "lib-actions" },
          el("button", { className: "btn-sm", onclick: () => openReader(item.id) }, "Oku"),
          !trDone
            ? el("button", { className: "btn-ghost btn-sm", onclick: () => triggerTranslation(item) }, icon("translate", 14), "Çevir")
            : null,
          el("button", {
            className: "btn-ghost btn-icon-only",
            title: audioReady ? "Dinle" : "Seslendir ve Dinle",
            "aria-label": "Dinle",
            onclick: () => triggerNarration(item),
          }, icon("headphones", 16)),
          el("button", {
            className: `btn-ghost btn-icon-only ${item.favorite ? "starred" : ""}`,
            title: item.favorite ? "Favorilerden çıkar" : "Favorilere ekle",
            "aria-label": "Favori",
            onclick: async () => {
              await api(`/api/items/${item.id}/metadata`, {
                method: "PATCH",
                body: { favorite: !item.favorite, notes: item.notes || "", category: item.category || "" },
              });
              await loadLibrary();
              renderLibraryListInto(container);
            },
          }, icon(item.favorite ? "starFilled" : "star", 16))
        )
      );
    })
  );

  container.replaceChildren(list);
}

function renderLibrary() {
  const categories = [...new Set(state.items.map((x) => x.category).filter(Boolean))].sort();
  const listHost = el("div", { id: "libraryList" });

  const topbar = el("div", { className: "topbar" },
    el("div", {},
      el("h1", { className: "page-title" }, "Kütüphanem"),
      el("p", { className: "page-subtitle tabular" }, `${state.items.length} kayıtlı içerik${state.offlineMode ? " · Çevrimdışı mod" : ""}`)
    ),
    el("div", { className: "actions-row" },
      el("button", { className: "btn-primary", onclick: () => showAddContentModal() }, icon("plus", 15), "İçerik Ekle")
    )
  );

  const searchInput = el("input", {
    className: "search-box",
    placeholder: "Başlık, yazar veya kaynak ara...",
    value: state.search,
    oninput: (e) => {
      state.search = e.target.value;
      renderLibraryListInto(listHost);
    },
  });

  const catSel = el("select", {
    style: { width: "auto", minWidth: "156px" },
    onchange: (e) => {
      state.categoryFilter = e.target.value;
      renderLibraryListInto(listHost);
    },
  },
    el("option", { value: "" }, "Tüm Kategoriler"),
    ...categories.map((c) => el("option", { value: c, ...(state.categoryFilter === c ? { selected: "selected" } : {}) }, c))
  );

  const filterDefs = [
    ["all", "Tümü"],
    ["unread", "Okunmamış"],
    ["continue", "Devam Et"],
    ["favorites", "Favoriler"],
    ["article", "Makaleler"],
    ["podcast", "Podcast"],
    ["document", "Belgeler"],
  ];

  const filterStrip = el("div", { className: "filter-strip" });
  function renderFilters() {
    filterStrip.replaceChildren(
      ...filterDefs.map(([k, label]) =>
        el("button", {
          className: `chip ${state.filter === k ? "active" : ""}`,
          onclick: () => {
            state.filter = k;
            renderFilters();
            renderLibraryListInto(listHost);
          },
        }, label)
      )
    );
  }
  renderFilters();

  const toolbar = el("div", { className: "toolbar" },
    el("div", { className: "toolbar-top" },
      el("div", { className: "search-wrap" },
        el("span", { className: "search-icon" }, icon("search", 15)),
        searchInput
      ),
      categories.length ? catSel : null
    ),
    filterStrip
  );

  renderLibraryListInto(listHost);
  viewRoot.replaceChildren(topbar, toolbar, listHost);
}

// =========================================================================
// VIEW 2: READER (DİKKAT DAĞITMAYAN EDİTORYAL OKUYUCU)
// =========================================================================
function renderReader() {
  const item = state.activeItem;
  if (!item) { setNav("library"); return; }

  const hasTr = Boolean(item.translated);

  const viewSwitcher = el("div", { className: "segmented" },
    ...[["tr", "Türkçe"], ["bilingual", "İki Dilli"], ["original", "Orijinal"]].map(([k, label]) =>
      el("button", {
        className: state.readerTab === k ? "active" : "",
        onclick: () => { state.readerTab = k; renderCurrentView(); },
      }, label)
    )
  );

  // Typography (Aa) Popover
  const typoMenu = el("div", { className: "popover-menu hidden" },
    el("div", {},
      el("div", { className: "popover-label" }, "Tema"),
      el("div", { className: "segmented", style: { width: "100%" } },
        el("button", {
          style: { flex: 1 },
          className: document.documentElement.getAttribute("data-theme") !== "dark" ? "active" : "",
          onclick: async () => {
            applyTheme("light");
            api("/api/settings", { method: "PATCH", body: { theme: "light" } }).catch(() => {});
            renderCurrentView();
          },
        }, "Kağıt"),
        el("button", {
          style: { flex: 1 },
          className: document.documentElement.getAttribute("data-theme") === "dark" ? "active" : "",
          onclick: async () => {
            applyTheme("dark");
            api("/api/settings", { method: "PATCH", body: { theme: "dark" } }).catch(() => {});
            renderCurrentView();
          },
        }, "Koyu")
      )
    ),
    el("div", {},
      el("div", { className: "popover-label" }, "Yazı Tipi"),
      el("div", { className: "segmented", style: { width: "100%" } },
        el("button", {
          style: { flex: 1 },
          className: state.readerFontFamily === "serif" ? "active" : "",
          onclick: () => { state.readerFontFamily = "serif"; renderCurrentView(); },
        }, "Serif"),
        el("button", {
          style: { flex: 1 },
          className: state.readerFontFamily === "sans" ? "active" : "",
          onclick: () => { state.readerFontFamily = "sans"; renderCurrentView(); },
        }, "Sans")
      )
    ),
    el("div", {},
      el("div", { className: "popover-label" }, `Boyut (${Math.round(state.readerFontSize)} px)`),
      el("div", { className: "actions-row" },
        el("button", {
          className: "btn-sm",
          style: { flex: 1 },
          onclick: () => { state.readerFontSize = Math.max(14, state.readerFontSize - 1.5); renderCurrentView(); },
        }, "A−"),
        el("button", {
          className: "btn-sm",
          style: { flex: 1 },
          onclick: () => { state.readerFontSize = Math.min(26, state.readerFontSize + 1.5); renderCurrentView(); },
        }, "A+")
      )
    ),
    el("div", {},
      el("div", { className: "popover-label" }, "Satır Genişliği"),
      el("div", { className: "segmented", style: { width: "100%" } },
        ...[["narrow", "Dar"], ["medium", "Orta"], ["wide", "Geniş"]].map(([w, lbl]) =>
          el("button", {
            style: { flex: 1 },
            className: state.readerWidth === w ? "active" : "",
            onclick: () => { state.readerWidth = w; renderCurrentView(); },
          }, lbl)
        )
      )
    ),
    el("div", {},
      el("div", { className: "popover-label" }, "Çeviri Modu"),
      el("select", {
        onchange: (e) => { state.translationMode = e.target.value; },
      },
        el("option", { value: "faithful", ...(state.translationMode === "faithful" ? { selected: "selected" } : {}) }, "Tam Çeviri (Sadık)"),
        el("option", { value: "explained", ...(state.translationMode === "explained" ? { selected: "selected" } : {}) }, "Açıklamalı Anlatım"),
        el("option", { value: "summary", ...(state.translationMode === "summary" ? { selected: "selected" } : {}) }, "Özet Modu")
      )
    )
  );

  const typoAnchor = el("div", { className: "popover-anchor" },
    el("button", {
      className: "btn-ghost btn-sm",
      title: "Görünüm ve çeviri modu",
      onclick: (e) => {
        e.stopPropagation();
        const wasHidden = typoMenu.classList.contains("hidden");
        closePopovers();
        if (wasHidden) typoMenu.classList.remove("hidden");
      },
    }, icon("type", 15), "Aa"),
    typoMenu
  );

  // More (...) Popover
  const moreMenu = el("div", { className: "popover-menu hidden" },
    el("button", {
      className: "menu-item",
      onclick: async () => {
        closePopovers();
        try {
          let blob = null;
          if (item.audio_path) {
            const r = await fetch(`/api/items/${item.id}/audio`);
            if (r.ok) blob = await r.blob();
          }
          await saveItemOffline(item, blob);
          toast("Çevrimdışı erişim için tarayıcıya kaydedildi.");
        } catch (e) { toast(e.message); }
      },
    }, icon("cloudDown", 15), "Çevrimdışı Kaydet"),
    el("button", {
      className: "menu-item",
      onclick: () => { closePopovers(); window.location.href = `/api/items/${item.id}/export?format=md`; },
    }, icon("download", 15), "Markdown İndir"),
    el("button", {
      className: "menu-item",
      onclick: () => { closePopovers(); window.location.href = `/api/items/${item.id}/export?format=txt`; },
    }, icon("download", 15), "Düz Metin İndir"),
    el("button", {
      className: "menu-item danger",
      onclick: async () => {
        closePopovers();
        if (!confirm("Bu içerik ve ilişkili ses dosyaları kalıcı olarak silinsin mi?")) return;
        await api(`/api/items/${item.id}`, { method: "DELETE" });
        state.activeItem = null;
        await loadLibrary();
        setNav("library");
        toast("İçerik silindi.");
      },
    }, icon("trash", 15), "İçeriği Sil")
  );

  const moreAnchor = el("div", { className: "popover-anchor" },
    el("button", {
      className: "btn-ghost btn-icon-only",
      title: "Diğer işlemler",
      "aria-label": "Diğer işlemler",
      onclick: (e) => {
        e.stopPropagation();
        const wasHidden = moreMenu.classList.contains("hidden");
        closePopovers();
        if (wasHidden) moreMenu.classList.remove("hidden");
      },
    }, icon("more", 16)),
    moreMenu
  );

  const toolbar = el("div", { className: "reader-bar" },
    el("div", { className: "actions-row" },
      el("button", {
        className: "btn-ghost btn-sm",
        onclick: () => loadLibrary().then(() => setNav("library")),
      }, icon("arrowLeft", 15), "Kütüphane")
    ),
    viewSwitcher,
    el("div", { className: "actions-row" },
      el("button", {
        className: "btn-sm",
        onclick: () => triggerNarration(item),
      }, icon("headphones", 14), "Dinle"),
      el("button", {
        className: hasTr ? "btn-sm" : "btn-primary btn-sm",
        onclick: () => triggerTranslation(item, { mode: state.translationMode, force: hasTr }),
      }, icon("translate", 14), hasTr ? "Yeniden Çevir" : "Çevir"),
      typoAnchor,
      moreAnchor
    )
  );

  const canvas = el("article", { className: `reader-canvas width-${state.readerWidth}` });
  const header = el("header", { className: "reader-header" },
    el("h1", {}, item.title),
    el("div", { className: "reader-byline tabular" },
      item.author ? el("span", {}, item.author) : null,
      item.published_at ? el("span", {}, String(item.published_at).slice(0, 10)) : null,
      item.source && item.source.startsWith("https://")
        ? el("a", { href: item.source, target: "_blank", rel: "noopener noreferrer" }, getDomain(item.source))
        : el("span", {}, item.source || "Yerel"),
      el("span", {}, `${item.reading_minutes || 1} dk okuma`),
      item.translation_model ? el("span", { className: "badge" }, `${item.translation_provider} / ${item.translation_model}`) : null,
      item.mode === "mock" ? el("span", { className: "badge warn" }, "Mock Çıktısı") : null
    )
  );

  const bodyContainer = el("div", {
    className: `reader-body ${state.readerFontFamily === "sans" ? "font-sans" : ""}`,
    style: { "--reader-font-size": `${state.readerFontSize}px` },
  });

  if (state.readerTab === "tr") {
    if (!hasTr) {
      bodyContainer.append(
        el("div", { className: "empty-state" },
          el("h3", {}, "Bu içerik henüz Türkçeye çevrilmedi"),
          el("p", {}, "Sağ üstten çeviri modunu seçip Türkçeye Çevir ile başlayabilirsiniz."),
          el("button", {
            className: "btn-primary",
            onclick: () => triggerTranslation(item, { mode: state.translationMode }),
          }, icon("translate", 15), "Türkçeye Çevir")
        )
      );
    } else {
      renderRichText(bodyContainer, item.translated);
    }
  } else if (state.readerTab === "original") {
    renderRichText(bodyContainer, item.original);
  } else {
    const segs = item.segments || [];
    if (segs.length) {
      for (const s of segs) {
        const left = el("div");
        const right = el("div");
        renderRichText(left, s.original_text || "");
        renderRichText(right, s.translated_text || "(Henüz çevrilmedi)");
        let warns = [];
        try { warns = JSON.parse(s.warnings_json || "[]"); } catch { warns = []; }
        if (warns.length) {
          right.append(el("div", { className: "seg-warn" }, `QA uyarısı: ${warns.join(", ")}`));
        }
        bodyContainer.append(el("div", { className: "bilingual-row" }, left, right));
      }
    } else {
      const left = el("div");
      const right = el("div");
      renderRichText(left, item.original);
      renderRichText(right, item.translated || "(Henüz çevrilmedi)");
      bodyContainer.append(el("div", { className: "bilingual-row" }, left, right));
    }
  }

  canvas.append(header, bodyContainer);

  // Quiet Collapsible Notes & Highlights Footer
  let highlights = [];
  try { highlights = JSON.parse(item.highlights_json || "[]"); } catch { highlights = []; }

  const progressRange = el("input", {
    type: "range",
    min: "0",
    max: "1",
    step: "0.01",
    value: String(item.position || 0),
    onchange: async (e) => {
      const updated = await api(`/api/items/${item.id}/progress`, { method: "PATCH", body: { position: Number(e.target.value) } });
      state.activeItem = updated;
      toast(`Okuma ilerlemesi %${Math.round(updated.position * 100)} kaydedildi.`);
    },
  });

  const favChk = el("input", { type: "checkbox", ...(item.favorite ? { checked: "checked" } : {}) });
  const catIn = el("input", { value: item.category || "", placeholder: "Kategori" });
  const notesTa = el("textarea", { placeholder: "Bu makaleyle ilgili kişisel notlarınız..." });
  notesTa.value = item.notes || "";

  const notesFooter = el("details", { className: "reader-notes-section", ...(highlights.length || item.notes ? { open: "open" } : {}) },
    el("summary", {},
      el("span", {}, `Notlar ve Vurgular${highlights.length ? ` (${highlights.length})` : ""}`),
      el("span", { className: "help-text", style: { margin: 0 } }, `İlerleme %${Math.round((item.position || 0) * 100)}`)
    ),
    el("div", { className: "reader-notes-body" },
      el("div", { className: "actions-row" },
        el("button", {
          className: "btn-sm",
          onclick: async () => {
            const sel = window.getSelection()?.toString().trim();
            if (!sel) return toast("Vurgulamak için önce metinden bir bölüm seçin.");
            highlights.push({ text: sel.slice(0, 600), created_at: new Date().toISOString() });
            state.activeItem = await api(`/api/items/${item.id}/metadata`, {
              method: "PATCH",
              body: { favorite: favChk.checked, notes: notesTa.value, category: catIn.value, highlights },
            });
            renderCurrentView();
            toast("Vurgu kaydedildi.");
          },
        }, icon("highlighter", 14), "Seçili Metni Vurgula")
      ),
      highlights.length
        ? el("div", {},
            ...highlights.map((h, idx) =>
              el("div", { className: "highlight-chip" },
                el("span", {}, `“${h.text}”`),
                el("button", {
                  className: "btn-ghost btn-icon-only",
                  "aria-label": "Vurguyu kaldır",
                  onclick: async () => {
                    highlights.splice(idx, 1);
                    state.activeItem = await api(`/api/items/${item.id}/metadata`, {
                      method: "PATCH",
                      body: { favorite: favChk.checked, notes: notesTa.value, category: catIn.value, highlights },
                    });
                    renderCurrentView();
                  },
                }, icon("x", 14))
              )
            )
          )
        : null,
      el("div", { className: "field" }, el("label", {}, "Okuma İlerlemesi"), progressRange),
      el("div", { className: "form-grid" },
        el("div", { className: "field" }, el("label", {}, "Kategori"), catIn),
        el("div", { className: "field" }, el("label", { className: "inline-check", style: { marginTop: "26px" } }, favChk, "Favorilere Ekle"))
      ),
      el("div", { className: "field" }, el("label", {}, "Kişisel Notlar"), notesTa),
      el("div", { className: "actions-row" },
        el("button", {
          className: "btn-primary btn-sm",
          onclick: async () => {
            state.activeItem = await api(`/api/items/${item.id}/metadata`, {
              method: "PATCH",
              body: { favorite: favChk.checked, notes: notesTa.value, category: catIn.value, highlights },
            });
            toast("Notlar kaydedildi.");
          },
        }, "Notları Kaydet")
      )
    )
  );

  viewRoot.replaceChildren(el("div", { className: "reader-shell" }, toolbar, canvas, notesFooter));
  updateReadingProgress();
}

// =========================================================================
// VIEW 3: DISCOVER (KEŞFET & RSS)
// =========================================================================
function renderDiscover() {
  const topbar = el("div", { className: "topbar" },
    el("div", {},
      el("h1", { className: "page-title" }, "Keşfet"),
      el("p", { className: "page-subtitle" }, "Takip edilen araştırmacı blogları ve podcast beslemeleri. Otomatik ücretli çeviri yapılmaz.")
    ),
    el("div", { className: "actions-row" },
      el("button", {
        onclick: async () => {
          toast("Kaynaklar yenileniyor...");
          try {
            const res = await api("/api/sources/refresh-all", { method: "POST" });
            const okCount = res.filter((r) => r.ok).length;
            toast(`${okCount}/${res.length} kaynak güncellendi.`);
            await loadDiscover();
            renderCurrentView();
          } catch (e) { toast(e.message); }
        },
      }, icon("refresh", 14), "Tümünü Yenile"),
      el("button", { className: "btn-primary", onclick: () => showAddSourceModal() }, icon("plus", 15), "RSS Ekle")
    )
  );

  const sourceChips = el("div", { className: "filter-strip", style: { marginBottom: "18px" } },
    el("button", {
      className: `chip ${!state.discoverSourceId ? "active" : ""}`,
      onclick: () => { state.discoverSourceId = ""; loadDiscover().then(renderCurrentView); },
    }, "Tüm Kaynaklar"),
    ...state.sources.map((s) =>
      el("button", {
        className: `chip ${state.discoverSourceId === s.id ? "active" : ""}`,
        onclick: () => { state.discoverSourceId = s.id; loadDiscover().then(renderCurrentView); },
      }, `${s.name}${s.unread_count ? ` (${s.unread_count})` : ""}`)
    )
  );

  const unreadToggle = el("label", { className: "inline-check" },
    el("input", {
      type: "checkbox",
      ...(state.discoverUnreadOnly ? { checked: "checked" } : {}),
      onchange: (e) => { state.discoverUnreadOnly = e.target.checked; loadDiscover().then(renderCurrentView); },
    }),
    "Yalnızca okunmamışlar"
  );

  const entriesPanel = el("section", { className: "panel" },
    el("div", { className: "topbar", style: { marginBottom: "12px" } },
      el("h2", { style: { margin: 0 } }, `Yayınlar (${state.entries.length})`),
      unreadToggle
    ),
    !state.entries.length
      ? el("p", { className: "help-text" }, "Henüz yayın çekilmedi. 'Tümünü Yenile' ile takip ettiğiniz kaynakları güncelleyin.")
      : el("div", {},
          ...state.entries.map((entry) =>
            el("div", { className: "list-row" },
              el("div", { style: { flex: "1 1 320px", minWidth: 0 } },
                el("div", { style: { fontWeight: entry.is_read ? 500 : 600, fontSize: "15px" } }, entry.title),
                el("div", { className: "help-text tabular" }, `${entry.source_name}${entry.published_at ? ` · ${entry.published_at.slice(0, 10)}` : ""}`),
                entry.summary ? el("p", { className: "help-text", style: { margin: "4px 0 0" } }, entry.summary.slice(0, 180)) : null
              ),
              el("div", { className: "actions-row" },
                entry.imported_item_id
                  ? el("button", { className: "btn-sm", onclick: () => openReader(entry.imported_item_id) }, "Aç")
                  : el("button", {
                      className: "btn-primary btn-sm",
                      onclick: async () => {
                        try {
                          const item = await api(`/api/discover/entries/${entry.id}/import`, { method: "POST" });
                          toast("Kütüphaneye eklendi.");
                          await loadLibrary();
                          await loadDiscover();
                          await openReader(item.id);
                        } catch (e) { toast(e.message); }
                      },
                    }, icon("plus", 14), "Kaydet"),
                el("button", {
                  className: "btn-ghost btn-sm",
                  onclick: async () => {
                    await api(`/api/discover/entries/${entry.id}`, { method: "PATCH", body: { is_read: !entry.is_read } });
                    await loadDiscover();
                    renderCurrentView();
                  },
                }, entry.is_read ? "Okunmadı" : "Okundu")
              )
            )
          )
        )
  );

  const sourcesPanel = el("details", { className: "panel" },
    el("summary", { style: { cursor: "pointer", fontWeight: 600, fontSize: "15px" } }, `Kaynakları Yönet (${state.sources.length})`),
    el("div", { style: { marginTop: "12px" } },
      ...state.sources.filter((s) => !state.discoverSourceId || s.id === state.discoverSourceId).map((s) =>
        el("div", { className: "list-row" },
          el("div", {},
            el("strong", {}, s.name),
            el("span", { className: "badge", style: { marginLeft: "8px" } }, s.category || s.kind),
            el("div", { className: "help-text" }, `${s.url} · Son kontrol: ${s.last_checked_at ? s.last_checked_at.slice(0, 16).replace("T", " ") : "Henüz yok"}`)
          ),
          el("div", { className: "actions-row" },
            el("button", {
              className: "btn-sm",
              onclick: async () => {
                try {
                  const r = await api(`/api/sources/${s.id}/refresh`, { method: "POST" });
                  toast(`${s.name}: ${r.added} yeni yayın eklendi.`);
                  await loadDiscover();
                  renderCurrentView();
                } catch (e) { toast(e.message); }
              },
            }, icon("refresh", 13), "Yenile"),
            el("button", {
              className: "btn-ghost btn-sm",
              onclick: async () => {
                await api(`/api/sources/${s.id}`, { method: "DELETE" });
                if (state.discoverSourceId === s.id) state.discoverSourceId = "";
                await loadDiscover();
                renderCurrentView();
              },
            }, "Kaldır")
          )
        )
      )
    )
  );

  viewRoot.replaceChildren(topbar, sourceChips, entriesPanel, sourcesPanel);
}

function showAddSourceModal() {
  const nameIn = el("input", { placeholder: "Örn. Anthropic Research" });
  const urlIn = el("input", { type: "url", placeholder: "https://.../rss.xml" });
  const catIn = el("input", { value: "Özel", placeholder: "Kategori" });
  const kindSel = el("select", {}, el("option", { value: "article" }, "Blog / Makale"), el("option", { value: "podcast" }, "Podcast"));
  const saveBtn = el("button", {
    className: "btn-primary",
    onclick: async () => {
      try {
        await api("/api/sources", { method: "POST", body: { name: nameIn.value.trim(), url: urlIn.value.trim(), category: catIn.value.trim(), kind: kindSel.value } });
        closeModal();
        await loadDiscover();
        renderCurrentView();
        toast("RSS kaynağı eklendi.");
      } catch (e) { toast(e.message); }
    },
  }, "Kaynağı Ekle");

  openModal("Yeni RSS / Atom Kaynağı", el("div", {},
    el("div", { className: "field", style: { marginBottom: "10px" } }, el("label", {}, "Kaynak Adı"), nameIn),
    el("div", { className: "field", style: { marginBottom: "10px" } }, el("label", {}, "HTTPS RSS/Atom URL"), urlIn),
    el("div", { className: "form-grid", style: { marginBottom: "14px" } },
      el("div", { className: "field" }, el("label", {}, "Kategori"), catIn),
      el("div", { className: "field" }, el("label", {}, "Tür"), kindSel)
    ),
    saveBtn
  ));
}

// =========================================================================
// VIEW 4: LISTEN (DİNLE & PODCAST MERKEZİ)
// =========================================================================
function renderListen() {
  const audioItems = state.items.filter((x) => x.kind === "podcast" || x.audio_status === "ready" || x.source_audio_path || x.translated);
  const selected = state.items.find((x) => x.id === state.listenItemId) || audioItems[0] || null;
  if (selected && !state.listenItemId) state.listenItemId = selected.id;

  const topbar = el("div", { className: "topbar" },
    el("div", {},
      el("h1", { className: "page-title" }, "Dinle"),
      el("p", { className: "page-subtitle" }, "Çevrilmiş makaleleri yerel Türkçe sesle dinleyin veya podcast dosyalarını Faster-Whisper ile transkribe edin.")
    ),
    el("button", { className: "btn-primary", onclick: () => showAddContentModal() }, icon("plus", 15), "Ses / Podcast Yükle")
  );

  const listPanel = el("section", { className: "panel" },
    el("h2", {}, `Sesli İçerikler (${audioItems.length})`),
    !audioItems.length
      ? el("p", { className: "help-text" }, "Henüz sesli içerik yok. Yeni bir makale ekleyin veya MP3/WAV/M4A dosyası yükleyin.")
      : el("div", {},
          ...audioItems.map((it) =>
            el("div", { className: "list-row" },
              el("div", {
                style: { cursor: "pointer", flex: "1 1 260px", minWidth: 0 },
                onclick: async () => { state.listenItemId = it.id; state.activeItem = await api(`/api/items/${it.id}`).catch(() => it); renderCurrentView(); },
              },
                el("div", { style: { fontWeight: 600 } }, it.title),
                el("div", { className: "help-text" }, `${it.kind === "podcast" ? "Podcast" : "Makale"} · ${it.audio_status === "ready" ? "Ses hazır" : it.source_audio_path ? "Kaynak ses yüklü" : "Seslendirmeye hazır"}`)
              ),
              el("div", { className: "actions-row" },
                el("button", { className: "btn-primary btn-sm", onclick: () => triggerNarration(it) }, icon("play", 13), "Dinle"),
                el("button", { className: "btn-sm", onclick: () => player.enqueue(it) }, icon("queue", 14), "Sıraya Ekle"),
                it.source_audio_path
                  ? el("button", {
                      className: "btn-sm",
                      onclick: async () => {
                        try {
                          await api(`/api/items/${it.id}/transcribe`, { method: "POST", body: { async_job: true } });
                          toast("Faster-Whisper transkripsiyonu başlatıldı.");
                          ensureJobPolling();
                        } catch (e) { toast(e.message); }
                      },
                    }, icon("mic", 14), "Transkribe Et")
                  : null
              )
            )
          )
        )
  );

  const queuePanel = player.queue.length
    ? el("section", { className: "panel" },
        el("h2", {}, `Dinleme Kuyruğu (${player.queue.length})`),
        ...player.queue.map((q) =>
          el("div", { className: "list-row" },
            el("span", {}, q.title),
            el("button", { className: "btn-ghost btn-sm", onclick: () => player.removeFromQueue(q.id) }, "Çıkar")
          )
        )
      )
    : null;

  let transcriptPanel = null;
  if (selected) {
    let segs = [];
    try { segs = JSON.parse(selected.transcript_json || "[]"); } catch { segs = []; }
    transcriptPanel = el("section", { className: "panel" },
      el("div", { className: "topbar", style: { marginBottom: "10px" } },
        el("h2", { style: { margin: 0 } }, `Zaman Damgalı Transkript — ${selected.title}`),
        el("button", { className: "btn-sm", onclick: () => openReader(selected.id) }, "Okuyucuda Aç")
      ),
      !segs.length
        ? el("p", { className: "help-text" }, "Bu içerik için zaman damgalı transkript henüz oluşturulmamış.")
        : el("div", {},
            ...segs.map((s) =>
              el("div", {
                className: "transcript-line",
                "data-start": s.start,
                "data-end": s.end,
                onclick: () => player.seekTo(s.start),
              },
                el("span", { className: "transcript-ts" }, formatTime(s.start)),
                el("span", {}, s.text)
              )
            )
          )
    );
  }

  viewRoot.replaceChildren(topbar, listPanel, queuePanel, transcriptPanel);
}

// =========================================================================
// VIEW 5: SETTINGS (SEKMELİ & SAKİN AYARLAR)
// =========================================================================
function renderSettings() {
  const s = state.settings;
  const sec = state.secrets;

  const topbar = el("div", { className: "topbar" },
    el("div", {},
      el("h1", { className: "page-title" }, "Ayarlar"),
      el("p", { className: "page-subtitle" }, "API anahtarları Windows DPAPI ile yerelde şifrelenir ve hiçbir zaman tarayıcıya ham olarak gönderilmez.")
    )
  );

  const tabDefs = [
    ["translation", "Çeviri"],
    ["narration", "Seslendirme"],
    ["whisper", "Transkripsiyon"],
    ["glossary", `Sözlük (${state.glossary.length})`],
    ["system", "Sistem & Yedek"],
  ];

  const tabsBar = el("div", { className: "tabs-bar" },
    ...tabDefs.map(([k, label]) =>
      el("button", {
        className: `tab-btn ${state.settingsTab === k ? "active" : ""}`,
        onclick: () => { state.settingsTab = k; renderCurrentView(); },
      }, label)
    )
  );

  let panel = null;

  if (state.settingsTab === "translation") {
    const trProvSel = el("select", {},
      ...[["openrouter", "OpenRouter (Önerilen)"], ["openai", "Doğrudan OpenAI"], ["custom", "Yerel / Özel OpenAI Uyumlu"], ["mock", "Mock (Ücretsiz Test)"]].map(([k, l]) =>
        el("option", { value: k, ...(s.translation_provider === k ? { selected: "selected" } : {}) }, l)
      )
    );
    const trModelIn = el("input", { value: s.translation_model || "openai/gpt-4o-mini", placeholder: "örn. openai/gpt-4o-mini" });
    const spendLimitIn = el("input", { type: "number", step: "0.5", value: String(s.monthly_spend_limit_usd ?? 10) });
    const orKeyIn = el("input", { type: "password", placeholder: sec.openrouter_api_key?.configured ? `Kayıtlı (${sec.openrouter_api_key.masked})` : "sk-or-v1-..." });
    const oaiKeyIn = el("input", { type: "password", placeholder: sec.openai_api_key?.configured ? `Kayıtlı (${sec.openai_api_key.masked})` : "sk-..." });
    const trTestOut = el("p", { className: "help-text" });

    const orModelDropdown = state.openrouterModels.length
      ? el("select", {
          style: { marginTop: "6px" },
          onchange: (e) => { if (e.target.value) trModelIn.value = e.target.value; },
        },
          el("option", { value: "" }, `OpenRouter modellerinden seç (${state.openrouterModels.length})`),
          ...state.openrouterModels.slice(0, 120).map((m) => el("option", { value: m.id }, `${m.name} (${m.id})`))
        )
      : null;

    panel = el("section", { className: "panel" },
      el("h2", {}, "Çeviri Motoru"),
      el("div", { className: "form-grid", style: { marginBottom: "14px" } },
        el("div", { className: "field" }, el("label", {}, "Sağlayıcı"), trProvSel),
        el("div", { className: "field" }, el("label", {}, "Model Kimliği"), trModelIn, orModelDropdown),
        el("div", { className: "field" }, el("label", {}, "Aylık Uyarı Limiti (USD)"), spendLimitIn)
      ),
      el("div", { className: "form-grid", style: { marginBottom: "16px" } },
        el("div", { className: "field" },
          el("label", {}, "OpenRouter API Anahtarı"),
          orKeyIn,
          el("div", { className: "help-text" }, sec.openrouter_api_key?.configured ? `Kayıtlı (${sec.openrouter_api_key.storage_backend})` : "Henüz anahtar girilmedi.")
        ),
        el("div", { className: "field" },
          el("label", {}, "OpenAI API Anahtarı"),
          oaiKeyIn,
          el("div", { className: "help-text" }, sec.openai_api_key?.configured ? `Kayıtlı (${sec.openai_api_key.storage_backend})` : "İsteğe bağlı.")
        )
      ),
      el("div", { className: "actions-row" },
        el("button", {
          className: "btn-primary btn-sm",
          onclick: async () => {
            await api("/api/settings", {
              method: "PATCH",
              body: { translation_provider: trProvSel.value, translation_model: trModelIn.value.trim(), monthly_spend_limit_usd: Number(spendLimitIn.value || 10) },
            });
            const secretPatch = {};
            if (orKeyIn.value.trim()) secretPatch.openrouter_api_key = orKeyIn.value.trim();
            if (oaiKeyIn.value.trim()) secretPatch.openai_api_key = oaiKeyIn.value.trim();
            if (Object.keys(secretPatch).length) await api("/api/secrets", { method: "PUT", body: secretPatch });
            await loadSettingsData();
            renderCurrentView();
            toast("Çeviri ayarları güvenle kaydedildi.");
          },
        }, "Kaydet"),
        el("button", {
          className: "btn-sm",
          onclick: async () => {
            try {
              state.openrouterModels = await api("/api/providers/openrouter/models");
              renderCurrentView();
              toast(`${state.openrouterModels.length} OpenRouter modeli yüklendi.`);
            } catch (e) { toast(e.message); }
          },
        }, "Modelleri Getir"),
        el("button", {
          className: "btn-sm",
          onclick: async () => {
            trTestOut.textContent = "Bağlantı test ediliyor...";
            try {
              const secretPatch = {};
              if (orKeyIn.value.trim()) secretPatch.openrouter_api_key = orKeyIn.value.trim();
              if (oaiKeyIn.value.trim()) secretPatch.openai_api_key = oaiKeyIn.value.trim();
              if (Object.keys(secretPatch).length) {
                await api("/api/secrets", { method: "PUT", body: secretPatch });
                await api("/api/settings", {
                  method: "PATCH",
                  body: { translation_provider: trProvSel.value, translation_model: trModelIn.value.trim() },
                });
              }
              const res = await api("/api/providers/translation/test", {
                method: "POST",
                body: { provider: trProvSel.value, model: trModelIn.value.trim() },
              });
              await loadSettingsData();
              trTestOut.textContent = `Bağlantı başarılı: "${res.sample}"`;
            } catch (e) {
              trTestOut.textContent = `Hata: ${e.message}`;
            }
          },
        }, "Bağlantıyı Test Et")
      ),
      trTestOut
    );
  } else if (state.settingsTab === "narration") {
    const ttsProvSel = el("select", {},
      ...[
        ["supertonic", "Supertonic 3 (Yerel · Ücretsiz · Sınırsız)"],
        ["edge_tts", "Edge TTS (Ücretsiz Çevrimiçi)"],
        ["browser", "Tarayıcı Sesi (Anlık)"],
        ["elevenlabs", "ElevenLabs (API Kredili)"],
        ["mock", "Mock (Test)"],
      ].map(([k, l]) =>
        el("option", { value: k, ...(s.tts_provider === k ? { selected: "selected" } : {}) }, l)
      )
    );
    const stVoiceSel = el("select", {},
      ...[
        ["M1", "M1 · Erkek (Dengeli)"],
        ["M2", "M2 · Erkek (Sakin)"],
        ["M3", "M3 · Erkek (Net)"],
        ["M4", "M4 · Erkek (Derin)"],
        ["M5", "M5 · Erkek (Dinamik)"],
        ["F1", "F1 · Kadın (Dengeli)"],
        ["F2", "F2 · Kadın (Sıcak)"],
        ["F3", "F3 · Kadın (Net)"],
        ["F4", "F4 · Kadın (Sakin)"],
        ["F5", "F5 · Kadın (Enerjik)"],
      ].map(([k, l]) =>
        el("option", { value: k, ...((s.supertonic_voice || "M1") === k ? { selected: "selected" } : {}) }, l)
      )
    );
    const elKeyIn = el("input", { type: "password", placeholder: sec.elevenlabs_api_key?.configured ? `Kayıtlı (${sec.elevenlabs_api_key.masked})` : "xi-api-key..." });
    const elModelSel = el("select", {},
      ...(state.elevenModels.length ? state.elevenModels : [{ id: "eleven_flash_v2_5", name: "Eleven Flash v2.5" }, { id: "eleven_multilingual_v2", name: "Eleven Multilingual v2" }]).map((m) =>
        el("option", { value: m.id, ...(s.elevenlabs_model === m.id ? { selected: "selected" } : {}) }, m.name)
      )
    );
    const elVoiceIn = el("input", { value: s.elevenlabs_voice_id || "", placeholder: "ElevenLabs Voice ID" });
    const elBudgetIn = el("input", { type: "number", value: String(s.elevenlabs_char_budget ?? 10000) });
    const elStatusOut = el("p", { className: "help-text" },
      state.elevenSub
        ? `Plan: ${state.elevenSub.tier} · Kalan: ${state.elevenSub.remaining_characters} / ${state.elevenSub.character_limit} karakter`
        : (state.elevenWarning || "")
    );
    const sampleAudioWrap = el("div", { style: { marginTop: "10px" } });

    const voiceDropdown = state.elevenVoices.length
      ? el("select", {
          style: { marginTop: "6px" },
          onchange: (e) => { if (e.target.value) elVoiceIn.value = e.target.value; },
        },
          el("option", { value: "" }, `Hesabınızdaki seslerden seç (${state.elevenVoices.length})`),
          ...state.elevenVoices.map((v) => el("option", { value: v.voice_id }, `${v.name} (${v.category})`))
        )
      : null;

    panel = el("section", { className: "panel" },
      el("h2", {}, "Seslendirme (TTS)"),
      el("div", { className: "form-grid", style: { marginBottom: "14px" } },
        el("div", { className: "field" }, el("label", {}, "Varsayılan Sağlayıcı"), ttsProvSel),
        el("div", { className: "field" }, el("label", {}, "Supertonic 3 Ses Stili"), stVoiceSel)
      ),
      el("div", { className: "actions-row", style: { marginBottom: "18px" } },
        el("button", {
          className: "btn-primary btn-sm",
          onclick: async () => {
            await api("/api/settings", {
              method: "PATCH",
              body: {
                tts_provider: ttsProvSel.value,
                supertonic_voice: stVoiceSel.value,
                elevenlabs_model: elModelSel.value,
                elevenlabs_voice_id: elVoiceIn.value.trim(),
                elevenlabs_char_budget: Number(elBudgetIn.value || 10000),
              },
            });
            if (elKeyIn.value.trim()) await api("/api/secrets", { method: "PUT", body: { elevenlabs_api_key: elKeyIn.value.trim() } });
            await loadSettingsData();
            renderCurrentView();
            toast("Seslendirme ayarları kaydedildi.");
          },
        }, "Kaydet"),
        el("button", {
          className: "btn-sm",
          onclick: async () => {
            elStatusOut.textContent = "Supertonic 3 yerel Türkçe örnek üretiliyor...";
            try {
              const res = await api("/api/providers/supertonic/sample", {
                method: "POST",
                body: { voice: stVoiceSel.value },
              });
              const a = el("audio", { controls: "controls", src: res.url, style: { width: "100%" } });
              sampleAudioWrap.replaceChildren(a);
              a.play().catch(() => {});
              elStatusOut.textContent = `Supertonic 3 (${res.voice}) örnek ses hazır (${res.duration_sec} sn · ücretsiz/yerel).`;
            } catch (e) { elStatusOut.textContent = `Hata: ${e.message}`; }
          },
        }, icon("volume", 14), "Supertonic 3 Örnek Dinle")
      ),
      el("details", { style: { borderTop: "1px solid var(--border)", paddingTop: "14px" } },
        el("summary", { style: { cursor: "pointer", fontWeight: 600, fontSize: "14px", color: "var(--text-muted)" } }, "ElevenLabs Yapılandırması (İsteğe Bağlı)"),
        el("div", { className: "form-grid", style: { margin: "14px 0" } },
          el("div", { className: "field" }, el("label", {}, "ElevenLabs API Anahtarı"), elKeyIn),
          el("div", { className: "field" }, el("label", {}, "Model"), elModelSel),
          el("div", { className: "field" }, el("label", {}, "Voice ID"), elVoiceIn, voiceDropdown),
          el("div", { className: "field" }, el("label", {}, "Karakter Sınırı"), elBudgetIn)
        ),
        el("div", { className: "actions-row" },
          el("button", {
            className: "btn-sm",
            onclick: async () => {
              elStatusOut.textContent = "ElevenLabs kontrol ediliyor...";
              try {
                if (elKeyIn.value.trim()) await api("/api/secrets", { method: "PUT", body: { elevenlabs_api_key: elKeyIn.value.trim() } });
                const res = await api("/api/providers/elevenlabs/test", { method: "POST" });
                state.elevenSub = res.subscription;
                state.elevenVoices = res.voices || [];
                state.elevenModels = res.models || state.elevenModels;
                state.elevenWarning = (res.warnings && res.warnings.length) ? res.warnings.join(" | ") : "";
                await loadSettingsData();
                renderCurrentView();
                toast("ElevenLabs bağlantısı doğrulandı.");
              } catch (e) { elStatusOut.textContent = `Hata: ${e.message}`; }
            },
          }, "Bağlantı & Kredi Testi"),
          el("button", {
            className: "btn-sm",
            onclick: async () => {
              if (!elVoiceIn.value.trim()) return toast("Önce bir Voice ID seçin.");
              try {
                const res = await api("/api/providers/elevenlabs/sample", {
                  method: "POST",
                  body: { voice_id: elVoiceIn.value.trim(), model_id: elModelSel.value },
                });
                const a = el("audio", { controls: "controls", src: res.url, style: { width: "100%" } });
                sampleAudioWrap.replaceChildren(a);
                a.play().catch(() => {});
                toast(`Örnek ses üretildi (${res.characters} karakter).`);
              } catch (e) { toast(e.message); }
            },
          }, "ElevenLabs Örnek Dinle")
        )
      ),
      elStatusOut,
      sampleAudioWrap
    );
  } else if (state.settingsTab === "whisper") {
    const wInfo = state.systemInfo?.whisper || {};
    const wModelSel = el("select", {},
      ...["tiny", "base", "small", "medium", "large-v3"].map((m) =>
        el("option", { value: m, ...(s.whisper_model === m ? { selected: "selected" } : {}) }, m)
      )
    );
    const wDevSel = el("select", {},
      ...[["auto", "Otomatik (Önerilen)"], ["cuda", "GPU (CUDA float16)"], ["cpu", "CPU (int8)"]].map(([k, l]) =>
        el("option", { value: k, ...(s.whisper_device === k ? { selected: "selected" } : {}) }, l)
      )
    );
    const wAutoLang = el("input", { type: "checkbox", ...(s.whisper_auto_language ? { checked: "checked" } : {}) });
    const wAllowDl = el("input", { type: "checkbox", ...(s.whisper_allow_download ? { checked: "checked" } : {}) });

    panel = el("section", { className: "panel" },
      el("h2", {}, "Transkripsiyon (Faster-Whisper)"),
      el("div", { className: "actions-row", style: { marginBottom: "16px", gap: "16px" } },
        el("span", { className: `status-dot ${wInfo.faster_whisper_installed ? "ok" : "warn"}` }, wInfo.faster_whisper_installed ? "Faster-Whisper hazır" : "Faster-Whisper kurulu değil"),
        el("span", { className: `status-dot ${wInfo.cuda_available ? "ok" : ""}` }, wInfo.cuda_available ? "CUDA GPU aktif" : "CPU modu"),
        el("span", { className: `status-dot ${wInfo.ffmpeg_installed ? "ok" : "warn"}` }, wInfo.ffmpeg_installed ? "FFmpeg kurulu" : "FFmpeg yok (PyAV aktif)")
      ),
      el("div", { className: "form-grid", style: { marginBottom: "14px" } },
        el("div", { className: "field" }, el("label", {}, "Whisper Modeli"), wModelSel),
        el("div", { className: "field" }, el("label", {}, "İşlem Birimi"), wDevSel)
      ),
      el("div", { className: "actions-row", style: { marginBottom: "16px", gap: "18px" } },
        el("label", { className: "inline-check" }, wAutoLang, "Dili otomatik algıla"),
        el("label", { className: "inline-check" }, wAllowDl, "Eksik modeli indirmeye izin ver")
      ),
      el("button", {
        className: "btn-primary btn-sm",
        onclick: async () => {
          state.settings = await api("/api/settings", {
            method: "PATCH",
            body: { whisper_model: wModelSel.value, whisper_device: wDevSel.value, whisper_auto_language: wAutoLang.checked, whisper_allow_download: wAllowDl.checked },
          });
          toast("Transkripsiyon ayarları kaydedildi.");
        },
      }, "Kaydet")
    );
  } else if (state.settingsTab === "glossary") {
    const gEn = el("input", { placeholder: "İngilizce terim (örn. Calibration)" });
    const gTr = el("input", { placeholder: "Türkçe karşılık (örn. Kalibrasyon)" });
    const gNote = el("input", { placeholder: "Bağlam notu (isteğe bağlı)" });

    panel = el("section", { className: "panel" },
      el("h2", {}, `Teknik Terminoloji Sözlüğü (${state.glossary.length})`),
      el("div", { className: "form-grid", style: { marginBottom: "12px" } }, gEn, gTr, gNote),
      el("button", {
        className: "btn-primary btn-sm",
        style: { marginBottom: "16px" },
        onclick: async () => {
          if (!gEn.value.trim() || !gTr.value.trim()) return toast("İngilizce ve Türkçe terim gereklidir.");
          await api("/api/glossary", { method: "POST", body: { term_en: gEn.value.trim(), term_tr: gTr.value.trim(), context_note: gNote.value.trim() } });
          state.glossary = await api("/api/glossary");
          renderCurrentView();
          toast("Terim kaydedildi.");
        },
      }, icon("plus", 14), "Terim Ekle"),
      ...state.glossary.slice(0, 40).map((g) =>
        el("div", { className: "list-row" },
          el("div", {},
            el("strong", {}, `${g.term_en} → ${g.term_tr}`),
            g.context_note ? el("div", { className: "help-text" }, g.context_note) : null
          ),
          el("button", {
            className: "btn-ghost btn-sm",
            onclick: async () => {
              await api(`/api/glossary/${g.id}`, { method: "DELETE" });
              state.glossary = await api("/api/glossary");
              renderCurrentView();
            },
          }, "Sil")
        )
      )
    );
  } else {
    const u = state.systemInfo?.usage || {};
    const benchOut = el("p", { className: "help-text" });
    panel = el("section", { className: "panel" },
      el("h2", {}, "Görünüm, Sistem ve Yedekleme"),
      el("div", { className: "field", style: { marginBottom: "16px", maxWidth: "260px" } },
        el("label", {}, "Tema"),
        el("div", { className: "segmented", style: { width: "100%" } },
          el("button", {
            style: { flex: 1 },
            className: document.documentElement.getAttribute("data-theme") !== "dark" ? "active" : "",
            onclick: async () => {
              applyTheme("light");
              state.settings = await api("/api/settings", { method: "PATCH", body: { theme: "light" } }).catch(() => state.settings);
              renderCurrentView();
            },
          }, icon("sun", 14), "Kağıt"),
          el("button", {
            style: { flex: 1 },
            className: document.documentElement.getAttribute("data-theme") === "dark" ? "active" : "",
            onclick: async () => {
              applyTheme("dark");
              state.settings = await api("/api/settings", { method: "PATCH", body: { theme: "dark" } }).catch(() => state.settings);
              renderCurrentView();
            },
          }, icon("moon", 14), "Koyu")
        )
      ),
      el("p", { className: "help-text tabular" }, `Sürüm: v${state.systemInfo?.version || "0.5.0"} · Veritabanı: ${state.systemInfo?.db_path || "outputs/library.sqlite3"}`),
      el("p", { className: "help-text tabular", style: { marginBottom: "16px" } }, `Çeviri Önbelleği: ${u.translation_cache_entries || 0} · Ses Önbelleği: ${u.audio_cache_entries || 0} · Çeviri çağrısı: ${u.translation?.calls || 0} · Seslendirilen karakter: ${u.narration?.chars || 0}`),
      el("div", { className: "actions-row" },
        el("button", { className: "btn-sm", onclick: () => { window.location.href = "/api/backup"; } }, icon("download", 14), "SQLite Yedeği"),
        el("button", {
          className: "btn-sm",
          onclick: async () => {
            const res = await api("/api/cache/clear", { method: "POST", body: { translation: true, audio: true } });
            await loadSettingsData();
            renderCurrentView();
            toast(`Önbellek temizlendi (Çeviri: ${res.translation_cache}, Ses: ${res.audio_cache}).`);
          },
        }, "Sunucu Önbelleğini Temizle"),
        el("button", {
          className: "btn-sm",
          onclick: async () => {
            await clearOfflineStore();
            toast("Çevrimdışı tarayıcı verisi temizlendi.");
          },
        }, "Çevrimdışı Veriyi Temizle"),
        el("button", {
          className: "btn-sm",
          onclick: async () => {
            const res = await api("/api/benchmark/smoke", { method: "POST" });
            const passed = res.rows.filter((r) => r.passed_deterministic_qa).length;
            benchOut.textContent = `Smoke Benchmark (${res.mode}): ${passed}/${res.rows.length} örnek deterministik QA'dan geçti.`;
          },
        }, "Smoke Benchmark")
      ),
      benchOut
    );
  }

  viewRoot.replaceChildren(topbar, tabsBar, panel);
}

// =========================================================================
// ROUTER & BOOTSTRAP
// =========================================================================
function renderCurrentView() {
  if (state.view === "reader") renderReader();
  else if (state.view === "discover") renderDiscover();
  else if (state.view === "listen") renderListen();
  else if (state.view === "settings") renderSettings();
  else renderLibrary();
}

async function boot() {
  hydrateStaticIcons();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  await Promise.all([loadLibrary(), loadSettingsData().catch(() => {})]);
  if (!state.settings.theme) applyTheme("light");
  renderCurrentView();
  pollJobs();
}

boot();
