// Keychain-backed FastAPI REST client for Knowledge Hub iOS / Android / Web

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type {
  ConnectionConfig,
  DiscoverEntry,
  HealthResponse,
  JobInfo,
  LibraryItem,
} from "./types";

const KEY_SERVER_URL = "kh_server_url";
const KEY_API_TOKEN = "kh_api_token";
const KEY_THEME = "kh_theme_pref";

async function secureGet(key: string): Promise<string> {
  try {
    if (Platform.OS === "web") {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) || "" : "";
    }
    return (await SecureStore.getItemAsync(key)) || "";
  } catch {
    return "";
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      }
      return;
    }
    if (value) await SecureStore.setItemAsync(key, value);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore storage errors
  }
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export async function loadConnectionConfig(): Promise<ConnectionConfig> {
  const [serverUrl, apiToken] = await Promise.all([
    secureGet(KEY_SERVER_URL),
    secureGet(KEY_API_TOKEN),
  ]);
  return { serverUrl: normalizeBaseUrl(serverUrl), apiToken };
}

export async function saveConnectionConfig(cfg: ConnectionConfig): Promise<ConnectionConfig> {
  const clean: ConnectionConfig = {
    serverUrl: normalizeBaseUrl(cfg.serverUrl),
    apiToken: cfg.apiToken.trim(),
  };
  await Promise.all([
    secureSet(KEY_SERVER_URL, clean.serverUrl),
    secureSet(KEY_API_TOKEN, clean.apiToken),
  ]);
  return clean;
}

export async function loadThemePref(): Promise<"system" | "light" | "dark"> {
  const val = await secureGet(KEY_THEME);
  if (val === "light" || val === "dark") return val;
  return "system";
}

export async function saveThemePref(pref: "system" | "light" | "dark"): Promise<void> {
  await secureSet(KEY_THEME, pref);
}

export class KnowledgeHubApi {
  readonly baseUrl: string;
  readonly token: string;

  constructor(config: ConnectionConfig) {
    this.baseUrl = normalizeBaseUrl(config.serverUrl);
    this.token = config.apiToken.trim();
  }

  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  buildMediaUrl(path: string): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const full = `${this.baseUrl}${cleanPath}`;
    if (!this.token) return full;
    const sep = full.includes("?") ? "&" : "?";
    return `${full}${sep}token=${encodeURIComponent(this.token)}`;
  }

  private async request<T>(
    path: string,
    opts: { method?: string; body?: unknown; skipAuth?: boolean } = {}
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("Sunucu adresi ayarlanmamış. Ayarlar sekmesinden Tailscale veya sunucu adresinizi girin.");
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (!opts.skipAuth && this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (resp.status === 401) {
      throw new Error("Yetkisiz erişim (401). Ayarlar sekmesindeki KH_API_TOKEN değerini kontrol edin.");
    }
    if (!resp.ok) {
      let detail = `İstek başarısız (${resp.status})`;
      try {
        const err = (await resp.json()) as { detail?: unknown };
        if (err?.detail) {
          detail = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
        }
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(detail);
    }
    if (resp.status === 204) return undefined as unknown as T;
    return (await resp.json()) as T;
  }

  checkHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/api/health", { skipAuth: true });
  }

  listItems(): Promise<LibraryItem[]> {
    return this.request<LibraryItem[]>("/api/items");
  }

  getItem(id: string): Promise<LibraryItem> {
    return this.request<LibraryItem>(`/api/items/${encodeURIComponent(id)}`);
  }

  importUrl(url: string): Promise<LibraryItem> {
    return this.request<LibraryItem>("/api/import-url", {
      method: "POST",
      body: { url: url.trim() },
    });
  }

  translateItem(id: string, mode: "faithful" | "explained" | "summary" = "faithful", force = false): Promise<JobInfo> {
    return this.request<JobInfo>(`/api/items/${encodeURIComponent(id)}/translate`, {
      method: "POST",
      body: { mode, force, async_job: true },
    });
  }

  narrateItem(id: string, provider: "edge_tts" | "supertonic" | "elevenlabs" = "edge_tts"): Promise<JobInfo> {
    return this.request<JobInfo>(`/api/items/${encodeURIComponent(id)}/narrate`, {
      method: "POST",
      body: { provider, async_job: true },
    });
  }

  generatePodcast(id: string, length: "short" | "medium" = "medium"): Promise<JobInfo> {
    return this.request<JobInfo>(`/api/items/${encodeURIComponent(id)}/podcast`, {
      method: "POST",
      body: { length, tts_provider: "edge_tts", async_job: true },
    });
  }

  updateProgress(id: string, position: number): Promise<LibraryItem> {
    return this.request<LibraryItem>(`/api/items/${encodeURIComponent(id)}/progress`, {
      method: "PATCH",
      body: { position },
    });
  }

  updateAudioProgress(id: string, positionSec: number, durationSec: number): Promise<LibraryItem> {
    return this.request<LibraryItem>(`/api/items/${encodeURIComponent(id)}/audio-progress`, {
      method: "PATCH",
      body: { position_sec: positionSec, duration_sec: durationSec },
    });
  }

  toggleFavorite(item: LibraryItem): Promise<LibraryItem> {
    return this.request<LibraryItem>(`/api/items/${encodeURIComponent(item.id)}/metadata`, {
      method: "PATCH",
      body: {
        favorite: !item.favorite,
        notes: item.notes || "",
        category: item.category || "",
      },
    });
  }

  listDiscoverEntries(unreadOnly = false): Promise<DiscoverEntry[]> {
    return this.request<DiscoverEntry[]>(`/api/discover/entries?unread_only=${unreadOnly ? "true" : "false"}`);
  }

  refreshAllSources(): Promise<Array<{ ok: boolean }>> {
    return this.request<Array<{ ok: boolean }>>("/api/sources/refresh-all", { method: "POST" });
  }

  importDiscoverEntry(entryId: string): Promise<LibraryItem> {
    return this.request<LibraryItem>(`/api/discover/entries/${encodeURIComponent(entryId)}/import`, {
      method: "POST",
    });
  }

  listJobs(): Promise<JobInfo[]> {
    return this.request<JobInfo[]>("/api/jobs");
  }
}
