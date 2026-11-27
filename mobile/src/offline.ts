// Real iOS/Android filesystem offline storage (articles + MP3 audio) via Expo SDK 58 FileSystem

import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import type { KnowledgeHubApi } from "./api";
import type { LibraryItem } from "./types";

function getOfflineDir(): Directory | null {
  if (Platform.OS === "web") return null;
  const dir = new Directory(Paths.document, "kh_offline");
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export async function saveItemOffline(item: LibraryItem, api: KnowledgeHubApi): Promise<{ hasAudio: boolean }> {
  const dir = getOfflineDir();
  if (!dir) return { hasAudio: false };

  const jsonFile = new File(dir, `${item.id}.json`);
  jsonFile.write(JSON.stringify(item));

  let hasAudio = false;
  if (item.audio_path && item.audio_status === "ready") {
    const ext = item.audio_path.toLowerCase().endsWith(".wav") ? ".wav" : ".mp3";
    const audioFile = new File(dir, `${item.id}${ext}`);
    const url = api.buildMediaUrl(`/api/items/${encodeURIComponent(item.id)}/audio`);
    await File.downloadFileAsync(url, audioFile, { idempotent: true });
    hasAudio = audioFile.exists;
  }
  return { hasAudio };
}

export async function getOfflineItem(id: string): Promise<LibraryItem | null> {
  const dir = getOfflineDir();
  if (!dir) return null;
  try {
    const jsonFile = new File(dir, `${id}.json`);
    if (!jsonFile.exists) return null;
    const raw = await jsonFile.text();
    return JSON.parse(raw) as LibraryItem;
  } catch {
    return null;
  }
}

export function getOfflineAudioUri(id: string): string | null {
  const dir = getOfflineDir();
  if (!dir) return null;
  for (const ext of [".mp3", ".wav"]) {
    const f = new File(dir, `${id}${ext}`);
    if (f.exists) return f.uri;
  }
  return null;
}

export async function listOfflineItems(): Promise<LibraryItem[]> {
  const dir = getOfflineDir();
  if (!dir) return [];
  const items: LibraryItem[] = [];
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.endsWith(".json")) {
      try {
        const raw = await entry.text();
        items.push(JSON.parse(raw) as LibraryItem);
      } catch {
        // skip corrupted entry
      }
    }
  }
  return items;
}

export function listOfflineIds(): Set<string> {
  const dir = getOfflineDir();
  const ids = new Set<string>();
  if (!dir) return ids;
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.endsWith(".json")) {
      ids.add(entry.name.slice(0, -5));
    }
  }
  return ids;
}

export function clearOfflineCache(): void {
  const dir = getOfflineDir();
  if (!dir || !dir.exists) return;
  for (const entry of dir.list()) {
    try {
      entry.delete();
    } catch {
      // ignore individual delete failures
    }
  }
}
