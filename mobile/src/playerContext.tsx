// Global native iOS background audio player with Lock Screen controls, seek, speed & progress sync

import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as Haptics from "expo-haptics";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Pause, Play, RotateCcw, RotateCw, X } from "lucide-react-native";

import type { KnowledgeHubApi } from "./api";
import { getOfflineAudioUri } from "./offline";
import type { Palette } from "./theme";
import type { LibraryItem } from "./types";

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

interface PlayerContextValue {
  currentItem: LibraryItem | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  playItem: (item: LibraryItem) => Promise<void>;
  togglePlay: () => void;
  seekBy: (deltaSec: number) => void;
  seekTo: (sec: number) => void;
  cycleSpeed: () => void;
  stop: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({
  api,
  children,
}: {
  api: KnowledgeHubApi;
  children: React.ReactNode;
}) {
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const [currentItem, setCurrentItem] = useState<LibraryItem | null>(null);
  const [speedIdx, setSpeedIdx] = useState(0);
  const lastSyncRef = useRef(0);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    }).catch(() => {});
  }, []);

  // Periodic playback position sync back to FastAPI
  useEffect(() => {
    if (!currentItem || !status.playing || !api.configured) return;
    const now = Date.now();
    if (now - lastSyncRef.current > 6000) {
      lastSyncRef.current = now;
      api
        .updateAudioProgress(currentItem.id, status.currentTime || 0, status.duration || currentItem.audio_duration_sec || 0)
        .catch(() => {});
    }
  }, [api, currentItem, status.currentTime, status.duration, status.playing]);

  const playItem = useCallback(
    async (item: LibraryItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const offlineUri = getOfflineAudioUri(item.id);
      const uri = offlineUri || api.buildMediaUrl(`/api/items/${encodeURIComponent(item.id)}/audio`);
      setCurrentItem(item);
      player.replace({ uri });
      player.setPlaybackRate(SPEEDS[speedIdx], "high");
      try {
        player.setActiveForLockScreen(
          true,
          {
            title: item.title,
            artist: item.author || item.audio_provider || "Knowledge Hub",
            albumTitle: item.category || "Kütüphanem",
          },
          { showSeekBackward: true, showSeekForward: true }
        );
      } catch {
        // Lock screen controls unavailable on web/simulator
      }
      if (item.audio_position_sec && item.audio_position_sec > 2) {
        player.seekTo(item.audio_position_sec).catch(() => {});
      }
      player.play();
    },
    [api, player, speedIdx]
  );

  const togglePlay = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    if (status.playing) {
      player.pause();
      if (currentItem && api.configured) {
        api
          .updateAudioProgress(currentItem.id, status.currentTime || 0, status.duration || 0)
          .catch(() => {});
      }
    } else {
      player.play();
    }
  }, [api, currentItem, player, status.currentTime, status.duration, status.playing]);

  const seekBy = useCallback(
    (deltaSec: number) => {
      Haptics.selectionAsync().catch(() => {});
      const dur = status.duration || currentItem?.audio_duration_sec || Infinity;
      const target = Math.max(0, Math.min(dur, (status.currentTime || 0) + deltaSec));
      player.seekTo(target).catch(() => {});
    },
    [currentItem, player, status.currentTime, status.duration]
  );

  const seekTo = useCallback(
    (sec: number) => {
      player.seekTo(Math.max(0, sec)).catch(() => {});
      if (!status.playing) player.play();
    },
    [player, status.playing]
  );

  const cycleSpeed = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    const nextIdx = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(nextIdx);
    player.setPlaybackRate(SPEEDS[nextIdx], "high");
  }, [player, speedIdx]);

  const stop = useCallback(() => {
    player.pause();
    try {
      player.clearLockScreenControls();
    } catch {
      // ignore
    }
    setCurrentItem(null);
  }, [player]);

  return (
    <PlayerContext.Provider
      value={{
        currentItem,
        playing: status.playing,
        currentTime: status.currentTime || 0,
        duration: status.duration || currentItem?.audio_duration_sec || 0,
        speed: SPEEDS[speedIdx],
        playItem,
        togglePlay,
        seekBy,
        seekTo,
        cycleSpeed,
        stop,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

export function MiniPlayer({ palette }: { palette: Palette }) {
  const { currentItem, playing, currentTime, duration, speed, togglePlay, seekBy, cycleSpeed, stop } = usePlayer();
  if (!currentItem) return null;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <View style={[styles.dock, { backgroundColor: palette.bgElevated, borderTopColor: palette.border }]}>
      <View style={[styles.progressTrack, { backgroundColor: palette.bgSubtle }]}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: palette.accent }]} />
      </View>
      <View style={styles.row}>
        <View style={styles.meta}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
            {currentItem.title}
          </Text>
          <Text numberOfLines={1} style={[styles.sub, { color: palette.textMuted }]}>
            {formatTime(currentTime)} / {formatTime(duration)} · {currentItem.audio_provider || "Ses"}
          </Text>
        </View>
        <View style={styles.controls}>
          <Pressable onPress={cycleSpeed} hitSlop={8} style={styles.speedBtn}>
            <Text style={[styles.speedText, { color: palette.textMuted }]}>{speed}×</Text>
          </Pressable>
          <Pressable onPress={() => seekBy(-15)} hitSlop={8} style={styles.iconBtn}>
            <RotateCcw size={18} color={palette.textMuted} strokeWidth={1.7} />
          </Pressable>
          <Pressable
            onPress={togglePlay}
            style={[styles.playCircle, { backgroundColor: palette.text }]}
            accessibilityLabel={playing ? "Duraklat" : "Oynat"}
          >
            {playing ? (
              <Pause size={16} color={palette.bg} fill={palette.bg} />
            ) : (
              <Play size={16} color={palette.bg} fill={palette.bg} />
            )}
          </Pressable>
          <Pressable onPress={() => seekBy(30)} hitSlop={8} style={styles.iconBtn}>
            <RotateCw size={18} color={palette.textMuted} strokeWidth={1.7} />
          </Pressable>
          <Pressable onPress={stop} hitSlop={8} style={styles.iconBtn}>
            <X size={17} color={palette.textDim} strokeWidth={1.7} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  progressTrack: {
    height: 2.5,
    width: "100%",
  },
  progressFill: {
    height: "100%",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 13.5,
    fontWeight: "600",
  },
  sub: {
    fontSize: 11.5,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  speedBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  speedText: {
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  iconBtn: {
    padding: 4,
  },
  playCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
