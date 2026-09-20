import { useAuth } from "@clerk/expo";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { CurrentJobBar } from "@/components/CurrentJobBar";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
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
    const token = await getToken();
    if (!token) return;
    try {
      const [reports, punchItems, media, timeEntries, pending] = await Promise.all([
        api.listFieldReports(job.id, token),
        api.listPunchListItems(job.id, token),
        api.listMedia(job.id, token),
        api.listTimeEntries(job.id, token),
        pendingCount(),
      ]);
      setLines(summariseToday({ reports, punchItems, media, timeEntries, pending }));
      setError(null);
    } catch {
      // Offline is the normal state here, not a failure worth shouting
      // about: the queue is still holding whatever was typed, and the
      // pending count below is computed on-device anyway.
      setLines(
        summariseToday({ reports: [], punchItems: [], media: [], timeEntries: [], pending: await pendingCount() }),
      );
      setError("Showing what this phone knows — no connection");
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
