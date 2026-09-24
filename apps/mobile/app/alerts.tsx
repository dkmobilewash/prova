import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { Skeleton } from "@/components/Skeleton";
import { SyncStatus } from "@/components/SyncStatus";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { emptyFor } from "@/lib/empty-state";
import { leadingFor, type Palette, radius, space, typography } from "@/lib/theme";
import type { AlertRow } from "@/lib/types";
import { usePalette } from "@/lib/use-palette";
import { useStableGetToken } from "@/lib/use-stable-get-token";

/**
 * The phone's alert list — what a notification tap lands on, and what the
 * notification was a pointer to. Read-only, per-principal, and already
 * money-stripped server-side: the phone renders no figures, and it must
 * never be a second place deciding who may see them.
 *
 * The severity wording is the web's own (alertLabels.ts), so the bell,
 * the list and this screen cannot tell different stories about the same
 * alert.
 *
 * Deliberately NOT tappable. Every alert carries an `href` into the web
 * app, and the phone has no browser of its own here: a row that looked
 * pressable and did nothing would be worse than a row that plainly says
 * what is wrong. The thing to do about an alert is on a laptop; the
 * thing to KNOW about it is here.
 */
function severityStyles(palette: Palette) {
  return {
    OVERDUE: { label: "Past due", bg: palette.colors.tagRose, ink: palette.colors.tagRoseInk },
    DUE_SOON: { label: "Coming up", bg: palette.colors.tagAmber, ink: palette.colors.tagAmberInk },
    STANDING: { label: "Standing", bg: palette.colors.tagSlate, ink: palette.colors.tagSlateInk },
  } satisfies Record<AlertRow["severity"], { label: string; bg: string; ink: string }>;
}

export default function AlertsScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const getToken = useStableGetToken();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const severity = useMemo(() => severityStyles(palette), [palette]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // The same cache contract every list screen keeps: the token goes
    // INSIDE the read so no signal still shows the last-known list, and
    // an empty cache reads as "couldn't load", never as "nothing is
    // wrong" — the exact lie a punch list once told in a basement.
    const result = await cachedRead(
      cacheKeys.alerts(),
      withToken(getToken, (t) => api.listAlerts(t)),
    );
    if (result.from === "nothing") {
      setOffline("nothing");
      setLoaded(true); // the read FINISHED — it just found nothing to read
      return;
    }
    setAlerts(result.value);
    setOffline(staleNote(result));
    setLoaded(true);
  }, [getToken]);

  useEffect(() => {
    if (!isSignedIn) return;
    // Awaited inside its own async closure, as the other list screens do:
    // a bare load() reads as a synchronous setState to the hooks lint.
    (async () => {
      await load();
    })();
  }, [isSignedIn, load]);

  if (!isLoaded) return <Text style={styles.loading}>Loading…</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const empty = emptyFor(offline, "the alerts", {
    title: "Nothing needs attention",
    description: "Alerts appear here when something needs doing.",
  });

  return (
    <ScrollView
      style={styles.screen}
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
      <SyncStatus state={offline} />
      {!loaded ? (
        <View style={styles.skeletonGroup}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : alerts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{empty.emptyTitle}</Text>
          {empty.emptyDescription ? (
            <Text style={styles.emptyBody}>{empty.emptyDescription}</Text>
          ) : null}
        </View>
      ) : (
        <GroupedList>
          {alerts.map((item, i) => {
            const tone = severity[item.severity];
            return (
              <GroupedRow
                key={item.key}
                title={item.title}
                subtitle={item.detail}
                trailing={
                  <View style={[styles.tag, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.tagLabel, { color: tone.ink }]}>{tone.label}</Text>
                  </View>
                }
                divider={i > 0}
              />
            );
          })}
        </GroupedList>
      )}
    </ScrollView>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    content: { paddingHorizontal: space.md, paddingBottom: space.xxl },
    loading: { color: p.colors.ink, fontSize: typography.size.md, padding: space.md },
    skeletonGroup: { gap: space.sm, marginTop: space.sm },
    tag: {
      borderRadius: radius.pill,
      paddingHorizontal: space.sm,
      paddingVertical: space.xxs,
    },
    tagLabel: {
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
    },
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
