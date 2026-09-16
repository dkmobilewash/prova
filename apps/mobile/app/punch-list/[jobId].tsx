import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { colors } from "@/lib/theme";
import * as api from "@/lib/api";
import type { PunchListItem } from "@/lib/types";

export default function PunchListScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [items, setItems] = useState<PunchListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");

  const load = async () => {
    const token = await getToken();
    if (!token || !jobId) return;
    try {
      setItems(await api.listPunchListItems(jobId, token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load punch list");
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const submit = async () => {
    const token = await getToken();
    if (!token || !jobId || !description.trim()) return;
    try {
      await api.createPunchListItem(jobId, { description: description.trim() }, token);
      setDescription("");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add item");
    }
  };

  const toggle = async (item: PunchListItem) => {
    const token = await getToken();
    if (!token || !jobId) return;
    try {
      await api.setPunchListItemDone(jobId, item.id, !item.isDone, token);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update item");
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
      {error ? <Text style={{ color: colors.tagRoseInk, marginBottom: 12 }}>{error}</Text> : null}

      <Button variant="secondary" onPress={() => setShowForm((v) => !v)}>
        {showForm ? "Cancel" : "Add item"}
      </Button>
      {showForm ? (
        <View style={{ gap: 8, marginBottom: 12 }}>
          <TextInput
            placeholder="What needs fixing"
            placeholderTextColor={colors.inkMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            style={[inputStyle, { minHeight: 60, textAlignVertical: "top" }]}
          />
          <Button variant="primary" onPress={submit}>
            Save item
          </Button>
        </View>
      ) : null}

      {items.length === 0 ? (
        <Text style={{ color: colors.inkMuted, marginTop: 16 }}>
          Nothing outstanding on this job.
        </Text>
      ) : (
        items.map((item) => (
          <Card key={item.id} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <Pressable
                onPress={() => toggle(item)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.isDone }}
                accessibilityLabel={item.isDone ? "Mark as not done" : "Mark as done"}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: item.isDone ? colors.brand : colors.lineCard,
                  backgroundColor: item.isDone ? colors.brand : colors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 1,
                }}
              >
                {item.isDone ? <Text style={{ color: "#ffffff", lineHeight: 18 }}>✓</Text> : null}
              </Pressable>
              <Text
                style={{
                  color: item.isDone ? colors.inkMuted : colors.ink,
                  textDecorationLine: item.isDone ? "line-through" : "none",
                  flex: 1,
                }}
              >
                {item.description}
              </Text>
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.lineCard,
  backgroundColor: colors.surface,
  borderRadius: 6,
  padding: 10,
  color: colors.ink,
};
