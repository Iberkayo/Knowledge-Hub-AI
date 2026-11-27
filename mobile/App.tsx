import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { BookOpen, Compass, Headphones, Settings } from "lucide-react-native";

import {
  KnowledgeHubApi,
  loadConnectionConfig,
  loadThemePref,
  saveThemePref,
} from "./src/api";
import { listOfflineIds, listOfflineItems } from "./src/offline";
import { MiniPlayer, PlayerProvider } from "./src/playerContext";
import { DiscoverScreen } from "./src/screens/DiscoverScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { ListenScreen } from "./src/screens/ListenScreen";
import { ReaderScreen } from "./src/screens/ReaderScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { getPalette, type ThemeMode } from "./src/theme";
import type { ConnectionConfig, JobInfo, LibraryItem } from "./src/types";

type TabKey = "library" | "discover" | "listen" | "settings";

function AppShell() {
  const systemScheme = useColorScheme();
  const [themePref, setThemePref] = useState<"system" | "light" | "dark">("system");
  const [config, setConfig] = useState<ConnectionConfig>({ serverUrl: "", apiToken: "" });
  const [tab, setTab] = useState<TabKey>("library");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [offlineIds, setOfflineIds] = useState<Set<string>>(() => new Set());
  const [offlineMode, setOfflineMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [readerItem, setReaderItem] = useState<LibraryItem | null>(null);
  const [activeJobs, setActiveJobs] = useState<JobInfo[]>([]);
  const [bannerMsg, setBannerMsg] = useState("");

  const resolvedTheme: ThemeMode =
    themePref === "system" ? (systemScheme === "dark" ? "dark" : "light") : themePref;
  const palette = useMemo(() => getPalette(resolvedTheme), [resolvedTheme]);
  const api = useMemo(() => new KnowledgeHubApi(config), [config]);

  const refreshOfflineSet = useCallback(() => {
    setOfflineIds(listOfflineIds());
  }, []);

  const refreshLibrary = useCallback(async () => {
    setRefreshing(true);
    refreshOfflineSet();
    if (!api.configured) {
      const local = await listOfflineItems();
      setItems(local);
      setOfflineMode(local.length > 0);
      setRefreshing(false);
      return;
    }
    try {
      const list = await api.listItems();
      setItems(list);
      setOfflineMode(false);
    } catch {
      const local = await listOfflineItems();
      setItems(local);
      setOfflineMode(true);
    } finally {
      setRefreshing(false);
    }
  }, [api, refreshOfflineSet]);

  useEffect(() => {
    (async () => {
      const [cfg, pref] = await Promise.all([loadConnectionConfig(), loadThemePref()]);
      setConfig(cfg);
      setThemePref(pref);
    })();
  }, []);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  // Poll active backend jobs while any job is running
  useEffect(() => {
    if (!api.configured) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    const poll = async () => {
      try {
        const jobs = await api.listJobs();
        if (!alive) return;
        const running = jobs.filter((j) => j.status === "RUNNING" || j.status === "QUEUED");
        setActiveJobs(running);
        if (running.length > 0) {
          timer = setTimeout(poll, 2500);
        }
      } catch {
        // ignore transient errors
      }
    };
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, bannerMsg]);

  function notifyJob(msg: string) {
    setBannerMsg(msg);
    setTimeout(() => setBannerMsg(""), 4000);
  }

  function handleThemePref(pref: "system" | "light" | "dark") {
    setThemePref(pref);
    saveThemePref(pref).catch(() => {});
  }

  const tabs: Array<{ key: TabKey; label: string; Icon: typeof BookOpen }> = [
    { key: "library", label: "Kütüphanem", Icon: BookOpen },
    { key: "discover", label: "Keşfet", Icon: Compass },
    { key: "listen", label: "Dinle", Icon: Headphones },
    { key: "settings", label: "Ayarlar", Icon: Settings },
  ];

  return (
    <PlayerProvider api={api}>
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg }]} edges={["top", "bottom"]}>
        <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />

        {(activeJobs.length > 0 || Boolean(bannerMsg)) && (
          <View style={[styles.jobBanner, { backgroundColor: palette.bgElevated, borderBottomColor: palette.border }]}>
            <Text numberOfLines={1} style={[styles.jobText, { color: palette.accent }]}>
              {activeJobs.length > 0
                ? `${activeJobs[0].job_type.toUpperCase()} · %${Math.round((activeJobs[0].progress || 0) * 100)}`
                : bannerMsg}
            </Text>
          </View>
        )}

        <View style={styles.body}>
          {readerItem ? (
            <ReaderScreen
              api={api}
              palette={palette}
              initialItem={readerItem}
              themeMode={resolvedTheme}
              onSetThemeMode={(m) => handleThemePref(m)}
              onBack={() => {
                setReaderItem(null);
                refreshLibrary();
              }}
              onJobStarted={notifyJob}
              onOfflineChanged={refreshOfflineSet}
            />
          ) : tab === "library" ? (
            <LibraryScreen
              api={api}
              palette={palette}
              items={items}
              offlineIds={offlineIds}
              offlineMode={offlineMode}
              refreshing={refreshing}
              onRefresh={refreshLibrary}
              onOpenItem={(it) => setReaderItem(it)}
              onOpenSettings={() => setTab("settings")}
            />
          ) : tab === "discover" ? (
            <DiscoverScreen
              api={api}
              palette={palette}
              onImported={(it) => {
                refreshLibrary();
                setReaderItem(it);
              }}
            />
          ) : tab === "listen" ? (
            <ListenScreen
              api={api}
              palette={palette}
              items={items}
              refreshing={refreshing}
              onRefresh={refreshLibrary}
              onJobStarted={notifyJob}
            />
          ) : (
            <SettingsScreen
              palette={palette}
              config={config}
              themePref={themePref}
              offlineCount={offlineIds.size}
              onConfigSaved={async (cfg) => {
                setConfig(cfg);
              }}
              onThemePrefChange={handleThemePref}
              onOfflineCleared={refreshOfflineSet}
            />
          )}
        </View>

        <MiniPlayer palette={palette} />

        {!readerItem && (
          <View style={[styles.tabBar, { backgroundColor: palette.bgElevated, borderTopColor: palette.border }]}>
            {tabs.map(({ key, label, Icon }) => {
              const active = tab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setTab(key);
                  }}
                  style={styles.tabBtn}
                >
                  <Icon
                    size={20}
                    color={active ? palette.accent : palette.textMuted}
                    strokeWidth={active ? 2 : 1.65}
                  />
                  <Text style={[styles.tabLabel, { color: active ? palette.accent : palette.textMuted, fontWeight: active ? "600" : "500" }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </SafeAreaView>
    </PlayerProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1 },
  jobBanner: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  jobText: {
    fontSize: 12.5,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingBottom: 6,
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minHeight: 44,
  },
  tabLabel: {
    fontSize: 11,
  },
});
