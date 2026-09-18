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
import type { Job } from "@/lib/types";

export default function JobsScreen() {
  const { isLoaded, isSignedIn } = useAuth();
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
            onPress={() =>
              router.push({
                pathname: "/job/[jobId]",
                params: { jobId: item.id, name: item.name, status: item.status },
              })
            }
          >
            <Card>
              <Text style={styles.jobName}>{item.name}</Text>
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
  jobName: {
    color: colors.ink,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    marginBottom: 8,
  },
});
