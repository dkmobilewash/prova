import { useAuth } from "@clerk/expo";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { Icon } from "@/components/Icon";
import { LargeTitle } from "@/components/LargeTitle";
import { Skeleton } from "@/components/Skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { SyncStatus } from "@/components/SyncStatus";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { setCurrentJob } from "@/lib/current-job";
import { emptyFor } from "@/lib/empty-state";
import { useT } from "@/lib/i18n";
import { shortDay } from "@/lib/local-today";
import { leadingFor, type Palette, space, typography } from "@/lib/theme";
import type { Job } from "@/lib/types";
import { useCurrentJob } from "@/lib/use-current-job";
import { usePalette } from "@/lib/use-palette";
import { useStableGetToken } from "@/lib/use-stable-get-token";

/** Every job, and the place you change which one the phone is on. Opening
 * a job makes it the CURRENT job — Home and the capture sheet all act on it
 * from then on, so choosing a job and going to work are the same gesture
 * rather than two. Each row is the job as an object: name, status pill,
 * date range when it has one, and a brand checkmark beside the one this
 * phone is on. */
export default function JobsScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const { job: current } = useCurrentJob();
  const getToken = useStableGetToken();
  const { t } = useT();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // The job list is the first screen after sign-in and the one most
    // likely to be opened in a truck with one bar. An empty list here
    // reads as "you have no jobs", which is never what it means — and
    // the token goes inside the read so no signal still shows the list.
    const result = await cachedRead(cacheKeys.jobs(), withToken(getToken, (t) => api.listJobs(t)));
    if (result.from === "nothing") {
      setOffline("nothing");
      setLoaded(true); // the read FINISHED — it just found nothing to read
      return;
    }
    setJobs(result.value);
    setOffline(staleNote(result));
    setLoaded(true);
  }, [getToken]);

  useEffect(() => {
    if (!isSignedIn) return;
    // Awaited inside its own async closure, as punch-list/[jobId] does: a
    // bare `load()` in the effect body is a synchronous setState-in-effect
    // to react-hooks/set-state-in-effect, and that failed CI's lint.
    (async () => {
      await load();
    })();
  }, [isSignedIn, load]);

  if (!isLoaded) return <Text style={styles.loading}>{t("common.loading")}</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const empty = emptyFor(offline, "thing.jobs", {
    title: "jobs.empty.title",
    description: "jobs.empty.body",
  });

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={palette.colors.inkMuted}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <LargeTitle>{t("nav.jobs")}</LargeTitle>
        <SyncStatus state={offline} />
        {!loaded ? (
          <View style={styles.skeletonGroup}>
            <Skeleton height={52} />
            <Skeleton height={52} />
            <Skeleton height={52} />
          </View>
        ) : jobs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{empty.emptyTitle}</Text>
            {empty.emptyDescription ? <Text style={styles.emptyBody}>{empty.emptyDescription}</Text> : null}
          </View>
        ) : (
          <GroupedList>
            {jobs.map((item, i) => {
              const isCurrent = current?.id === item.id;
              const range =
                item.startDate && item.endDate
                  ? `${shortDay(item.startDate)} – ${shortDay(item.endDate)}`
                  : null;
              return (
                <GroupedRow
                  key={item.id}
                  title={item.name}
                  subtitle={
                    [range, isCurrent ? t("jobs.onThisJob") : null].filter(Boolean).join(" · ") ||
                    undefined
                  }
                  trailing={
                    isCurrent ? (
                      <View style={styles.currentRow}>
                        <StatusBadge status={item.status} />
                        <Icon name="checkCircle" size={18} color={palette.colors.brand} />
                      </View>
                    ) : (
                      <StatusBadge status={item.status} />
                    )
                  }
                  divider={i > 0}
                  onPress={async () => {
                    await setCurrentJob({ id: item.id, name: item.name, status: item.status });
                    router.push({
                      pathname: "/job/[jobId]",
                      params: { jobId: item.id, name: item.name, status: item.status },
                    });
                  }}
                />
              );
            })}
          </GroupedList>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    loading: { color: p.colors.ink, fontSize: typography.size.md, padding: space.md },
    content: { paddingHorizontal: space.md, paddingBottom: 88 },
    skeletonGroup: { gap: space.sm, marginTop: space.sm },
    currentRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
    empty: { gap: space.xs, paddingTop: space.xl, alignItems: "center" },
    emptyTitle: {
      color: p.colors.ink,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
      textAlign: "center",
    },
    emptyBody: {
      color: p.colors.inkBody,
      fontSize: typography.size.md,
      lineHeight: leadingFor(typography.size.md),
      textAlign: "center",
    },
  });
}
