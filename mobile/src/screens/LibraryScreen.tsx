import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Headphones, Plus, Search, Star, WifiOff, X } from "lucide-react-native";

import type { KnowledgeHubApi } from "../api";
import { usePlayer } from "../playerContext";
import { FONTS, type Palette } from "../theme";
import type { LibraryItem } from "../types";

type FilterKey = "all" | "unread" | "favorites" | "article" | "podcast" | "offline";

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "Yerel";
  }
}

export function LibraryScreen({
  api,
  palette,
  items,
  offlineIds,
  offlineMode,
  refreshing,
  onRefresh,
  onOpenItem,
  onOpenSettings,
}: {
  api: KnowledgeHubApi;
  palette: Palette;
  items: LibraryItem[];
  offlineIds: Set<string>;
  offlineMode: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenItem: (item: LibraryItem) => void;
  onOpenSettings: () => void;
}) {
  const { playItem } = usePlayer();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    return items.filter((item) => {
      if (filter === "unread" && item.is_read) return false;
      if (filter === "favorites" && !item.favorite) return false;
      if (filter === "article" && item.kind !== "article") return false;
      if (filter === "podcast" && item.kind !== "podcast") return false;
      if (filter === "offline" && !offlineIds.has(item.id)) return false;
      if (q) {
        const hay = [item.title, item.author, item.category, item.source].join(" ").toLocaleLowerCase("tr");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [filter, items, offlineIds, search]);

  async function handleImportUrl() {
    if (!urlInput.trim()) return;
    setImporting(true);
    try {
      const created = await api.importUrl(urlInput.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setUrlInput("");
      setAddOpen(false);
      await onRefresh();
      onOpenItem(created);
    } catch (e) {
      Alert.alert("İçerik Alınamadı", e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  async function handleToggleFavorite(item: LibraryItem) {
    Haptics.selectionAsync().catch(() => {});
    try {
      await api.toggleFavorite(item);
      await onRefresh();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : String(e));
    }
  }

  const filterDefs: Array<[FilterKey, string]> = [
    ["all", "Tümü"],
    ["unread", "Okunmamış"],
    ["favorites", "Favoriler"],
    ["article", "Makale"],
    ["podcast", "Podcast"],
    ["offline", "Çevrimdışı"],
  ];

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.pageTitle, { color: palette.text }]}>Kütüphanem</Text>
          <Text style={[styles.pageSub, { color: palette.textMuted }]}>
            {items.length} kayıtlı içerik{offlineMode ? " · Çevrimdışı" : ""}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            if (!api.configured) {
              onOpenSettings();
              return;
            }
            setAddOpen(true);
          }}
          style={[styles.addBtn, { backgroundColor: palette.accent }]}
        >
          <Plus size={16} color={palette.onAccent} strokeWidth={2} />
          <Text style={[styles.addBtnText, { color: palette.onAccent }]}>Ekle</Text>
        </Pressable>
      </View>

      {!api.configured && (
        <Pressable
          onPress={onOpenSettings}
          style={[styles.notice, { backgroundColor: palette.accentSoft, borderColor: palette.border }]}
        >
          <Text style={[styles.noticeTitle, { color: palette.accent }]}>Sunucu bağlantısı gerekli</Text>
          <Text style={[styles.noticeBody, { color: palette.textMuted }]}>
            Ev bilgisayarındaki Tailscale HTTPS adresini ve erişim belirtecini girmek için buraya dokun.
          </Text>
        </Pressable>
      )}

      <View style={[styles.searchBox, { backgroundColor: palette.bgSurface, borderColor: palette.border }]}>
        <Search size={16} color={palette.textDim} strokeWidth={1.7} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Başlık, yazar veya kaynak ara..."
          placeholderTextColor={palette.textDim}
          style={[styles.searchInput, { color: palette.text }]}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <X size={15} color={palette.textDim} />
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {filterDefs.map(([k, label]) => {
          const active = filter === k;
          return (
            <Pressable
              key={k}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setFilter(k);
              }}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? palette.text : "transparent",
                  borderColor: active ? palette.text : palette.border,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? palette.bg : palette.textMuted }]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent} />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={[styles.empty, { borderColor: palette.borderStrong }]}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>
              {items.length ? "Eşleşen içerik yok" : "Kütüphanen henüz boş"}
            </Text>
            <Text style={[styles.emptySub, { color: palette.textMuted }]}>
              Sağ üstten bir makale veya YouTube linki ekleyerek başlayabilirsin.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const trDone = item.status === "processed" && item.mode !== "demo";
          const audioReady = item.audio_status === "ready" || Boolean(item.source_audio_path);
          const isOffline = offlineIds.has(item.id);
          const kindTr = item.kind === "podcast" ? "PODCAST" : item.kind === "document" ? "BELGE" : "MAKALE";
          const meta = [
            item.author || null,
            getDomain(item.source),
            `${item.reading_minutes || 1} dk`,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <Pressable
              onPress={() => onOpenItem(item)}
              style={[styles.row, { borderBottomColor: palette.border }]}
            >
              <View style={styles.rowBody}>
                <View style={styles.kickerRow}>
                  <Text style={[styles.kicker, { color: palette.textDim }]}>
                    {[kindTr, item.category?.toUpperCase()].filter(Boolean).join(" · ")}
                  </Text>
                  <View style={styles.dotWrap}>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: trDone ? palette.success : palette.warn },
                      ]}
                    />
                    <Text style={[styles.dotText, { color: trDone ? palette.success : palette.warn }]}>
                      {trDone ? "Türkçe" : "Orijinal"}
                    </Text>
                  </View>
                  {audioReady && (
                    <View style={styles.dotWrap}>
                      <View style={[styles.dot, { backgroundColor: palette.accent }]} />
                      <Text style={[styles.dotText, { color: palette.accent }]}>Ses</Text>
                    </View>
                  )}
                  {isOffline && <WifiOff size={12} color={palette.textDim} strokeWidth={1.8} />}
                </View>

                <Text numberOfLines={2} style={[styles.itemTitle, { color: palette.text }]}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={[styles.itemMeta, { color: palette.textMuted }]}>
                  {meta}
                </Text>
              </View>

              <View style={styles.rowActions}>
                {audioReady && (
                  <Pressable
                    onPress={() => playItem(item)}
                    hitSlop={8}
                    style={[styles.iconCircle, { backgroundColor: palette.bgSubtle }]}
                  >
                    <Headphones size={16} color={palette.accent} strokeWidth={1.8} />
                  </Pressable>
                )}
                <Pressable onPress={() => handleToggleFavorite(item)} hitSlop={8} style={styles.starBtn}>
                  <Star
                    size={17}
                    color={item.favorite ? palette.accent : palette.textDim}
                    fill={item.favorite ? palette.accent : "transparent"}
                    strokeWidth={1.7}
                  />
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: palette.text }]}>Yeni İçerik Ekle</Text>
              <Pressable onPress={() => setAddOpen(false)} hitSlop={10}>
                <X size={20} color={palette.textMuted} />
              </Pressable>
            </View>
            <Text style={[styles.modalHelp, { color: palette.textMuted }]}>
              Herkese açık bir makale veya YouTube video bağlantısını yapıştır; başlık ve içerik/transkript otomatik alınır.
            </Text>
            <TextInput
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder="https://hamel.dev/evals/ veya https://youtu.be/..."
              placeholderTextColor={palette.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[
                styles.modalInput,
                { backgroundColor: palette.bgSurface, borderColor: palette.border, color: palette.text },
              ]}
            />
            <Pressable
              disabled={importing}
              onPress={handleImportUrl}
              style={[styles.primaryBtn, { backgroundColor: palette.accent, opacity: importing ? 0.6 : 1 }]}
            >
              {importing ? (
                <ActivityIndicator color={palette.onAccent} size="small" />
              ) : (
                <Text style={[styles.primaryBtnText, { color: palette.onAccent }]}>İçeriği Getir</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
  },
  pageTitle: {
    fontFamily: FONTS.serif,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  pageSub: {
    fontSize: 13,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 9,
  },
  addBtnText: { fontSize: 13.5, fontWeight: "600" },
  notice: {
    marginHorizontal: 18,
    marginBottom: 12,
    padding: 13,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeTitle: { fontSize: 13.5, fontWeight: "600", marginBottom: 3 },
  noticeBody: { fontSize: 12.5, lineHeight: 18 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 18,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14 },
  filterScroll: { flexGrow: 0, marginTop: 10, marginBottom: 4 },
  filterRow: { paddingHorizontal: 18, gap: 6, paddingBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 12.5, fontWeight: "500" },
  listContent: { paddingHorizontal: 18, paddingBottom: 32 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  rowBody: { flex: 1, minWidth: 0 },
  kickerRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  kicker: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6 },
  dotWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 5.5, height: 5.5, borderRadius: 3 },
  dotText: { fontSize: 11, fontWeight: "500" },
  itemTitle: {
    fontFamily: FONTS.serif,
    fontSize: 17.5,
    fontWeight: "600",
    lineHeight: 23,
    marginBottom: 4,
  },
  itemMeta: { fontSize: 12.5, fontVariant: ["tabular-nums"] },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconCircle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  starBtn: { padding: 4 },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20,19,17,0.52)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
  },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  modalTitle: { fontSize: 17, fontWeight: "600" },
  modalHelp: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 14,
  },
  primaryBtn: {
    borderRadius: 9,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { fontSize: 14.5, fontWeight: "600" },
});
