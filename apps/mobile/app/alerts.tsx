import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { List } from "@/components/List";
import { OfflineNote } from "@/components/OfflineNote";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { emptyFor } from "@/lib/empty-state";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import type { AlertRow } from "@/lib/types";

/**
 * The phone's alert list — what a notification tap lands on, and what the
 * notification was a pointer to. Read-only, per-principal, and already
 * money-stripped server-side: the phone renders no figures, and it must
 * never be a second place deciding who may see them.
 *
 * The severity wording and colours are the web's own (alertLabels.ts and
 * the tag pairs), so the bell, the list and this screen cannot tell
 * different stories about the same alert.
 */
const SEVERITY: Record<AlertRow["severity"], { label: string; bg: string; ink: string }> = {
  OVERDUE: { label: "Past due", bg: colors.tagRose, ink: colors.tagRoseInk },
  DUE_SOON: { label: "Coming up", bg: colors.tagAmber, ink: colors.tagAmberInk },
  STANDING: { label: "Standing", bg: colors.tagSlate, ink: colors.tagSlateInk },
};

export default function AlertsScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const getToken = useStableGetToken();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    (async () => {
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
        return;
      }
      setAlerts(result.value);
      setOffline(staleNote(result));
    })();
  }, [isSignedIn, getToken]);

  if (!isLoaded) return <Text style={styles.loading}>Loading…</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <View style={styles.screen}>
      <OfflineNote state={offline} />
      <List
        data={alerts}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          const severity = SEVERITY[item.severity];
          return (
            <Card>
              <View style={styles.row}>
                <View style={[styles.chip, { backgroundColor: severity.bg }]}>
                  <Text style={[styles.chipLabel, { color: severity.ink }]}>
                    {severity.label}
                  </Text>
                </View>
              </View>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.detail}>{item.detail}</Text>
            </Card>
          );
        }}
        {...emptyFor(offline, "the alerts", {
          title: "Nothing needs attention",
          description: "Alerts appear here when something needs doing.",
        })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loading: { color: colors.ink, fontSize: typography.size.md, padding: 16 },
  row: { flexDirection: "row", marginBottom: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  chipLabel: { fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
  title: {
    color: colors.ink,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  detail: { color: colors.inkBody, fontSize: typography.size.sm, marginTop: 2 },
});
