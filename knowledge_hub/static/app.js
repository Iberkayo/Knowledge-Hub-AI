// Knowledge Hub AI — Main SPA controller (Library, Reader, Discover, Listen, Settings).

import { renderRichText } from "./render.js";
import { PersistentPlayer, formatTime } from "./player.js";
import { saveItemOffline, getOfflineItem, listOfflineItems, clearOfflineStore } from "./offline.js";

const state = {
  view: "library", // library | reader | discover | listen | settings
  items: [],
  activeItem: null,
  filter: "all", // all | favorites | unread | continue | article | podcast | document
  categoryFilter: "",
  search: "",
  readerTab: "tr", // tr | original | bilingual
  readerFontSize: 18,
  readerWidth: "medium", // narrow | medium | wide
  translationMode: "faithful",
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

// Theme
function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.textContent = t === "light" ? "🌙 Koyu Tema" : "☀️ Açık Tema";
}

document.getElementById("themeToggleBtn").onclick = async () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
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
  renderCurrentView();
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
    applyTheme(settings.theme);
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

    // Refresh views when a previously active job completes
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
      return el(
        "div",
        { className: "job-row" },
        el("strong", {}, `${j.job_type.toUpperCase()} · ${j.stage}${segInfo}`),
        el("span", { className: "badge info" }, `${j.provider || "yerel"}${j.model ? ` / ${j.model}` : ""}`),
        el("div", { className: "progress-track" }, el("div", { className: "progress-fill", style: { width: `${pct}%` } })),
        el("span", {}, `%${pct}`),
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
  const tabs = el("div", { className: "segmented", style: { marginBottom: "14px" } });
  const body = el("div");

  function renderTab() {
    tabs.replaceChildren(
      ...[["url", "🔗 Makale URL"], ["file", "📄 Dosya / Ses Yükle"], ["paste", "📝 Metin / HTML Yapıştır"]].map(([k, label]) =>
        el("button", { className: tab === k ? "active" : "", onclick: () => { tab = k; renderTab(); } }, label)
      )
    );
    body.replaceChildren();

    if (tab === "url") {
      const urlInput = el("input", { type: "url", placeholder: "https://hamel.dev/evals/" });
      const statusMsg = el("p", { className: "help-text" }, "Yalnızca erişim izniniz olan herkese açık HTTPS makale adreslerini girin. Gerçek başlık, yazar ve içerik otomatik çıkarılır.");
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
        el("div", { className: "field", style: { marginBottom: "12px" } }, el("label", {}, "Makale Adresi (HTTPS)"), urlInput, statusMsg),
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
        el("div", { className: "field", style: { marginBottom: "10px" } }, el("label", {}, "Belge veya Ses Dosyası (TXT, HTML, PDF, EPUB, SRT/VTT, MP3/WAV/M4A)"), fileInput),
        el("div", { className: "form-grid", style: { marginBottom: "12px" } },
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
        el("div", { className: "field", style: { marginBottom: "12px" } }, el("label", {}, "İçerik"), contentTa),
        saveBtn
      );
    }
  }

  renderTab();
  wrap.append(tabs, body);
  openModal("Yeni İçerik Ekle", wrap);
}

// =========================================================================
// TRANSLATION & NARRATION TRIGGERS (WITH CLEAR COST/KEY CHECKS)
// =========================================================================
async function triggerTranslation(item, { mode = "faithful", force = false } = {}) {
  const provider = state.settings.translation_provider || "openrouter";
  const model = state.settings.translation_model || "openai/gpt-4o-mini";
  const keyMap = { openrouter: "openrouter_api_key", openai: "openai_api_key" };
  const needsKey = keyMap[provider] && !state.secrets[keyMap[provider]]?.configured;

  if (needsKey) {
    const msg = el("div", {},
      el("p", {}, `Seçili çeviri sağlayıcısı (${provider}) için API anahtarı henüz tanımlanmamış.`),
      el("p", { className: "help-text" }, "Gerçek Türkçe çeviri için Ayarlar sayfasından OpenRouter veya OpenAI API anahtarınızı güvenle ekleyebilirsiniz. Dilerseniz API kredisi harcamadan akışı test etmek için Mock (Test) önizlemesi çalıştırabilirsiniz."),
      el("div", { className: "actions-row", style: { marginTop: "14px" } },
        el("button", { className: "btn-primary", onclick: () => { closeModal(); loadSettingsData().then(() => setNav("settings")); } }, "⚙️ Ayarlara Git"),
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
    openModal("Çeviri Sağlayıcısı Yapılandırması Gerekli", msg);
    return;
  }

  try {
    await api(`/api/items/${item.id}/translate`, {
      method: "POST",
      body: { mode, provider, model, force, async_job: true },
    });
    toast("Türkçe çeviri işlemi kuyruğa alındı.");
    ensureJobPolling();
  } catch (e) {
    toast(e.message);
  }
}

async function triggerNarration(item) {
  // If audio already exists, play immediately without spending credits
  if (item.audio_path && item.audio_status === "ready") {
    player.playItem(item);
    return;
  }

  const ttsProvider = state.settings.tts_provider || "browser";
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
      el("p", {}, `Toplam parça: ${est.total_chunks} (Önbellekten: ${est.cached_chunks || 0}, Yeni üretilecek: ${est.new_chunks ?? est.total_chunks})`),
      el("p", {}, `Faturalanacak tahmini yeni karakter: ${est.new_characters_to_bill ?? 0} · Tahmini süre: ~${est.estimated_minutes || 1} dk`),
      el("div", { className: "actions-row", style: { marginTop: "14px" } },
        el("button", {
          className: "btn-primary",
          onclick: async () => {
            closeModal();
            try {
              await api(`/api/items/${item.id}/narrate`, { method: "POST", body: { provider: ttsProvider, async_job: true } });
              toast("Ses üretimi başlatıldı.");
              ensureJobPolling();
            } catch (e) { toast(e.message); }
          },
        }, "Seslendirmeyi Başlat"),
        el("button", {
          onclick: () => {
            closeModal();
            player.playBrowserTTS(item, item.translated || item.original);
          },
        }, "Ücretsiz Tarayıcı Sesiyle Dinle")
      )
    );
    openModal("Türkçe Seslendirme Onayı", box);
  } catch (e) {
    toast(e.message);
  }
}

// =========================================================================
// VIEW 1: LIBRARY (KÜTÜPHANEM)
// =========================================================================
function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || "Yerel"; }
}

function renderLibrary() {
  const categories = [...new Set(state.items.map((x) => x.category).filter(Boolean))].sort();
  const q = state.search.trim().toLocaleLowerCase("tr");
  const filtered = state.items.filter((x) => {
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

  const topbar = el("div", { className: "topbar" },
    el("div", {},
      el("h1", { className: "page-title" }, "Kütüphanem"),
      el("p", { className: "page-subtitle" }, `${state.items.length} kayıtlı içerik${state.offlineMode ? " · Çevrimdışı mod" : ""}`)
    ),
    el("div", { className: "actions-row" },
      el("button", { className: "btn-primary", onclick: () => showAddContentModal() }, "+ İçerik Ekle")
    )
  );

  const searchInput = el("input", {
    className: "search-box",
    placeholder: "Başlık, yazar, kategori veya kaynak ara...",
    value: state.search,
    oninput: (e) => { state.search = e.target.value; renderCurrentView(); },
  });

  const filterDefs = [
    ["all", "Tümü"],
    ["favorites", "★ Favoriler"],
    ["unread", "Okunmamış"],
    ["continue", "Devam Et"],
    ["article", "Makaleler"],
    ["podcast", "Podcastlar"],
    ["document", "Belgeler"],
  ];

  const chips = el("div", { className: "chips" },
    ...filterDefs.map(([k, label]) =>
      el("button", { className: `chip ${state.filter === k ? "active" : ""}`, onclick: () => { state.filter = k; renderCurrentView(); } }, label)
    )
  );

  const catSel = el("select", {
    style: { width: "auto", minWidth: "150px" },
    onchange: (e) => { state.categoryFilter = e.target.value; renderCurrentView(); },
  },
    el("option", { value: "" }, "Tüm Kategoriler"),
    ...categories.map((c) => el("option", { value: c, ...(state.categoryFilter === c ? { selected: "selected" } : {}) }, c))
  );

  const toolbar = el("div", { className: "toolbar" }, searchInput, chips, categories.length ? catSel : null);

  if (!filtered.length) {
    viewRoot.replaceChildren(
      topbar,
      toolbar,
      el("div", { className: "empty-state" },
        el("h3", {}, state.items.length ? "Filtreyle eşleşen içerik bulunamadı" : "Kütüphaneniz henüz boş"),
        el("p", {}, "Bir makale URL'si yapıştırarak, PDF/EPUB/ses dosyası yükleyerek veya Keşfet ekranından yayın ekleyerek başlayın."),
        el("button", { className: "btn-primary", onclick: () => showAddContentModal() }, "+ İlk İçeriği Ekle")
      )
    );
    return;
  }

  const grid = el("div", { className: "cards-grid" },
    ...filtered.map((item) => {
      const trDone = item.status === "processed" && item.mode !== "demo";
      const audioReady = item.audio_status === "ready" || Boolean(item.source_audio_path);
      const kindTr = { article: "Makale", podcast: "Podcast", document: "Belge" }[item.kind] || item.kind;

      return el("article", { className: "card" },
        el("div", { className: "badges" },
          el("span", { className: "badge info" }, kindTr),
          item.category ? el("span", { className: "badge" }, item.category) : null,
          el("span", { className: `badge ${trDone ? "ok" : "warn"}` }, trDone ? `Türkçe Hazır (${item.translation_mode || "tam"})` : "Çevrilmedi"),
          audioReady ? el("span", { className: "badge ok" }, "🎧 Ses Hazır") : null
        ),
        el("h3", { className: "card-title", onclick: () => openReader(item.id) }, item.title),
        el("div", { className: "card-meta" },
          item.author ? el("span", {}, `✍ ${item.author}`) : null,
          el("span", {}, `🌐 ${getDomain(item.source)}`),
          item.published_at ? el("span", {}, `📅 ${String(item.published_at).slice(0, 10)}`) : null,
          el("span", {}, `📖 ~${item.reading_minutes || 1} dk`),
          el("span", {}, `🎧 ~${item.listening_minutes || 1} dk`)
        ),
        el("div", { className: "card-actions" },
          el("button", { className: "btn-primary btn-sm", onclick: () => openReader(item.id) }, "Oku"),
          !trDone ? el("button", { className: "btn-sm", onclick: () => triggerTranslation(item) }, "Türkçeye Çevir") : null,
          el("button", { className: "btn-sm", onclick: () => triggerNarration(item) }, "Dinle"),
          el("button", {
            className: "btn-ghost btn-sm",
            title: "Favori",
            onclick: async () => {
              await api(`/api/items/${item.id}/metadata`, {
                method: "PATCH",
                body: { favorite: !item.favorite, notes: item.notes || "", category: item.category || "" },
              });
              await loadLibrary();
              renderCurrentView();
            },
          }, item.favorite ? "★" : "☆")
        )
      );
    })
  );

  viewRoot.replaceChildren(topbar, toolbar, grid);
}

// =========================================================================
// VIEW 2: READER (İÇERİK OKUYUCU)
// =========================================================================
function renderReader() {
  const item = state.activeItem;
  if (!item) { setNav("library"); return; }

  const hasTr = Boolean(item.translated);
  const modeSelect = el("select", {
    style: { width: "auto", padding: "6px 10px", fontSize: "13px" },
    onchange: (e) => { state.translationMode = e.target.value; },
  },
    el("option", { value: "faithful", ...(state.translationMode === "faithful" ? { selected: "selected" } : {}) }, "Tam Çeviri (Varsayılan)"),
    el("option", { value: "explained", ...(state.translationMode === "explained" ? { selected: "selected" } : {}) }, "Açıklamalı Anlatım"),
    el("option", { value: "summary", ...(state.translationMode === "summary" ? { selected: "selected" } : {}) }, "Özet Modu")
  );

  const viewSwitcher = el("div", { className: "segmented" },
    ...[["tr", "Türkçe"], ["original", "Orijinal"], ["bilingual", "Çift Dilli"]].map(([k, label]) =>
      el("button", { className: state.readerTab === k ? "active" : "", onclick: () => { state.readerTab = k; renderCurrentView(); } }, label)
    )
  );

  const toolbar = el("div", { className: "reader-toolbar" },
    el("div", { className: "actions-row" },
      el("button", { className: "btn-sm", onclick: () => { loadLibrary().then(() => setNav("library")); } }, "← Kütüphane"),
      viewSwitcher
    ),
    el("div", { className: "actions-row" },
      modeSelect,
      el("button", { className: "btn-primary btn-sm", onclick: () => triggerTranslation(item, { mode: state.translationMode, force: hasTr }) }, hasTr ? "Yeniden Çevir" : "Türkçeye Çevir"),
      el("button", { className: "btn-sm", onclick: () => triggerNarration(item) }, "🎧 Türkçe Dinle"),
      el("button", { className: "btn-sm", title: "Yazı boyutunu küçült", onclick: () => { state.readerFontSize = Math.max(14, state.readerFontSize - 2); renderCurrentView(); } }, "A-"),
      el("button", { className: "btn-sm", title: "Yazı boyutunu büyüt", onclick: () => { state.readerFontSize = Math.min(26, state.readerFontSize + 2); renderCurrentView(); } }, "A+"),
      el("select", {
        style: { width: "auto", padding: "5px 8px", fontSize: "12.5px" },
        onchange: (e) => { state.readerWidth = e.target.value; renderCurrentView(); },
      },
        el("option", { value: "narrow", ...(state.readerWidth === "narrow" ? { selected: "selected" } : {}) }, "Dar"),
        el("option", { value: "medium", ...(state.readerWidth === "medium" ? { selected: "selected" } : {}) }, "Orta"),
        el("option", { value: "wide", ...(state.readerWidth === "wide" ? { selected: "selected" } : {}) }, "Geniş")
      )
    )
  );

  const articleWrap = el("article", { className: `reader-article-wrap width-${state.readerWidth}` });
  const header = el("header", { className: "reader-header" },
    el("h1", {}, item.title),
    el("div", { className: "card-meta" },
      item.author ? el("span", {}, `✍ ${item.author}`) : null,
      item.published_at ? el("span", {}, `📅 ${String(item.published_at).slice(0, 10)}`) : null,
      item.source && item.source.startsWith("https://")
        ? el("a", { href: item.source, target: "_blank", rel: "noopener noreferrer", style: { color: "var(--accent)" } }, `🌐 ${getDomain(item.source)}`)
        : el("span", {}, item.source || "Yerel"),
      item.translation_model ? el("span", { className: "badge info" }, `${item.translation_provider} / ${item.translation_model}`) : null,
      item.mode === "mock" ? el("span", { className: "badge warn" }, "Mock Test Çıktısı") : null
    )
  );

  const bodyContainer = el("div", { className: "reader-body", style: { "--reader-font-size": `${state.readerFontSize}px` } });

  if (state.readerTab === "tr") {
    if (!hasTr) {
      bodyContainer.append(
        el("div", { className: "empty-state" },
          el("h3", {}, "Bu içerik henüz Türkçeye çevrilmedi"),
          el("p", {}, "Yukarıdan çeviri modunu seçip 'Türkçeye Çevir' butonuna tıklayın."),
          el("button", { className: "btn-primary", onclick: () => triggerTranslation(item, { mode: state.translationMode }) }, "Türkçeye Çevir")
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
          right.append(el("div", { className: "seg-warn" }, `⚠ QA uyarısı: ${warns.join(", ")}`));
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

  articleWrap.append(header, bodyContainer);

  // Highlights, Notes, Progress & Offline Actions
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

  const metaPanel = el("section", { className: "panel" },
    el("h3", {}, "Okuma İlerlemesi, Vurgular ve Notlar"),
    el("div", { className: "actions-row", style: { marginBottom: "14px" } },
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
      }, "🖍 Seçili Metni Vurgula"),
      el("button", {
        className: "btn-sm",
        onclick: async () => {
          try {
            let blob = null;
            if (item.audio_path) {
              const r = await fetch(`/api/items/${item.id}/audio`);
              if (r.ok) blob = await r.blob();
            }
            await saveItemOffline(item, blob);
            toast("Çevrimdışı erişim için IndexedDB'ye kaydedildi.");
          } catch (e) { toast(e.message); }
        },
      }, "💾 Çevrimdışı Kaydet"),
      el("button", { className: "btn-sm", onclick: () => { window.location.href = `/api/items/${item.id}/export?format=md`; } }, "⬇ Markdown İndir"),
      el("button", { className: "btn-sm", onclick: () => { window.location.href = `/api/items/${item.id}/export?format=txt`; } }, "⬇ TXT İndir"),
      el("button", {
        className: "btn-sm btn-danger",
        onclick: async () => {
          if (!confirm("Bu içerik ve ilişkili ses dosyaları kalıcı olarak silinsin mi?")) return;
          await api(`/api/items/${item.id}`, { method: "DELETE" });
          state.activeItem = null;
          await loadLibrary();
          setNav("library");
          toast("İçerik silindi.");
        },
      }, "🗑 Sil")
    ),
    highlights.length
      ? el("div", { style: { marginBottom: "14px" } },
          el("strong", { style: { display: "block", marginBottom: "6px", fontSize: "13px" } }, "Vurgular"),
          ...highlights.map((h, idx) =>
            el("div", { className: "highlight-chip" },
              el("span", {}, `“${h.text}”`),
              el("button", {
                className: "btn-ghost btn-sm",
                onclick: async () => {
                  highlights.splice(idx, 1);
                  state.activeItem = await api(`/api/items/${item.id}/metadata`, {
                    method: "PATCH",
                    body: { favorite: favChk.checked, notes: notesTa.value, category: catIn.value, highlights },
                  });
                  renderCurrentView();
                },
              }, "✕")
            )
          )
        )
      : null,
    el("div", { className: "field", style: { marginBottom: "12px" } },
      el("label", {}, `Okuma İlerlemesi: %${Math.round((item.position || 0) * 100)}`),
      progressRange
    ),
    el("div", { className: "form-grid", style: { marginBottom: "12px" } },
      el("div", { className: "field" }, el("label", {}, "Kategori"), catIn),
      el("div", { className: "field" }, el("label", { className: "inline-check", style: { marginTop: "28px" } }, favChk, "Favorilere Ekle"))
    ),
    el("div", { className: "field", style: { marginBottom: "12px" } }, el("label", {}, "Kişisel Notlar"), notesTa),
    el("button", {
      className: "btn-primary btn-sm",
      onclick: async () => {
        state.activeItem = await api(`/api/items/${item.id}/metadata`, {
          method: "PATCH",
          body: { favorite: favChk.checked, notes: notesTa.value, category: catIn.value, highlights },
        });
        toast("Notlar ve bilgiler kaydedildi.");
      },
    }, "Notları Kaydet")
  );

  viewRoot.replaceChildren(el("div", { className: "reader-shell" }, toolbar, articleWrap, metaPanel));
}

// =========================================================================
// VIEW 3: DISCOVER (KEŞFET & RSS)
// =========================================================================
function renderDiscover() {
  const topbar = el("div", { className: "topbar" },
    el("div", {},
      el("h1", { className: "page-title" }, "Keşfet"),
      el("p", { className: "page-subtitle" }, "Takip edilen araştırmacı blogları, AI laboratuvarları ve podcastlar (otomatik ücretli çeviri yapılmaz).")
    ),
    el("div", { className: "actions-row" },
      el("button", { className: "btn-primary", onclick: () => showAddSourceModal() }, "+ RSS Kaynağı Ekle"),
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
      }, "↻ Tümünü Yenile")
    )
  );

  const sourcesPanel = el("section", { className: "panel" },
    el("h3", {}, `Takip Edilen Kaynaklar (${state.sources.length})`),
    el("div", { className: "chips", style: { marginBottom: "12px" } },
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
    ),
    ...state.sources.filter((s) => !state.discoverSourceId || s.id === state.discoverSourceId).slice(0, 15).map((s) =>
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
                toast(`${s.name}: ${r.added} yeni yayın eklendi (${r.duplicates_skipped} tekrar atlandı).`);
                await loadDiscover();
                renderCurrentView();
              } catch (e) { toast(e.message); }
            },
          }, "↻ Yenile"),
          el("button", {
            className: "btn-sm btn-danger",
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
  );

  const unreadToggle = el("label", { className: "inline-check" },
    el("input", {
      type: "checkbox",
      ...(state.discoverUnreadOnly ? { checked: "checked" } : {}),
      onchange: (e) => { state.discoverUnreadOnly = e.target.checked; loadDiscover().then(renderCurrentView); },
    }),
    "Yalnızca okunmamış yayınlar"
  );

  const entriesPanel = el("section", { className: "panel" },
    el("div", { className: "topbar", style: { marginBottom: "10px" } },
      el("h3", { style: { margin: 0 } }, `Keşfedilen Yayınlar (${state.entries.length})`),
      unreadToggle
    ),
    !state.entries.length
      ? el("p", { className: "help-text" }, "Henüz yayın çekilmedi. Yukarıdaki kaynaklardan birini veya 'Tümünü Yenile' butonunu kullanın.")
      : el("div", {},
          ...state.entries.map((entry) =>
            el("div", { className: "list-row" },
              el("div", { style: { flex: "1 1 320px" } },
                el("div", { style: { fontWeight: entry.is_read ? 500 : 700 } }, entry.title),
                el("div", { className: "help-text" }, `${entry.source_name}${entry.published_at ? ` · ${entry.published_at.slice(0, 16)}` : ""}`),
                entry.summary ? el("p", { className: "help-text", style: { margin: "4px 0 0" } }, entry.summary.slice(0, 200)) : null
              ),
              el("div", { className: "actions-row" },
                entry.imported_item_id
                  ? el("button", { className: "btn-sm", onclick: () => openReader(entry.imported_item_id) }, "Kütüphanede Aç")
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
                    }, "+ Kütüphaneye Ekle"),
                el("button", {
                  className: "btn-ghost btn-sm",
                  onclick: async () => {
                    await api(`/api/discover/entries/${entry.id}`, { method: "PATCH", body: { is_read: !entry.is_read } });
                    await loadDiscover();
                    renderCurrentView();
                  },
                }, entry.is_read ? "Okunmadı İşaretle" : "Okundu")
              )
            )
          )
        )
  );

  viewRoot.replaceChildren(topbar, sourcesPanel, entriesPanel);
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
    el("div", { className: "form-grid", style: { marginBottom: "12px" } },
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
      el("h1", { className: "page-title" }, "Dinle & Podcast"),
      el("p", { className: "page-subtitle" }, "Podcast ses dosyalarını yerel Faster-Whisper ile transkribe edin, Türkçeye çevirin ve dinleyin.")
    ),
    el("button", { className: "btn-primary", onclick: () => showAddContentModal() }, "+ Ses / Podcast Yükle")
  );

  const listPanel = el("section", { className: "panel" },
    el("h3", {}, `Seslendirilebilir & Podcast İçerikler (${audioItems.length})`),
    !audioItems.length
      ? el("p", { className: "help-text" }, "Henüz podcast veya sesli içerik yok. Yeni bir makale ekleyin veya MP3/WAV/M4A dosyası yükleyin.")
      : el("div", {},
          ...audioItems.map((it) =>
            el("div", { className: "list-row" },
              el("div", { style: { cursor: "pointer" }, onclick: async () => { state.listenItemId = it.id; state.activeItem = await api(`/api/items/${it.id}`).catch(() => it); renderCurrentView(); } },
                el("strong", {}, it.title),
                el("div", { className: "help-text" }, `${it.kind} · ${it.audio_status === "ready" ? "Üretilmiş MP3 Hazır" : it.source_audio_path ? "Kaynak Ses Yüklü" : "Metin Hazır"}`)
              ),
              el("div", { className: "actions-row" },
                el("button", { className: "btn-primary btn-sm", onclick: () => triggerNarration(it) }, "▶ Dinle"),
                el("button", { className: "btn-sm", onclick: () => player.enqueue(it) }, "+ Kuyruk"),
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
                    }, "🎙 Transkribe Et")
                  : null
              )
            )
          )
        )
  );

  // Queue Panel
  const queuePanel = el("section", { className: "panel" },
    el("h3", {}, `Dinleme Kuyruğu (${player.queue.length})`),
    !player.queue.length
      ? el("p", { className: "help-text" }, "Kuyruk boş. İçeriklerin yanındaki '+ Kuyruk' butonuyla sıraya ekleyebilirsiniz.")
      : el("div", {},
          ...player.queue.map((q) =>
            el("div", { className: "list-row" },
              el("span", {}, q.title),
              el("button", { className: "btn-ghost btn-sm", onclick: () => player.removeFromQueue(q.id) }, "Çıkar")
            )
          )
        )
  );

  // Interactive Timestamped Transcript Panel
  let transcriptPanel = null;
  if (selected) {
    let segs = [];
    try { segs = JSON.parse(selected.transcript_json || "[]"); } catch { segs = []; }
    transcriptPanel = el("section", { className: "panel" },
      el("div", { className: "topbar", style: { marginBottom: "8px" } },
        el("h3", { style: { margin: 0 } }, `Zaman Damgalı Transkript — ${selected.title}`),
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
// VIEW 5: SETTINGS (AYARLAR, API ANAHTARLARI, SÖZLÜK, GELİŞMİŞ)
// =========================================================================
function renderSettings() {
  const s = state.settings;
  const sec = state.secrets;

  const topbar = el("div", { className: "topbar" },
    el("div", {},
      el("h1", { className: "page-title" }, "Ayarlar"),
      el("p", { className: "page-subtitle" }, "API anahtarları yerel olarak şifrelenerek saklanır (Windows DPAPI) ve hiçbir zaman tarayıcıya geri gönderilmez.")
    )
  );

  // 1. Translation Provider Panel
  const trProvSel = el("select", {},
    ...[["openrouter", "OpenRouter (Önerilen)"], ["openai", "Doğrudan OpenAI"], ["custom", "Yerel / Özel OpenAI Uyumlu"], ["mock", "Mock (Ücretsiz Test)"]].map(([k, l]) =>
      el("option", { value: k, ...(s.translation_provider === k ? { selected: "selected" } : {}) }, l)
    )
  );
  const trModelIn = el("input", { value: s.translation_model || "openai/gpt-4o-mini", placeholder: "örn. openai/gpt-4o-mini, anthropic/claude-3.5-sonnet" });
  const spendLimitIn = el("input", { type: "number", step: "0.5", value: String(s.monthly_spend_limit_usd ?? 10) });
  const orKeyIn = el("input", { type: "password", placeholder: sec.openrouter_api_key?.configured ? `Kayıtlı (${sec.openrouter_api_key.masked})` : "sk-or-v1-..." });
  const oaiKeyIn = el("input", { type: "password", placeholder: sec.openai_api_key?.configured ? `Kayıtlı (${sec.openai_api_key.masked})` : "sk-..." });
  const trTestOut = el("p", { className: "help-text" });

  const orModelDropdown = state.openrouterModels.length
    ? el("select", {
        style: { marginTop: "6px" },
        onchange: (e) => { if (e.target.value) trModelIn.value = e.target.value; },
      },
        el("option", { value: "" }, `OpenRouter Modellerinden Seç (${state.openrouterModels.length})`),
        ...state.openrouterModels.slice(0, 120).map((m) => el("option", { value: m.id }, `${m.name} (${m.id})`))
      )
    : null;

  const translationPanel = el("section", { className: "panel" },
    el("h2", {}, "Çeviri Motoru (OpenRouter / OpenAI)"),
    el("div", { className: "form-grid", style: { marginBottom: "12px" } },
      el("div", { className: "field" }, el("label", {}, "Sağlayıcı"), trProvSel),
      el("div", { className: "field" }, el("label", {}, "Model Kimliği"), trModelIn, orModelDropdown),
      el("div", { className: "field" }, el("label", {}, "Aylık Harcama Uyarı Limiti (USD)"), spendLimitIn)
    ),
    el("div", { className: "form-grid", style: { marginBottom: "12px" } },
      el("div", { className: "field" },
        el("label", {}, `OpenRouter API Anahtarı ${sec.openrouter_api_key?.configured ? "✓" : ""}`),
        orKeyIn,
        el("div", { className: "help-text" }, sec.openrouter_api_key?.configured ? `Kaynak: ${sec.openrouter_api_key.source} (${sec.openrouter_api_key.storage_backend})` : "Henüz anahtar girilmedi.")
      ),
      el("div", { className: "field" },
        el("label", {}, `OpenAI API Anahtarı ${sec.openai_api_key?.configured ? "✓" : ""}`),
        oaiKeyIn
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
      }, "OpenRouter Modellerini Getir"),
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
            trTestOut.textContent = `✓ Bağlantı başarılı: "${res.sample}"`;
          } catch (e) {
            trTestOut.textContent = `✕ Hata: ${e.message}`;
          }
        },
      }, "Bağlantıyı Test Et")
    ),
    trTestOut
  );

  // 2. Narration / ElevenLabs Panel
  const ttsProvSel = el("select", {},
    ...[["browser", "Tarayıcı Sesi (Ücretsiz)"], ["elevenlabs", "ElevenLabs (Premium)"], ["edge_tts", "Edge TTS (Alternatif Ücretsiz)"], ["mock", "Mock (Test)"]].map(([k, l]) =>
      el("option", { value: k, ...(s.tts_provider === k ? { selected: "selected" } : {}) }, l)
    )
  );
  const elKeyIn = el("input", { type: "password", placeholder: sec.elevenlabs_api_key?.configured ? `Kayıtlı (${sec.elevenlabs_api_key.masked})` : "xi-api-key..." });
  const elModelSel = el("select", {},
    ...(state.elevenModels.length ? state.elevenModels : [{ id: "eleven_flash_v2_5", name: "Eleven Flash v2.5" }, { id: "eleven_multilingual_v2", name: "Eleven Multilingual v2" }]).map((m) =>
      el("option", { value: m.id, ...(s.elevenlabs_model === m.id ? { selected: "selected" } : {}) }, m.name)
    )
  );
  const elVoiceIn = el("input", { value: s.elevenlabs_voice_id || "", placeholder: "ElevenLabs Voice ID (Bağlantı testi ile seçilebilir)" });
  const elBudgetIn = el("input", { type: "number", value: String(s.elevenlabs_char_budget ?? 10000) });
  const elStatusOut = el("p", { className: "help-text" },
    state.elevenSub ? `Plan: ${state.elevenSub.tier} · Kalan Kredi: ${state.elevenSub.remaining_characters} / ${state.elevenSub.character_limit} karakter` : ""
  );
  const sampleAudioWrap = el("div", { style: { marginTop: "8px" } });

  const voiceDropdown = state.elevenVoices.length
    ? el("select", {
        style: { marginTop: "6px" },
        onchange: (e) => { if (e.target.value) elVoiceIn.value = e.target.value; },
      },
        el("option", { value: "" }, `Hesabınızdaki Seslerden Seç (${state.elevenVoices.length})`),
        ...state.elevenVoices.map((v) => el("option", { value: v.voice_id }, `${v.name} (${v.category})`))
      )
    : null;

  const audioPanel = el("section", { className: "panel" },
    el("h2", {}, "Seslendirme (ElevenLabs ve Ücretsiz Alternatifler)"),
    el("div", { className: "form-grid", style: { marginBottom: "12px" } },
      el("div", { className: "field" }, el("label", {}, "Varsayılan Seslendirme"), ttsProvSel),
      el("div", { className: "field" }, el("label", {}, `ElevenLabs API Anahtarı ${sec.elevenlabs_api_key?.configured ? "✓" : ""}`), elKeyIn),
      el("div", { className: "field" }, el("label", {}, "ElevenLabs Modeli"), elModelSel),
      el("div", { className: "field" }, el("label", {}, "Ses (Voice ID)"), elVoiceIn, voiceDropdown),
      el("div", { className: "field" }, el("label", {}, "Yerel Karakter Güvenlik Sınırı"), elBudgetIn)
    ),
    el("div", { className: "actions-row" },
      el("button", {
        className: "btn-primary btn-sm",
        onclick: async () => {
          await api("/api/settings", {
            method: "PATCH",
            body: {
              tts_provider: ttsProvSel.value,
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
          elStatusOut.textContent = "ElevenLabs hesabı ve sesler kontrol ediliyor...";
          try {
            if (elKeyIn.value.trim()) {
              await api("/api/secrets", { method: "PUT", body: { elevenlabs_api_key: elKeyIn.value.trim() } });
            }
            const res = await api("/api/providers/elevenlabs/test", { method: "POST" });
            state.elevenSub = res.subscription;
            state.elevenVoices = res.voices || [];
            state.elevenModels = res.models || state.elevenModels;
            await loadSettingsData();
            renderCurrentView();
            toast("ElevenLabs bağlantısı başarılı.");
          } catch (e) { elStatusOut.textContent = `✕ ${e.message}`; }
        },
      }, "Bağlantı & Kredi Testi"),
      el("button", {
        className: "btn-sm",
        onclick: async () => {
          if (!elVoiceIn.value.trim()) return toast("Önce bir ElevenLabs Voice ID seçin.");
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
      }, "🔊 Örnek Türkçe Ses Testi")
    ),
    elStatusOut,
    sampleAudioWrap
  );

  // 3. Transcription (Faster-Whisper) Panel
  const wInfo = state.systemInfo?.whisper || {};
  const wModelSel = el("select", {},
    ...["tiny", "base", "small", "medium", "large-v3"].map((m) =>
      el("option", { value: m, ...(s.whisper_model === m ? { selected: "selected" } : {}) }, m)
    )
  );
  const wDevSel = el("select", {},
    ...[["cpu", "CPU (int8 — Varsayılan)"], ["auto", "Otomatik"], ["cuda", "GPU (CUDA)"]].map(([k, l]) =>
      el("option", { value: k, ...(s.whisper_device === k ? { selected: "selected" } : {}) }, l)
    )
  );
  const wAutoLang = el("input", { type: "checkbox", ...(s.whisper_auto_language ? { checked: "checked" } : {}) });
  const wAllowDl = el("input", { type: "checkbox", ...(s.whisper_allow_download ? { checked: "checked" } : {}) });

  const whisperPanel = el("section", { className: "panel" },
    el("h2", {}, "Transkripsiyon (Faster-Whisper)"),
    el("div", { className: "badges", style: { marginBottom: "12px" } },
      el("span", { className: `badge ${wInfo.faster_whisper_installed ? "ok" : "warn"}` }, wInfo.faster_whisper_installed ? "Faster-Whisper Kurulu" : "Faster-Whisper Kurulu Değil"),
      el("span", { className: `badge ${wInfo.ffmpeg_installed ? "ok" : "warn"}` }, wInfo.ffmpeg_installed ? "FFmpeg Kurulu" : "FFmpeg Eksik (Python MP3 birleştirme aktif)"),
      el("span", { className: "badge info" }, wInfo.cuda_available ? "CUDA GPU Mevcut" : "CPU Modu")
    ),
    el("div", { className: "form-grid", style: { marginBottom: "10px" } },
      el("div", { className: "field" }, el("label", {}, "Whisper Modeli"), wModelSel),
      el("div", { className: "field" }, el("label", {}, "İşlem Birimi"), wDevSel)
    ),
    el("div", { className: "actions-row", style: { marginBottom: "10px" } },
      el("label", { className: "inline-check" }, wAutoLang, "Dili otomatik algıla"),
      el("label", { className: "inline-check" }, wAllowDl, "Eksik Whisper modelini indirmeye izin ver")
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

  // 4. Technical Glossary Panel
  const gEn = el("input", { placeholder: "İngilizce terim (örn. Calibration)" });
  const gTr = el("input", { placeholder: "Türkçe karşılık (örn. Kalibrasyon)" });
  const gNote = el("input", { placeholder: "Bağlam notu (isteğe bağlı)" });

  const glossaryPanel = el("section", { className: "panel" },
    el("h2", {}, `Teknik Terminoloji Sözlüğü (${state.glossary.length} terim)`),
    el("div", { className: "form-grid", style: { marginBottom: "10px" } }, gEn, gTr, gNote),
    el("button", {
      className: "btn-primary btn-sm",
      style: { marginBottom: "12px" },
      onclick: async () => {
        if (!gEn.value.trim() || !gTr.value.trim()) return toast("İngilizce ve Türkçe terim gereklidir.");
        await api("/api/glossary", { method: "POST", body: { term_en: gEn.value.trim(), term_tr: gTr.value.trim(), context_note: gNote.value.trim() } });
        state.glossary = await api("/api/glossary");
        renderCurrentView();
        toast("Sözlük terimi kaydedildi.");
      },
    }, "+ Terim Ekle / Güncelle"),
    ...state.glossary.slice(0, 30).map((g) =>
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

  // 5. Advanced / Backup / Cache / Smoke Benchmark
  const u = state.systemInfo?.usage || {};
  const benchOut = el("p", { className: "help-text" });
  const advancedPanel = el("section", { className: "panel" },
    el("h2", {}, "Gelişmiş, Önbellek ve Yedekleme"),
    el("p", { className: "help-text" }, `Sürüm: v${state.systemInfo?.version || "0.5.0"} · Veritabanı: ${state.systemInfo?.db_path || "outputs/library.sqlite3"}`),
    el("p", { className: "help-text" }, `Çeviri Önbelleği: ${u.translation_cache_entries || 0} kayıt · Ses Önbelleği: ${u.audio_cache_entries || 0} kayıt · Çeviri çağrısı: ${u.translation?.calls || 0} · Seslendirme karakteri: ${u.narration?.chars || 0}`),
    el("div", { className: "actions-row" },
      el("button", { className: "btn-sm", onclick: () => { window.location.href = "/api/backup"; } }, "💾 SQLite Yedeği İndir"),
      el("button", {
        className: "btn-sm",
        onclick: async () => {
          const res = await api("/api/cache/clear", { method: "POST", body: { translation: true, audio: true } });
          await loadSettingsData();
          renderCurrentView();
          toast(`Önbellek temizlendi (Çeviri: ${res.translation_cache}, Ses: ${res.audio_cache}).`);
        },
      }, "🧹 Sunucu Önbelleğini Temizle"),
      el("button", {
        className: "btn-sm",
        onclick: async () => {
          await clearOfflineStore();
          toast("Tarayıcı çevrimdışı IndexedDB verisi temizlendi.");
        },
      }, "🧹 Çevrimdışı Veriyi Temizle"),
      el("button", {
        className: "btn-sm",
        onclick: async () => {
          const res = await api("/api/benchmark/smoke", { method: "POST" });
          const passed = res.rows.filter((r) => r.passed_deterministic_qa).length;
          benchOut.textContent = `Smoke Benchmark (${res.mode}): ${passed}/${res.rows.length} örnek deterministik QA'dan geçti. (Gerçek model performansı değildir.)`;
        },
      }, "🧪 Smoke Benchmark Çalıştır")
    ),
    benchOut
  );

  viewRoot.replaceChildren(topbar, translationPanel, audioPanel, whisperPanel, glossaryPanel, advancedPanel);
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
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  await Promise.all([loadLibrary(), loadSettingsData().catch(() => {})]);
  renderCurrentView();
  pollJobs();
}

boot();
