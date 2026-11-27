import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Plus, RefreshCw } from "lucide-react-native";

import type { KnowledgeHubApi } from "../api";
import { FONTS, type Palette } from "../theme";
import type { DiscoverEntry, LibraryItem } from "../types";

export function DiscoverScreen({
  api,
  palette,
  onImported,
}: {
  api: KnowledgeHubApi;
  palette: Palette;
  onImported: (item: LibraryItem) => void;
}) {
  const [entries, setEntries] = useState<DiscoverEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function load(refreshFeeds = false) {
    if (!api.configured) return;
    setRefreshing(true);
    try {
      if (refreshFeeds) {
        await api.refreshAllSources();
      }
      const list = await api.listDiscoverEntries(false);
      setEntries(list);
    } catch (e) {
      Alert.alert("Keşfet Hatası", e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.baseUrl, api.token]);

  async function handleSave(entry: DiscoverEntry) {
    Haptics.selectionAsync().catch(() => {});
    try {
      const item = await api.importDiscoverEntry(entry.id);
      onImported(item);
    } catch (e) {
      Alert.alert("Kaydedilemedi", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.pageTitle, { color: palette.text }]}>Keşfet</Text>
          <Text style={[styles.pageSub, { color: palette.textMuted }]}>Takip edilen bloglar ve yayınlar</Text>
        </View>
        <Pressable
          onPress={() => load(true)}
          style={[styles.refreshBtn, { borderColor: palette.borderStrong, backgroundColor: palette.bgElevated }]}
        >
          <RefreshCw size={15} color={palette.text} />
          <Text style={[styles.refreshText, { color: palette.text }]}>Yenile</Text>
        </Pressable>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={palette.accent} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={[styles.empty, { borderColor: palette.borderStrong }]}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>Henüz yayın yok</Text>
            <Text style={[styles.emptySub, { color: palette.textMuted }]}>
              Sağ üstteki Yenile butonuyla takip ettiğin RSS kaynaklarından yeni yazıları çekebilirsin.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: palette.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.source, { color: palette.textDim }]}>
                {item.source_name}{item.published_at ? ` · ${item.published_at.slice(0, 10)}` : ""}
              </Text>
              <Text style={[styles.title, { color: palette.text }]}>{item.title}</Text>
              {Boolean(item.summary) && (
                <Text numberOfLines={2} style={[styles.summary, { color: palette.textMuted }]}>
                  {item.summary}
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => handleSave(item)}
              style={[styles.saveBtn, { backgroundColor: palette.accent }]}
            >
              <Plus size={15} color={palette.onAccent} />
              <Text style={[styles.saveText, { color: palette.onAccent }]}>Kaydet</Text>
            </Pressable>
          </View>
        )}
      />
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
  pageTitle: { fontFamily: FONTS.serif, fontSize: 28, fontWeight: "600", letterSpacing: -0.5 },
  pageSub: { fontSize: 13, marginTop: 2 },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
  },
  refreshText: { fontSize: 13, fontWeight: "500" },
  listContent: { paddingHorizontal: 18, paddingBottom: 32 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  source: { fontSize: 11.5, fontWeight: "600", marginBottom: 4 },
  title: { fontFamily: FONTS.serif, fontSize: 16.5, fontWeight: "600", lineHeight: 22, marginBottom: 4 },
  summary: { fontSize: 13, lineHeight: 18 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveText: { fontSize: 12.5, fontWeight: "600" },
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
