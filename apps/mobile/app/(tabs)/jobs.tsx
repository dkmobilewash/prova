import { useAuth } from "@clerk/expo";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { List } from "@/components/List";
import { StatusBadge } from "@/components/StatusBadge";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import { setCurrentJob } from "@/lib/current-job";
import { useCurrentJob } from "@/lib/use-current-job";
import type { Job } from "@/lib/types";

/** Every job, and the place you change which one the phone is on. Opening
 * a job makes it the CURRENT job — Home, Create and Camera all act on it
 * from then on, so choosing a job and going to work are the same gesture
 * rather than two. */
export default function JobsScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const { job: current } = useCurrentJob();
  const getToken = useStableGetToken();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        setJobs(await api.listJobs(token));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load jobs");
      }
    })();
  }, [isSignedIn, getToken]);

  if (!isLoaded) return <Text style={styles.loading}>Loading…</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <List
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={async () => {
              await setCurrentJob({ id: item.id, name: item.name, status: item.status });
              router.push({
                pathname: "/job/[jobId]",
                params: { jobId: item.id, name: item.name, status: item.status },
              });
            }}
          >
            <Card>
              <View style={styles.jobRow}>
                <Text style={styles.jobName}>{item.name}</Text>
                {current?.id === item.id ? <Text style={styles.onThis}>On this job</Text> : null}
              </View>
              <StatusBadge status={item.status} />
            </Card>
          </Pressable>
        )}
        emptyTitle="No jobs yet"
        emptyDescription="Jobs appear here once they're created in the office."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loading: { color: colors.ink, fontSize: typography.size.md, padding: 16 },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  jobRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  jobName: {
    color: colors.ink,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    flex: 1,
  },
  onThis: { color: colors.link, fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
});
