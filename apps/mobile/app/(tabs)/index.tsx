import { useAuth } from "@clerk/expo";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import * as api from "@/lib/api";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/lib/theme";
import type { Job } from "@/lib/types";

export default function JobsScreen() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
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

  if (!isLoaded) return <Text style={{ color: colors.ink }}>Loading…</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
      {error ? <Text style={{ color: colors.tagRoseInk, marginBottom: 12 }}>{error}</Text> : null}
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 12 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/reports/${item.id}`)}>
            <Card>
              <Text style={{ fontWeight: "600", color: colors.ink, marginBottom: 6 }}>{item.name}</Text>
              <StatusBadge status={item.status} />
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}
