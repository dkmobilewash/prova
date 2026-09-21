import { useAuth } from "@clerk/expo";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { CurrentJobBar } from "@/components/CurrentJobBar";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, withToken, type CachedRead } from "@/lib/cached-read";
import { prefetchJob } from "@/lib/prefetch";
import { pendingCount } from "@/lib/sync-queue";
import { summariseToday, type TodayLine } from "@/lib/today";
import { useCurrentJob } from "@/lib/use-current-job";
import { useStableGetToken } from "@/lib/use-stable-get-token";

/**
 * Home: what today looks like on the job this phone is on.
 *
 * Every line is a claim that can be WRONG — "today's report isn't filed",
 * "2 changes still to send" — because a home screen made of labels is a
 * menu with a nicer name. The sentences are derived in lib/today.ts and
 * tested there; this screen fetches, draws and routes.
 *
 * Nothing here is new server work: the four lists are the same ones the
 * sections already load.
 */
export default function HomeScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const getToken = useStableGetToken();
  const { job, loading } = useCurrentJob();
  const [lines, setLines] = useState<TodayLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!job) return;

    // Through the cache, section by section, so Home offline shows the
    // day as this phone last knew it rather than a page of zeros —
    // "no photos today" is a claim, and it was wrong every time the
    // fetch failed. The token is fetched INSIDE each read: Clerk refreshes
    // it over the network, so a screen that bails on a null token never
    // reaches its own cache (see withToken).
    const [reports, punchItems, media, timeEntries] = await Promise.all([
      cachedRead(cacheKeys.reports(job.id), withToken(getToken, (t) => api.listFieldReports(job.id, t))),
      cachedRead(cacheKeys.punchList(job.id), withToken(getToken, (t) => api.listPunchListItems(job.id, t))),
      cachedRead(cacheKeys.photos(job.id), withToken(getToken, (t) => api.listMedia(job.id, t))),
      cachedRead(cacheKeys.time(job.id), withToken(getToken, (t) => api.listTimeEntries(job.id, t))),
    ]);
    const pending = await pendingCount();

    setLines(
      summariseToday({
        reports: rows(reports),
        punchItems: rows(punchItems),
        media: rows(media),
        timeEntries: rows(timeEntries),
        pending,
      }),
    );

    const sections = [reports, punchItems, media, timeEntries];
    if (sections.every((section) => section.from === "server")) {
      setError(null);
      // While there IS signal, fill the cache for the sections Home does
      // not itself read — Materials, Safety, T&M, drawings, schedule.
      // Home is the screen the app opens on, so this is the moment the
      // phone is most likely to still have bars; by the time somebody
      // opens Materials in a basement it is far too late to fetch it.
      void getToken().then((token) => {
        if (token) void prefetchJob(job.id, token);
      });
    } else if (sections.some((section) => section.from === "cache")) {
      setError("Showing what this phone last loaded — no connection");
    } else {
      setError("No connection, and this phone hasn't loaded this job yet");
    }
  }, [getToken, job]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!isLoaded) return <Text style={styles.loading}>Loading…</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <View style={styles.screen}>
      <CurrentJobBar job={job} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.inkMuted}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {loading ? null : !job ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Pick a job to start the day</Text>
            <Text style={styles.emptyBody}>
              Once you&apos;re on a job, this page shows what&apos;s done and what isn&apos;t — and Create
              and Camera work without asking which job every time.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.heading}>Today</Text>
            {error ? <Text style={styles.stale}>{error}</Text> : null}
            <View style={styles.panel}>
              {lines.map((line, i) => (
                <Pressable
                  key={line.key}
                  disabled={!line.section}
                  onPress={() => line.section && router.push(`/${line.section}/${job.id}`)}
                  style={styles.line}
                >
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.lineRow}>
                    <View style={[styles.dot, DOT[line.tone]]} />
                    <Text style={styles.lineLabel}>{line.label}</Text>
                    {line.section ? <Text style={styles.chevron}>›</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** An empty list is the honest answer when a section could not be loaded
 * at all — and the banner above says so, which is what stops
 * `summariseToday` turning that emptiness into "no photos today". */
function rows<T>(read: CachedRead<T[]>): T[] {
  return read.from === "nothing" ? [] : read.value;
}

/** The state of each line, said in a colour as well as in words — the
 * words are the message, the dot is the glance. */
const DOT: Record<TodayLine["tone"], { backgroundColor: string }> = {
  done: { backgroundColor: colors.barGreen },
  todo: { backgroundColor: colors.brand },
  warn: { backgroundColor: colors.barRose },
  plain: { backgroundColor: colors.inkMuted },
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loading: { color: colors.ink, fontSize: typography.size.md, padding: 16 },
  content: { padding: 16, gap: 12 },
  heading: { color: colors.ink, fontSize: typography.size.xxl, fontWeight: typography.weight.bold },
  stale: { color: colors.inkMuted, fontSize: typography.size.sm },
  panel: {
    borderWidth: 1,
    borderColor: colors.lineCard,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  line: { minHeight: 56, justifyContent: "center" },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  divider: { height: 1, backgroundColor: colors.lineRow },
  dot: { width: 10, height: 10, borderRadius: 5 },
  lineLabel: { color: colors.ink, fontSize: typography.size.md, flex: 1 },
  chevron: { color: colors.inkMuted, fontSize: typography.size.lg },
  empty: { gap: 8, paddingTop: 24 },
  emptyTitle: { color: colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.semibold },
  emptyBody: { color: colors.inkBody, fontSize: typography.size.sm, lineHeight: 22 },
});
