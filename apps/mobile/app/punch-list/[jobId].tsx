import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { List } from "@/components/List";
import { Sheet } from "@/components/Sheet";
import { colors, typography } from "@/lib/theme";
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
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <List
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card style={styles.itemCard}>
            <Pressable
              onPress={() => toggle(item)}
              style={styles.itemRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.isDone }}
              accessibilityLabel={item.isDone ? "Mark as not done" : "Mark as done"}
            >
              <View style={[styles.box, item.isDone && styles.boxDone]}>
                {item.isDone ? <Text style={styles.check}>✓</Text> : null}
              </View>
              <Text style={[styles.description, item.isDone && styles.descriptionDone]}>
                {item.description}
              </Text>
            </Pressable>
          </Card>
        )}
        emptyTitle="Nothing outstanding on this job."
        emptyDescription="Tap “Add item” to log what still needs fixing."
      />

      <View style={styles.footer}>
        <Button fullWidth onPress={() => setShowForm(true)}>
          Add item
        </Button>
      </View>

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title="Add punch list item"
        primaryLabel="Save item"
        onPrimary={submit}
      >
        <Field
          label="What needs fixing"
          placeholder="e.g. Ceiling grid out of level"
          value={description}
          onChangeText={setDescription}
          multiline
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  itemCard: { padding: 0 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  box: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.lineCard,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  boxDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  check: { color: colors.brandInk, fontSize: 18, fontWeight: typography.weight.bold, lineHeight: 22 },
  description: { color: colors.ink, fontSize: typography.size.md, flex: 1 },
  descriptionDone: { color: colors.inkMuted, textDecorationLine: "line-through" },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
});
