// Global native iOS background audio player with Lock Screen controls, expandable Now Playing sheet,
// interactive scrub bar, 15s/30s seek, playback speed, live transcript, and progress sync.

import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as Haptics from "expo-haptics";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronDown, Headphones, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react-native";

import type { KnowledgeHubApi } from "./api";
import { getOfflineAudioUri } from "./offline";
import { FONTS, type Palette } from "./theme";
import type { LibraryItem, TranscriptSegment } from "./types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

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
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  playItem: (item: LibraryItem) => Promise<void>;
  togglePlay: () => void;
  seekBy: (deltaSec: number) => void;
  seekTo: (sec: number) => void;
  setSpeed: (rate: number) => void;
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
  const player = useAudioPlayer(null, { updateInterval: 400 });
  const status = useAudioPlayerStatus(player);
  const [currentItem, setCurrentItem] = useState<LibraryItem | null>(null);
  const [speed, setSpeedState] = useState<number>(1);
  const [expanded, setExpanded] = useState(false);
  const lastSyncRef = useRef(0);

  const configureAudioSession = useCallback(async () => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: "doNotMix",
      });
    } catch {
      // ignore on web
    }
  }, []);

  useEffect(() => {
    configureAudioSession();
  }, [configureAudioSession]);

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
      await configureAudioSession();
      const offlineUri = getOfflineAudioUri(item.id);
      const uri = offlineUri || api.buildMediaUrl(`/api/items/${encodeURIComponent(item.id)}/audio`);
      setCurrentItem(item);
      player.replace({ uri });
      player.setPlaybackRate(speed, "high");
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
        // Lock screen controls unavailable on web/Expo Go sandbox
      }
      if (item.audio_position_sec && item.audio_position_sec > 2) {
        player.seekTo(item.audio_position_sec).catch(() => {});
      }
      player.play();
    },
    [api, configureAudioSession, player, speed]
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
      configureAudioSession().then(() => player.play());
    }
  }, [api, configureAudioSession, currentItem, player, status.currentTime, status.duration, status.playing]);

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
      Haptics.selectionAsync().catch(() => {});
      const dur = status.duration || currentItem?.audio_duration_sec || Infinity;
      const clamped = Math.max(0, Math.min(dur, sec));
      player.seekTo(clamped).catch(() => {});
      if (!status.playing) player.play();
    },
    [currentItem, player, status.duration, status.playing]
  );

  const setSpeed = useCallback(
    (rate: number) => {
      Haptics.selectionAsync().catch(() => {});
      setSpeedState(rate);
      player.setPlaybackRate(rate, "high");
    },
    [player]
  );

  const cycleSpeed = useCallback(() => {
    const idx = SPEEDS.findIndex((s) => s === speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
  }, [setSpeed, speed]);

  const stop = useCallback(() => {
    player.pause();
    try {
      player.clearLockScreenControls();
    } catch {
      // ignore
    }
    setExpanded(false);
    setCurrentItem(null);
  }, [player]);

  return (
    <PlayerContext.Provider
      value={{
        currentItem,
        playing: status.playing,
        currentTime: status.currentTime || 0,
        duration: status.duration || currentItem?.audio_duration_sec || 0,
        speed,
        expanded,
        setExpanded,
        playItem,
        togglePlay,
        seekBy,
        seekTo,
        setSpeed,
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
  const {
    currentItem,
    playing,
    currentTime,
    duration,
    speed,
    expanded,
    setExpanded,
    togglePlay,
    seekBy,
    seekTo,
    setSpeed,
    cycleSpeed,
    stop,
  } = usePlayer();
  const [barWidth, setBarWidth] = useState(1);

  const transcript: TranscriptSegment[] = useMemo(() => {
    if (!currentItem?.transcript_json) return [];
    try {
      return JSON.parse(currentItem.transcript_json) as TranscriptSegment[];
    } catch {
      return [];
    }
  }, [currentItem?.transcript_json]);

  if (!currentItem) return null;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const remaining = Math.max(0, duration - currentTime);

  function handleScrub(e: GestureResponderEvent) {
    if (!duration || barWidth <= 1) return;
    const x = Math.max(0, Math.min(barWidth, e.nativeEvent.locationX));
    seekTo((x / barWidth) * duration);
  }

  return (
    <>
      <View style={[styles.dock, { backgroundColor: palette.bgElevated, borderTopColor: palette.border }]}>
        <View style={[styles.progressTrack, { backgroundColor: palette.bgSubtle }]}>
          <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: palette.accent }]} />
        </View>
        <View style={styles.row}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setExpanded(true);
            }}
            style={styles.meta}
          >
            <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
              {currentItem.title}
            </Text>
            <Text numberOfLines={1} style={[styles.sub, { color: palette.textMuted }]}>
              {formatTime(currentTime)} / {formatTime(duration)} · Dokun ve büyüt
            </Text>
          </Pressable>
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

      {/* Expandable Full-Screen Editorial Now Playing Sheet */}
      <Modal visible={expanded} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setExpanded(false)}>
        <SafeAreaView style={[styles.sheetRoot, { backgroundColor: palette.bg }]} edges={["top", "bottom"]}>
          <View style={[styles.sheetHeader, { borderBottomColor: palette.border }]}>
            <Pressable onPress={() => setExpanded(false)} hitSlop={12} style={styles.sheetCloseBtn}>
              <ChevronDown size={24} color={palette.text} strokeWidth={1.8} />
            </Pressable>
            <Text style={[styles.sheetHeaderLabel, { color: palette.textMuted }]}>ŞİMDİ DİNLENİYOR</Text>
            <Pressable onPress={stop} hitSlop={12} style={styles.sheetCloseBtn}>
              <X size={20} color={palette.textMuted} strokeWidth={1.8} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetScroll}>
            <View style={[styles.coverCard, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}>
              <View style={[styles.coverIconWrap, { backgroundColor: palette.accentSoft }]}>
                <Headphones size={26} color={palette.accent} strokeWidth={1.7} />
              </View>
              <Text style={[styles.coverKicker, { color: palette.accent }]}>
                {(currentItem.category || currentItem.kind || "SESLİ İÇERİK").toUpperCase()} ·{" "}
                {currentItem.audio_provider === "podcast_edge" ? "2 KİŞİLİK PODCAST" : "TÜRKÇE SESLENDİRME"}
              </Text>
              <Text style={[styles.coverTitle, { color: palette.text }]}>{currentItem.title}</Text>
              {Boolean(currentItem.author) && (
                <Text style={[styles.coverAuthor, { color: palette.textMuted }]}>{currentItem.author}</Text>
              )}
            </View>

            {/* Interactive Scrubbing Timeline */}
            <View style={styles.scrubberWrap}>
              <View
                onLayout={(e) => setBarWidth(Math.max(1, e.nativeEvent.layout.width))}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={handleScrub}
                onResponderMove={handleScrub}
                style={styles.scrubTouchArea}
              >
                <View style={[styles.scrubTrack, { backgroundColor: palette.bgSubtle }]}>
                  <View style={[styles.scrubFill, { width: `${pct}%`, backgroundColor: palette.accent }]} />
                  <View
                    style={[
                      styles.scrubThumb,
                      {
                        left: `${pct}%`,
                        backgroundColor: palette.accent,
                        borderColor: palette.bg,
                      },
                    ]}
                  />
                </View>
              </View>
              <View style={styles.timeRow}>
                <Text style={[styles.timeText, { color: palette.textMuted }]}>{formatTime(currentTime)}</Text>
                <Text style={[styles.timeText, { color: palette.textMuted }]}>-{formatTime(remaining)}</Text>
              </View>
            </View>

            {/* Large Tactile Transport Controls */}
            <View style={styles.transportRow}>
              <Pressable onPress={() => seekBy(-15)} hitSlop={12} style={styles.skipBigBtn}>
                <RotateCcw size={28} color={palette.text} strokeWidth={1.6} />
                <Text style={[styles.skipBigText, { color: palette.textMuted }]}>15 sn</Text>
              </Pressable>

              <Pressable
                onPress={togglePlay}
                style={[styles.playBigCircle, { backgroundColor: palette.accent }]}
                accessibilityLabel={playing ? "Duraklat" : "Oynat"}
              >
                {playing ? (
                  <Pause size={28} color={palette.onAccent} fill={palette.onAccent} />
                ) : (
                  <Play size={28} color={palette.onAccent} fill={palette.onAccent} style={{ marginLeft: 3 }} />
                )}
              </Pressable>

              <Pressable onPress={() => seekBy(30)} hitSlop={12} style={styles.skipBigBtn}>
                <RotateCw size={28} color={palette.text} strokeWidth={1.6} />
                <Text style={[styles.skipBigText, { color: palette.textMuted }]}>30 sn</Text>
              </Pressable>
            </View>

            {/* Speed Selector Pills */}
            <View style={styles.speedRow}>
              {SPEEDS.map((s) => {
                const active = speed === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setSpeed(s)}
                    style={[
                      styles.speedPill,
                      {
                        backgroundColor: active ? palette.text : palette.bgElevated,
                        borderColor: active ? palette.text : palette.border,
                      },
                    ]}
                  >
                    <Text style={[styles.speedPillText, { color: active ? palette.bg : palette.textMuted }]}>
                      {s}×
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Live Clickable Transcript / Podcast Dialogue */}
            {transcript.length > 0 && (
              <View style={[styles.trSection, { borderTopColor: palette.border }]}>
                <Text style={[styles.trHeading, { color: palette.textMuted }]}>KONUŞMA METNİ</Text>
                {transcript.map((seg, idx) => {
                  const active = currentTime >= seg.start && currentTime < seg.end;
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => seekTo(seg.start)}
                      style={[
                        styles.trRow,
                        active && { backgroundColor: palette.accentSoft, borderLeftColor: palette.accent, borderLeftWidth: 2.5 },
                      ]}
                    >
                      <Text style={[styles.trTime, { color: palette.accent }]}>{formatTime(seg.start)}</Text>
                      <Text style={[styles.trBody, { color: palette.text }]}>{seg.text}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
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
  sheetRoot: { flex: 1 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetCloseBtn: { padding: 4 },
  sheetHeaderLabel: { fontSize: 11.5, fontWeight: "700", letterSpacing: 1 },
  sheetScroll: { padding: 22, paddingBottom: 48 },
  coverCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    marginBottom: 28,
  },
  coverIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  coverKicker: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  coverTitle: {
    fontFamily: FONTS.serif,
    fontSize: 23,
    fontWeight: "600",
    lineHeight: 30,
    marginBottom: 8,
  },
  coverAuthor: { fontSize: 14 },
  scrubberWrap: { marginBottom: 24 },
  scrubTouchArea: { paddingVertical: 14 },
  scrubTrack: {
    height: 6,
    borderRadius: 3,
    position: "relative",
    justifyContent: "center",
  },
  scrubFill: {
    height: 6,
    borderRadius: 3,
  },
  scrubThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    marginLeft: -9,
    borderWidth: 2,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  timeText: {
    fontSize: 12.5,
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
  },
  transportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 38,
    marginBottom: 28,
  },
  skipBigBtn: { alignItems: "center", gap: 4 },
  skipBigText: { fontSize: 11.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  playBigCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  speedRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 28,
  },
  speedPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  speedPillText: {
    fontSize: 12.5,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  trSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
  },
  trHeading: {
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  trRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  trTime: {
    width: 46,
    fontSize: 12,
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
  },
  trBody: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
  },
});
