import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { JobContextChip } from "@/components/JobContextChip";
import { List } from "@/components/List";
import { SyncStatus } from "@/components/SyncStatus";
import { emptyFor } from "@/lib/empty-state";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { localToday } from "@/lib/local-today";
import { groupByDay } from "@/lib/schedule-days";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import type { ScheduleRow } from "@/lib/types";

/**
 * Who is planned on this job — a week either side of today.
 *
 * The past half is what makes this more than a calendar. `CrewScheduleDay`
 * has no `attended` column on purpose, so whether somebody worked a
 * planned day is derived from whether hours exist: a planned day with no
 * hours against it IS the missing timecard, and it shows up here on the
 * morning it still costs nothing to chase.
 *
 * Grouped by day rather than listed flat, because the question is always
 * "who is on tomorrow", never "list the assignments".
 */
export default function ScheduleScreen() {
  const { me } = useMe();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const getToken = useStableGetToken();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    // The token is fetched INSIDE the read: with no signal Clerk cannot
    // refresh it, and a screen that returns early on a null token never
    // reaches its own cache. See withToken().
    const result = await cachedRead(
      cacheKeys.schedule(jobId),
      withToken(getToken, (token) => api.listSchedule(jobId, token)),
    );
    if (result.from === "nothing") {
      setOffline("nothing");
      return;
    }
    setRows(result.value);
    setOffline(staleNote(result));
  }, [getToken, jobId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // The phone's day, not UTC's — see lib/local-today.ts.
  const today = localToday();
  const days = groupByDay(rows);

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["schedule/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["schedule/[jobId]"]} />;

  return (
    <View style={styles.screen}>
      <View style={styles.chipWrap}>
        <JobContextChip />
      </View>
      <SyncStatus state={offline} />

      <List
        data={days}
        keyExtractor={(day) => day.date}
        renderItem={({ item: day }) => (
          <Card style={styles.card}>
            <Text style={styles.date}>
              {day.date === today ? "Today" : day.date}
              {day.date < today ? " · past" : ""}
            </Text>
            {day.people.map((person) => (
              <View key={person.id} style={styles.person}>
                <Text style={styles.name}>{person.workerName}</Text>
                {person.craftLabel ? <Text style={styles.craft}>{person.craftLabel}</Text> : null}
                {/* Null is a future day, where "no hours" would be an
                    accusation rather than a fact. */}
                {person.hoursLogged === false ? <Text style={styles.missing}>No hours logged</Text> : null}
              </View>
            ))}
          </Card>
        )}
        {...emptyFor(offline, "the schedule", {
          title: "Nobody is scheduled on this job.",
          description: "Days are planned on the web, under Deployment.",
        })}
      />
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    chipWrap: { padding: space.md, paddingBottom: 0 },
    card: { gap: 8 },
    date: { color: p.colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
    person: { borderTopWidth: 1, borderTopColor: p.colors.lineRow, paddingTop: 8, gap: 2 },
    name: { color: p.colors.inkBody, fontSize: typography.size.md },
    craft: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    missing: {
      color: p.colors.tagAmberInk,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
  });
}
