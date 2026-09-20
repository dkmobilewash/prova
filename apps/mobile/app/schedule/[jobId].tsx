import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { List } from "@/components/List";
import { OfflineNote } from "@/components/OfflineNote";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote } from "@/lib/cached-read";
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
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const getToken = useStableGetToken();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    const token = await getToken();
    if (!token) return;
    const result = await cachedRead(cacheKeys.schedule(jobId), () => api.listSchedule(jobId, token));
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

  const today = new Date().toISOString().slice(0, 10);
  const days = groupByDay(rows);

  return (
    <View style={styles.screen}>
      <OfflineNote state={offline} />

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
        emptyTitle={offline === "nothing" ? "Can't load the schedule right now." : "Nobody is scheduled on this job."}
        emptyDescription={
          offline === "nothing"
            ? "No connection, and this phone hasn't loaded it before."
            : "Days are planned on the web, under Deployment."
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  card: { gap: 8 },
  date: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  person: { borderTopWidth: 1, borderTopColor: colors.lineRow, paddingTop: 8, gap: 2 },
  name: { color: colors.inkBody, fontSize: typography.size.md },
  craft: { color: colors.inkMuted, fontSize: typography.size.sm },
  missing: { color: colors.tagAmberInk, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
});
