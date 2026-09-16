import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { colors } from "@/lib/theme";
import * as api from "@/lib/api";
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const submit = async () => {
    const token = await getToken();
    if (!token || !jobId || !date || !hours) return;
    try {
      await api.createTimeEntry(jobId, { date, hours, payType, note }, token);
      setDate("");
      setHours("");
      setNote("");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log time");
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
      {error ? <Text style={{ color: colors.tagRoseInk, marginBottom: 12 }}>{error}</Text> : null}

      <Button variant="secondary" onPress={() => setShowForm((v) => !v)}>
        {showForm ? "Cancel" : "Log time"}
      </Button>
      {showForm ? (
        <View style={{ gap: 8, marginBottom: 12 }}>
          <TextInput placeholder="Date (YYYY-MM-DD)" placeholderTextColor={colors.inkMuted} value={date} onChangeText={setDate} style={inputStyle} />
          <TextInput placeholder="Hours (e.g. 8 or 8.5)" placeholderTextColor={colors.inkMuted} value={hours} onChangeText={setHours} keyboardType="decimal-pad" style={inputStyle} />
          <TextInput placeholder="Note" placeholderTextColor={colors.inkMuted} value={note} onChangeText={setNote} style={inputStyle} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {PAY_TYPES.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPayType(p)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: payType === p ? colors.brand : colors.surface,
                  borderWidth: 1,
                  borderColor: colors.lineCard,
                }}
              >
                <Text style={{ color: payType === p ? "#ffffff" : colors.inkBody }}>{p.replace(/_/g, " ")}</Text>
              </Pressable>
            ))}
          </View>
          <Button variant="primary" onPress={submit}>Save entry</Button>
        </View>
      ) : null}

      {entries.map((e) => (
        <Card key={e.id} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>{e.date}</Text>
            <Text style={{ color: colors.ink }}>{e.hours}h</Text>
          </View>
          <Text style={{ color: colors.inkMuted }}>
            {e.employeeName} · {e.payType.replace(/_/g, " ")}
          </Text>
          {e.note ? <Text style={{ color: colors.inkBody }}>{e.note}</Text> : null}
        </Card>
      ))}
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
