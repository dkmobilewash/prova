import { useAuth } from "@clerk/clerk-expo";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();
  const [jobId, setJobId] = useState("");

  if (!isLoaded) return <Text>Loading…</Text>;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text>Field reports</Text>
      <TextInput
        placeholder="Job ID"
        value={jobId}
        onChangeText={setJobId}
        autoCapitalize="none"
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 10 }}
      />
      <Pressable
        onPress={() => {
          if (jobId.trim()) router.push(`/reports/${jobId.trim()}`);
        }}
        style={{ backgroundColor: "#111", borderRadius: 6, padding: 12 }}
      >
        <Text style={{ color: "#fff", textAlign: "center" }}>Open reports</Text>
      </Pressable>
    </View>
  );
}
