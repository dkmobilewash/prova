import { useAuth } from "@clerk/expo";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import * as api from "@/lib/api";
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

  if (!isLoaded) return <Text>Loading…</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <View style={{ padding: 16, gap: 12, flex: 1 }}>
      {error ? <Text style={{ color: "#b00" }}>{error}</Text> : null}
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/reports/${item.id}`)}
            style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#eee" }}
          >
            <Text style={{ fontWeight: "600" }}>{item.name}</Text>
            <Text style={{ color: "#666" }}>{item.status.replace("_", " ")}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
