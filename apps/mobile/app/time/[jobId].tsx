import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { Field } from "@/components/Field";
import { List } from "@/components/List";
import { Sheet } from "@/components/Sheet";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { uuid } from "@/lib/id";
import { enqueue } from "@/lib/sync-queue";
import { useSync } from "@/lib/use-sync";
import type { TimeEntry, TimeEntryPayType } from "@/lib/types";

const PAY_TYPES: TimeEntryPayType[] = ["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"];

export default function TimeScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState("");
  const [hours, setHours] = useState("");
  const [payType, setPayType] = useState<TimeEntryPayType>("STRAIGHT");
  const [note, setNote] = useState("");

  const load = async () => {
    const token = await getToken();
    if (!token || !jobId) return;
    try {
      setEntries(await api.listTimeEntries(jobId, token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load time");
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const { pending, sync } = useSync(load);

  const submit = async () => {
    if (!jobId || !date || !hours) return;
    setDate("");
    setHours("");
    setNote("");
    setShowForm(false);
    await enqueue({
      type: "time:create",
      jobId,
      clientOperationId: uuid(),
      date,
      hours,
      payType,
      note: note || undefined,
    });
    await sync();
  };

  return (
    <View style={styles.screen}>
      {pending > 0 ? <Text style={styles.pending}>Pending sync: {pending}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <List
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.entryHead}>
              <Text style={styles.date}>{item.date}</Text>
              <Text style={styles.hours}>{item.hours}h</Text>
            </View>
            <Text style={styles.meta}>
              {item.employeeName} · {item.payType.replace(/_/g, " ")}
            </Text>
            {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
          </Card>
        )}
        emptyTitle="No time logged"
        emptyDescription="Tap “Log time” to record the day's hours."
      />

      <View style={styles.footer}>
        <Button fullWidth onPress={() => setShowForm(true)}>
          Log time
        </Button>
      </View>

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title="Log time"
        primaryLabel="Save entry"
        onPrimary={submit}
      >
        <Field label="Date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} />
        <Field label="Hours" placeholder="e.g. 8 or 8.5" value={hours} onChangeText={setHours} keyboardType="decimal-pad" />
        <Field label="Note" placeholder="Optional" value={note} onChangeText={setNote} />
        <Text style={styles.payLabel}>Pay type</Text>
        <View style={styles.chips}>
          {PAY_TYPES.map((p) => (
            <Chip key={p} label={p.replace(/_/g, " ")} selected={payType === p} onPress={() => setPayType(p)} />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  pending: { color: colors.link, padding: 16, paddingBottom: 0, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  entryHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  hours: { color: colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  meta: { color: colors.inkMuted, fontSize: typography.size.sm },
  note: { color: colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
  payLabel: { color: colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
});
