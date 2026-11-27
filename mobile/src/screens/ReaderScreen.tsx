import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { ArrowLeft, CloudDownload, Headphones, Languages, Mic, MoreHorizontal, Type, X } from "lucide-react-native";

import type { KnowledgeHubApi } from "../api";
import { getOfflineItem, saveItemOffline } from "../offline";
import { usePlayer } from "../playerContext";
import { FONTS, type Palette, type ThemeMode } from "../theme";
import type { LibraryItem } from "../types";

type ReaderTab = "tr" | "bilingual" | "original";

function parseBlocks(text: string): Array<{ kind: "code" | "heading" | "quote" | "para"; body: string }> {
  if (!text) return [];
  const parts = text.split(/(```[\s\S]*?```)/g);
  const out: Array<{ kind: "code" | "heading" | "quote" | "para"; body: string }> = [];
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (t.startsWith("```") && t.endsWith("```")) {
      const nl = t.indexOf("\n");
      const code = nl > -1 ? t.slice(nl + 1, -3) : t.slice(3, -3);
      out.push({ kind: "code", body: code.trim() });
      continue;
    }
    for (const para of t.split(/\n\s*\n/)) {
      const p = para.trim();
      if (!p) continue;
      if (/^#{1,4}\s+/.test(p)) {
        out.push({ kind: "heading", body: p.replace(/^#{1,4}\s+/, "") });
      } else if (p.startsWith(">")) {
        out.push({ kind: "quote", body: p.replace(/^>\s?/gm, "") });
      } else {
        out.push({ kind: "para", body: p.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1") });
      }
    }
  }
  return out;
}

export function ReaderScreen({
  api,
  palette,
  initialItem,
  themeMode,
  onSetThemeMode,
  onBack,
  onJobStarted,
  onOfflineChanged,
}: {
  api: KnowledgeHubApi;
  palette: Palette;
  initialItem: LibraryItem;
  themeMode: ThemeMode;
  onSetThemeMode: (mode: ThemeMode) => void;
  onBack: () => void;
  onJobStarted: (message: string) => void;
  onOfflineChanged: () => void;
}) {
  const { playItem } = usePlayer();
  const [item, setItem] = useState<LibraryItem>(initialItem);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ReaderTab>(initialItem.translated && initialItem.mode !== "demo" ? "tr" : "original");
  const [fontSize, setFontSize] = useState(18.5);
  const [fontFamily, setFontFamily] = useState<"serif" | "sans">("serif");
  const [scrollPct, setScrollPct] = useState(0);
  const [typoOpen, setTypoOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [savingOffline, setSavingOffline] = useState(false);
  const lastSyncPctRef = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const fresh = await api.getItem(initialItem.id);
        if (!alive) return;
        setItem(fresh);
        if (fresh.translated && fresh.mode !== "demo") setTab("tr");
      } catch {
        const cached = await getOfflineItem(initialItem.id);
        if (alive && cached) setItem(cached);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, initialItem.id]);

  const blocks = useMemo(() => {
    const src = tab === "tr" ? item.translated || "" : item.original || "";
    return parseBlocks(src);
  }, [item.original, item.translated, tab]);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const maxY = Math.max(1, contentSize.height - layoutMeasurement.height);
    const pct = Math.max(0, Math.min(1, contentOffset.y / maxY));
    setScrollPct(pct);
    if (Math.abs(pct - lastSyncPctRef.current) > 0.08 && api.configured) {
      lastSyncPctRef.current = pct;
      api.updateProgress(item.id, Number(pct.toFixed(2))).catch(() => {});
    }
  }

  async function handleTranslate(mode: "faithful" | "explained" | "summary" = "faithful") {
    setActionsOpen(false);
    try {
      await api.translateItem(item.id, mode, Boolean(item.translated));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onJobStarted("Türkçe çeviri başlatıldı.");
    } catch (e) {
      Alert.alert("Çeviri Başlatılamadı", e instanceof Error ? e.message : String(e));
    }
  }

  async function handleListen() {
    if (item.audio_path && item.audio_status === "ready") {
      await playItem(item);
      return;
    }
    try {
      await api.narrateItem(item.id, "edge_tts");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onJobStarted("Doğal Türkçe (Edge Neural) seslendirme başlatıldı.");
    } catch (e) {
      Alert.alert("Seslendirme Hatası", e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePodcast() {
    setActionsOpen(false);
    try {
      await api.generatePodcast(item.id, "medium");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onJobStarted("Emel & Ahmet 2 kişilik Türkçe podcast üretimi başlatıldı.");
    } catch (e) {
      Alert.alert("Podcast Hatası", e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSaveOffline() {
    setSavingOffline(true);
    try {
      const res = await saveItemOffline(item, api);
      onOfflineChanged();
      setActionsOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(
        "Çevrimdışı Kaydedildi",
        res.hasAudio ? "Makale metni ve ses dosyası telefonuna indirildi." : "Makale metni telefonuna kaydedildi."
      );
    } catch (e) {
      Alert.alert("İndirme Hatası", e instanceof Error ? e.message : String(e));
    } finally {
      setSavingOffline(false);
    }
  }

  const bodyFont = fontFamily === "serif" ? FONTS.serif : FONTS.sans;

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={[styles.progressTrack, { backgroundColor: "transparent" }]}>
        <View style={[styles.progressFill, { width: `${Math.round(scrollPct * 100)}%`, backgroundColor: palette.accent }]} />
      </View>

      <View style={[styles.topBar, { borderBottomColor: palette.border, backgroundColor: palette.bg }]}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <ArrowLeft size={19} color={palette.text} strokeWidth={1.8} />
          <Text style={[styles.backText, { color: palette.text }]}>Kütüphane</Text>
        </Pressable>
        <View style={styles.topActions}>
          <Pressable onPress={handleListen} hitSlop={8} style={styles.topIconBtn}>
            <Headphones size={18} color={palette.text} strokeWidth={1.75} />
          </Pressable>
          <Pressable onPress={() => setTypoOpen(true)} hitSlop={8} style={styles.topIconBtn}>
            <Type size={18} color={palette.text} strokeWidth={1.75} />
          </Pressable>
          <Pressable onPress={() => setActionsOpen(true)} hitSlop={8} style={styles.topIconBtn}>
            <MoreHorizontal size={19} color={palette.text} strokeWidth={1.75} />
          </Pressable>
        </View>
      </View>

      <View style={[styles.segWrap, { backgroundColor: palette.bgSubtle, borderColor: palette.border }]}>
        {(
          [
            ["tr", "Türkçe"],
            ["bilingual", "İki Dilli"],
            ["original", "Orijinal"],
          ] as Array<[ReaderTab, string]>
        ).map(([k, lbl]) => {
          const active = tab === k;
          return (
            <Pressable
              key={k}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setTab(k);
              }}
              style={[styles.segBtn, active && { backgroundColor: palette.bgElevated }]}
            >
              <Text style={[styles.segText, { color: active ? palette.text : palette.textMuted, fontWeight: active ? "600" : "500" }]}>
                {lbl}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView onScroll={handleScroll} scrollEventThrottle={32} contentContainerStyle={styles.articleContent}>
        <Text style={[styles.articleTitle, { color: palette.text }]}>{item.title}</Text>
        <Text style={[styles.byline, { color: palette.textMuted }]}>
          {[item.author, item.published_at?.slice(0, 10), `${item.reading_minutes || 1} dk okuma`].filter(Boolean).join(" · ")}
        </Text>
        <View style={[styles.rule, { backgroundColor: palette.border }]} />

        {loading && !item.original ? (
          <ActivityIndicator color={palette.accent} style={{ marginTop: 40 }} />
        ) : tab === "tr" && !item.translated ? (
          <View style={[styles.emptyTr, { borderColor: palette.borderStrong }]}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>Henüz Türkçeye çevrilmedi</Text>
            <Text style={[styles.emptySub, { color: palette.textMuted }]}>
              Kod blokları ve özel terimler korunarak doğal Türkçeye çevirmek için dokun.
            </Text>
            <Pressable onPress={() => handleTranslate("faithful")} style={[styles.ctaBtn, { backgroundColor: palette.accent }]}>
              <Languages size={16} color={palette.onAccent} />
              <Text style={[styles.ctaText, { color: palette.onAccent }]}>Türkçeye Çevir</Text>
            </Pressable>
          </View>
        ) : tab === "bilingual" ? (
          (item.segments && item.segments.length > 0
            ? item.segments
            : [{ original_text: item.original, translated_text: item.translated || "(Henüz çevrilmedi)" }]
          ).map((seg, idx) => (
            <View key={idx} style={[styles.bilingualBlock, { borderBottomColor: palette.border }]}>
              <Text style={[styles.biOrig, { color: palette.textMuted, fontFamily: bodyFont, fontSize: fontSize - 2 }]}>
                {seg.original_text}
              </Text>
              <Text style={[styles.para, { color: palette.text, fontFamily: bodyFont, fontSize, lineHeight: fontSize * 1.72 }]}>
                {seg.translated_text || "(Henüz çevrilmedi)"}
              </Text>
            </View>
          ))
        ) : (
          blocks.map((blk, idx) => {
            if (blk.kind === "code") {
              return (
                <ScrollView
                  key={idx}
                  horizontal
                  style={[styles.codeBox, { backgroundColor: palette.bgSubtle, borderColor: palette.border }]}
                >
                  <Text style={[styles.codeText, { color: palette.text }]}>{blk.body}</Text>
                </ScrollView>
              );
            }
            if (blk.kind === "heading") {
              return (
                <Text key={idx} style={[styles.heading, { color: palette.text, fontFamily: bodyFont, fontSize: fontSize + 4 }]}>
                  {blk.body}
                </Text>
              );
            }
            if (blk.kind === "quote") {
              return (
                <View key={idx} style={[styles.quoteBox, { borderLeftColor: palette.accent }]}>
                  <Text style={[styles.quoteText, { color: palette.textMuted, fontFamily: bodyFont, fontSize }]}>
                    {blk.body}
                  </Text>
                </View>
              );
            }
            return (
              <Text key={idx} style={[styles.para, { color: palette.text, fontFamily: bodyFont, fontSize, lineHeight: fontSize * 1.74 }]}>
                {blk.body}
              </Text>
            );
          })
        )}
      </ScrollView>

      {/* Aa Typography & Theme Sheet */}
      <Modal visible={typoOpen} transparent animationType="slide" onRequestClose={() => setTypoOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setTypoOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong }]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: palette.text }]}>Görünüm</Text>
              <Pressable onPress={() => setTypoOpen(false)} hitSlop={8}>
                <X size={19} color={palette.textMuted} />
              </Pressable>
            </View>

            <Text style={[styles.sheetLabel, { color: palette.textDim }]}>TEMA</Text>
            <View style={[styles.segWrap, { marginHorizontal: 0, marginBottom: 14, backgroundColor: palette.bgSubtle, borderColor: palette.border }]}>
              {(
                [
                  ["light", "Kağıt"],
                  ["dark", "Koyu"],
                ] as Array<[ThemeMode, string]>
              ).map(([m, lbl]) => (
                <Pressable
                  key={m}
                  onPress={() => onSetThemeMode(m)}
                  style={[styles.segBtn, themeMode === m && { backgroundColor: palette.bgElevated }]}
                >
                  <Text style={[styles.segText, { color: themeMode === m ? palette.text : palette.textMuted }]}>{lbl}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.sheetLabel, { color: palette.textDim }]}>YAZI TİPİ</Text>
            <View style={[styles.segWrap, { marginHorizontal: 0, marginBottom: 14, backgroundColor: palette.bgSubtle, borderColor: palette.border }]}>
              {(["serif", "sans"] as const).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFontFamily(f)}
                  style={[styles.segBtn, fontFamily === f && { backgroundColor: palette.bgElevated }]}
                >
                  <Text style={[styles.segText, { color: fontFamily === f ? palette.text : palette.textMuted }]}>
                    {f === "serif" ? "Serif (Georgia)" : "Sans (SF Pro)"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.sheetLabel, { color: palette.textDim }]}>BOYUT ({Math.round(fontSize)} PT)</Text>
            <View style={styles.sizeRow}>
              <Pressable
                onPress={() => setFontSize((v) => Math.max(14, v - 1.5))}
                style={[styles.sizeBtn, { borderColor: palette.borderStrong }]}
              >
                <Text style={[styles.sizeBtnText, { color: palette.text }]}>A−</Text>
              </Pressable>
              <Pressable
                onPress={() => setFontSize((v) => Math.min(26, v + 1.5))}
                style={[styles.sizeBtn, { borderColor: palette.borderStrong }]}
              >
                <Text style={[styles.sizeBtnText, { color: palette.text }]}>A+</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Actions (...) Sheet */}
      <Modal visible={actionsOpen} transparent animationType="slide" onRequestClose={() => setActionsOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionsOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong }]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: palette.text }]}>İşlemler</Text>
              <Pressable onPress={() => setActionsOpen(false)} hitSlop={8}>
                <X size={19} color={palette.textMuted} />
              </Pressable>
            </View>

            <Pressable onPress={() => handleTranslate("faithful")} style={[styles.actionRow, { borderBottomColor: palette.border }]}>
              <Languages size={18} color={palette.accent} />
              <Text style={[styles.actionText, { color: palette.text }]}>
                {item.translated ? "Yeniden Çevir (Tam Türkçe)" : "Türkçeye Çevir"}
              </Text>
            </Pressable>
            <Pressable onPress={() => handleTranslate("summary")} style={[styles.actionRow, { borderBottomColor: palette.border }]}>
              <Languages size={18} color={palette.textMuted} />
              <Text style={[styles.actionText, { color: palette.text }]}>Türkçe Özet Çıkar</Text>
            </Pressable>
            <Pressable onPress={handlePodcast} style={[styles.actionRow, { borderBottomColor: palette.border }]}>
              <Mic size={18} color={palette.accent} />
              <Text style={[styles.actionText, { color: palette.text }]}>2 Kişilik Türkçe Podcast Üret (Emel & Ahmet)</Text>
            </Pressable>
            <Pressable onPress={handleSaveOffline} disabled={savingOffline} style={styles.actionRow}>
              <CloudDownload size={18} color={palette.textMuted} />
              <Text style={[styles.actionText, { color: palette.text }]}>
                {savingOffline ? "Telefona indiriliyor..." : "Çevrimdışı Okuma & Dinleme İçin İndir"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  progressTrack: { height: 2.5, width: "100%" },
  progressFill: { height: "100%" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  backText: { fontSize: 15, fontWeight: "500" },
  topActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  topIconBtn: { padding: 4 },
  segWrap: {
    flexDirection: "row",
    marginHorizontal: 18,
    marginTop: 10,
    padding: 3,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segBtn: { flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: "center" },
  segText: { fontSize: 13 },
  articleContent: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 60 },
  articleTitle: {
    fontFamily: FONTS.serif,
    fontSize: 27,
    fontWeight: "600",
    lineHeight: 33,
    letterSpacing: -0.4,
    marginBottom: 10,
  },
  byline: { fontSize: 13.5, fontVariant: ["tabular-nums"] },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 20 },
  heading: { fontWeight: "600", marginTop: 22, marginBottom: 10, lineHeight: 30 },
  para: { marginBottom: 18 },
  quoteBox: { borderLeftWidth: 2.5, paddingLeft: 14, marginVertical: 14 },
  quoteText: { fontStyle: "italic", lineHeight: 28 },
  codeBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    padding: 13,
    marginVertical: 14,
  },
  codeText: { fontFamily: FONTS.mono, fontSize: 12.5, lineHeight: 19 },
  bilingualBlock: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  biOrig: { marginBottom: 8, lineHeight: 24 },
  emptyTr: {
    padding: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    marginTop: 16,
  },
  emptyTitle: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: "600", marginBottom: 6 },
  emptySub: { fontSize: 13.5, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 9,
  },
  ctaText: { fontSize: 14, fontWeight: "600" },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20,19,17,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    padding: 20,
    paddingBottom: 34,
  },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7, marginBottom: 6 },
  sizeRow: { flexDirection: "row", gap: 10 },
  sizeBtn: { flex: 1, borderWidth: 1, borderRadius: 9, paddingVertical: 10, alignItems: "center" },
  sizeBtnText: { fontSize: 15, fontWeight: "600" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionText: { fontSize: 15, fontWeight: "500", flex: 1 },
});
