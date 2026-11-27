import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Mic, Play } from "lucide-react-native";

import type { KnowledgeHubApi } from "../api";
import { formatTime, usePlayer } from "../playerContext";
import { FONTS, type Palette } from "../theme";
import type { LibraryItem, TranscriptSegment } from "../types";

export function ListenScreen({
  api,
  palette,
  items,
  refreshing,
  onRefresh,
  onJobStarted,
}: {
  api: KnowledgeHubApi;
  palette: Palette;
  items: LibraryItem[];
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onJobStarted: (msg: string) => void;
}) {
  const { currentItem, currentTime, playItem, seekTo } = usePlayer();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const audioItems = useMemo(
    () => items.filter((x) => x.kind === "podcast" || x.audio_status === "ready" || x.source_audio_path || x.translated),
    [items]
  );

  const selected = useMemo(
    () => audioItems.find((x) => x.id === (selectedId || currentItem?.id)) || audioItems[0] || null,
    [audioItems, currentItem?.id, selectedId]
  );

  const transcript: TranscriptSegment[] = useMemo(() => {
    if (!selected?.transcript_json) return [];
    try {
      return JSON.parse(selected.transcript_json) as TranscriptSegment[];
    } catch {
      return [];
    }
  }, [selected?.transcript_json]);

  async function handlePlayOrNarrate(item: LibraryItem) {
    setSelectedId(item.id);
    if (item.audio_path && item.audio_status === "ready") {
      await playItem(item);
      return;
    }
    try {
      await api.narrateItem(item.id, "edge_tts");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onJobStarted("Türkçe seslendirme başlatıldı.");
    } catch (e) {
      Alert.alert("Seslendirme Hatası", e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePodcast(item: LibraryItem) {
    setSelectedId(item.id);
    try {
      await api.generatePodcast(item.id, "medium");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onJobStarted("Emel & Ahmet 2 kişilik Türkçe podcast üretimi başlatıldı.");
    } catch (e) {
      Alert.alert("Podcast Hatası", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.pageTitle, { color: palette.text }]}>Dinle</Text>
        <Text style={[styles.pageSub, { color: palette.textMuted }]}>
          Sesli makaleler, YouTube transkriptleri ve 2 kişilik Türkçe podcastler
        </Text>
      </View>

      <FlatList
        data={audioItems}
        keyExtractor={(x) => x.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={[styles.empty, { borderColor: palette.borderStrong }]}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>Henüz sesli içerik yok</Text>
            <Text style={[styles.emptySub, { color: palette.textMuted }]}>
              Kütüphanem sekmesinden bir makale veya YouTube videosu ekleyip seslendirebilirsin.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const ready = item.audio_status === "ready";
          return (
            <Pressable
              onPress={() => setSelectedId(item.id)}
              style={[
                styles.row,
                {
                  borderBottomColor: palette.border,
                  backgroundColor: selected?.id === item.id ? palette.bgSubtle : "transparent",
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={[styles.title, { color: palette.text }]}>
                  {item.title}
                </Text>
                <Text style={[styles.meta, { color: palette.textMuted }]}>
                  {ready ? `Ses hazır (${item.audio_provider || "TTS"})` : "Seslendirmeye hazır"}
                </Text>
              </View>
              <View style={styles.actions}>
                <Pressable onPress={() => handlePlayOrNarrate(item)} style={[styles.playBtn, { backgroundColor: palette.accent }]}>
                  <Play size={14} color={palette.onAccent} fill={palette.onAccent} />
                  <Text style={[styles.playText, { color: palette.onAccent }]}>Dinle</Text>
                </Pressable>
                <Pressable
                  onPress={() => handlePodcast(item)}
                  style={[styles.podBtn, { borderColor: palette.borderStrong, backgroundColor: palette.bgElevated }]}
                >
                  <Mic size={14} color={palette.text} />
                </Pressable>
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          transcript.length > 0 ? (
            <View style={[styles.transcriptBox, { borderTopColor: palette.border }]}>
              <Text style={[styles.sectionTitle, { color: palette.text }]}>Zaman Damgalı Transkript</Text>
              <ScrollView nestedScrollEnabled style={{ maxHeight: 320 }}>
                {transcript.map((seg, idx) => {
                  const active = currentItem?.id === selected?.id && currentTime >= seg.start && currentTime < seg.end;
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => seekTo(seg.start)}
                      style={[
                        styles.trLine,
                        active && { backgroundColor: palette.accentSoft, borderLeftColor: palette.accent, borderLeftWidth: 2.5 },
                      ]}
                    >
                      <Text style={[styles.ts, { color: palette.accent }]}>{formatTime(seg.start)}</Text>
                      <Text style={[styles.trText, { color: palette.text }]}>{seg.text}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14 },
  pageTitle: { fontFamily: FONTS.serif, fontSize: 28, fontWeight: "600", letterSpacing: -0.5 },
  pageSub: { fontSize: 13, marginTop: 2 },
  listContent: { paddingHorizontal: 18, paddingBottom: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    borderRadius: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: FONTS.serif, fontSize: 16.5, fontWeight: "600", lineHeight: 22, marginBottom: 3 },
  meta: { fontSize: 12.5 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  playText: { fontSize: 12.5, fontWeight: "600" },
  podBtn: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  transcriptBox: { marginTop: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 15, fontWeight: "600", marginBottom: 10 },
  trLine: { flexDirection: "row", gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 7 },
  ts: { width: 46, fontSize: 12, fontFamily: FONTS.mono, fontVariant: ["tabular-nums"] },
  trText: { flex: 1, fontSize: 13.5, lineHeight: 20 },
  empty: {
    marginTop: 24,
    padding: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
  },
  emptyTitle: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: "600", marginBottom: 6 },
  emptySub: { fontSize: 13.5, textAlign: "center", lineHeight: 20 },
});
