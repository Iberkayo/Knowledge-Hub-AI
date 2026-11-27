import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CheckCircle2, Trash2 } from "lucide-react-native";

import { KnowledgeHubApi, saveConnectionConfig } from "../api";
import { clearOfflineCache } from "../offline";
import { FONTS, type Palette } from "../theme";
import type { ConnectionConfig } from "../types";

export function SettingsScreen({
  palette,
  config,
  themePref,
  offlineCount,
  onConfigSaved,
  onThemePrefChange,
  onOfflineCleared,
}: {
  palette: Palette;
  config: ConnectionConfig;
  themePref: "system" | "light" | "dark";
  offlineCount: number;
  onConfigSaved: (cfg: ConnectionConfig) => Promise<void>;
  onThemePrefChange: (pref: "system" | "light" | "dark") => void;
  onOfflineCleared: () => void;
}) {
  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [apiToken, setApiToken] = useState(config.apiToken);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  async function handleSaveAndTest() {
    setTesting(true);
    setStatusMsg("");
    try {
      const saved = await saveConnectionConfig({ serverUrl, apiToken });
      const client = new KnowledgeHubApi(saved);
      const health = await client.checkHealth();
      if (health.auth_required) {
        await client.listItems();
      }
      await onConfigSaved(saved);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStatusMsg(`Bağlantı başarılı (v${health.version}${health.auth_required ? " · Token doğrulandı" : ""}).`);
    } catch (e) {
      setStatusMsg(`Hata: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  }

  function handleClearOffline() {
    Alert.alert("Çevrimdışı Önbelleği Temizle", "Telefona indirilen tüm makale ve ses dosyaları silinsin mi?", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Temizle",
        style: "destructive",
        onPress: () => {
          clearOfflineCache();
          onOfflineCleared();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        },
      },
    ]);
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: palette.bg }]} contentContainerStyle={styles.content}>
      <Text style={[styles.pageTitle, { color: palette.text }]}>Ayarlar</Text>
      <Text style={[styles.pageSub, { color: palette.textMuted }]}>
        Bağlantı bilgileri iOS Keychain içinde şifreli saklanır.
      </Text>

      <View style={[styles.panel, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}>
        <Text style={[styles.panelTitle, { color: palette.text }]}>Sunucu Bağlantısı</Text>
        <Text style={[styles.label, { color: palette.textMuted }]}>Sunucu Adresi (Tailscale HTTPS veya Bulut)</Text>
        <TextInput
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="https://pc-adi.tailnet.ts.net"
          placeholderTextColor={palette.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, { backgroundColor: palette.bgSurface, borderColor: palette.border, color: palette.text }]}
        />

        <Text style={[styles.label, { color: palette.textMuted }]}>Erişim Belirteci (KH_API_TOKEN)</Text>
        <TextInput
          value={apiToken}
          onChangeText={setApiToken}
          placeholder="İsteğe bağlı (uzak erişimde zorunlu)"
          placeholderTextColor={palette.textDim}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: palette.bgSurface, borderColor: palette.border, color: palette.text }]}
        />

        <Pressable
          disabled={testing}
          onPress={handleSaveAndTest}
          style={[styles.primaryBtn, { backgroundColor: palette.accent, opacity: testing ? 0.65 : 1 }]}
        >
          {testing ? (
            <ActivityIndicator color={palette.onAccent} size="small" />
          ) : (
            <Text style={[styles.primaryText, { color: palette.onAccent }]}>Kaydet ve Bağlantıyı Test Et</Text>
          )}
        </Pressable>

        {Boolean(statusMsg) && (
          <View style={styles.statusRow}>
            {statusMsg.startsWith("Bağlantı") && <CheckCircle2 size={15} color={palette.success} />}
            <Text style={[styles.statusText, { color: statusMsg.startsWith("Hata") ? palette.danger : palette.success }]}>
              {statusMsg}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.panel, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}>
        <Text style={[styles.panelTitle, { color: palette.text }]}>Görünüm</Text>
        <View style={[styles.segWrap, { backgroundColor: palette.bgSubtle, borderColor: palette.border }]}>
          {(
            [
              ["system", "Sistem"],
              ["light", "Kağıt"],
              ["dark", "Koyu"],
            ] as const
          ).map(([k, lbl]) => {
            const active = themePref === k;
            return (
              <Pressable
                key={k}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onThemePrefChange(k);
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
      </View>

      <View style={[styles.panel, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}>
        <Text style={[styles.panelTitle, { color: palette.text }]}>Çevrimdışı Depolama</Text>
        <Text style={[styles.help, { color: palette.textMuted }]}>
          Telefonda kayıtlı içerik sayısı: {offlineCount}
        </Text>
        <Pressable
          onPress={handleClearOffline}
          style={[styles.dangerBtn, { backgroundColor: palette.dangerSoft }]}
        >
          <Trash2 size={15} color={palette.danger} />
          <Text style={[styles.dangerText, { color: palette.danger }]}>Çevrimdışı Önbelleği Temizle</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 48 },
  pageTitle: { fontFamily: FONTS.serif, fontSize: 28, fontWeight: "600", letterSpacing: -0.5 },
  pageSub: { fontSize: 13, marginTop: 3, marginBottom: 18 },
  panel: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    marginBottom: 16,
  },
  panelTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12 },
  label: { fontSize: 12.5, fontWeight: "600", marginBottom: 6 },
  input: {
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
  primaryText: { fontSize: 14, fontWeight: "600" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  statusText: { fontSize: 13, flex: 1 },
  segWrap: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: "center" },
  segText: { fontSize: 13.5 },
  help: { fontSize: 13.5, marginBottom: 12, fontVariant: ["tabular-nums"] },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    borderRadius: 9,
  },
  dangerText: { fontSize: 13.5, fontWeight: "600" },
});
