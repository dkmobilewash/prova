import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { colors } from "@/lib/theme";
import * as api from "@/lib/api";
import type { SafetyIncident, ToolboxTalk } from "@/lib/types";

const CLASSIFICATIONS = ["INJURY", "SKIN_DISORDER", "RESPIRATORY_CONDITION", "POISONING", "HEARING_LOSS", "OTHER_ILLNESS"];
const OUTCOMES = ["DEATH", "DAYS_AWAY", "RESTRICTED_OR_TRANSFER", "OTHER_RECORDABLE", "FIRST_AID_ONLY"];

export default function SafetyScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [talks, setTalks] = useState<ToolboxTalk[]>([]);
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showTalkForm, setShowTalkForm] = useState(false);
  const [topic, setTopic] = useState("");
  const [heldOn, setHeldOn] = useState("");

  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [employeeName, setEmployeeName] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [classification, setClassification] = useState("INJURY");
  const [outcome, setOutcome] = useState("FIRST_AID_ONLY");

  const load = async () => {
    const token = await getToken();
    if (!token || !jobId) return;
    try {
      setTalks(await api.listToolboxTalks(jobId, token));
      setIncidents(await api.listIncidents(jobId, token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load safety");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const submitTalk = async () => {
    const token = await getToken();
    if (!token || !jobId || !topic || !heldOn) return;
    try {
      await api.createToolboxTalk(jobId, { topic, heldOn }, token);
      setTopic("");
      setHeldOn("");
      setShowTalkForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add talk");
    }
  };

  const submitIncident = async () => {
    const token = await getToken();
    if (!token || !jobId || !employeeName || !description || !occurredAt) return;
    try {
      await api.createIncident(jobId, { employeeName, description, occurredAt, classification, outcome }, token);
      setEmployeeName("");
      setDescription("");
      setOccurredAt("");
      setShowIncidentForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add incident");
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
      {error ? <Text style={{ color: colors.tagRoseInk, marginBottom: 12 }}>{error}</Text> : null}

      <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 18, marginBottom: 8 }}>Toolbox talks</Text>
      <Button variant="secondary" onPress={() => setShowTalkForm((v) => !v)}>
        {showTalkForm ? "Cancel" : "Add talk"}
      </Button>
      {showTalkForm ? (
        <View style={{ gap: 8, marginBottom: 12 }}>
          <TextInput placeholder="Topic" placeholderTextColor={colors.inkMuted} value={topic} onChangeText={setTopic} style={inputStyle} />
          <TextInput placeholder="Date (YYYY-MM-DD)" placeholderTextColor={colors.inkMuted} value={heldOn} onChangeText={setHeldOn} style={inputStyle} />
          <Button variant="primary" onPress={submitTalk}>Save talk</Button>
        </View>
      ) : null}
      {talks.map((t) => (
        <Card key={t.id} style={{ marginBottom: 8 }}>
          <Text style={{ color: colors.ink, fontWeight: "600" }}>{t.topic}</Text>
          <Text style={{ color: colors.inkMuted }}>{t.heldOn}</Text>
        </Card>
      ))}

      <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 18, marginBottom: 8, marginTop: 20 }}>Incidents</Text>
      <Button variant="secondary" onPress={() => setShowIncidentForm((v) => !v)}>
        {showIncidentForm ? "Cancel" : "Add incident"}
      </Button>
      {showIncidentForm ? (
        <View style={{ gap: 8, marginBottom: 12 }}>
          <TextInput placeholder="Employee name" placeholderTextColor={colors.inkMuted} value={employeeName} onChangeText={setEmployeeName} style={inputStyle} />
          <TextInput placeholder="Description" placeholderTextColor={colors.inkMuted} value={description} onChangeText={setDescription} multiline style={[inputStyle, { minHeight: 60, textAlignVertical: "top" }]} />
          <TextInput placeholder="Date (YYYY-MM-DD)" placeholderTextColor={colors.inkMuted} value={occurredAt} onChangeText={setOccurredAt} style={inputStyle} />
          <Text style={{ color: colors.inkLabel }}>Classification</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CLASSIFICATIONS.map((c) => (
              <Chip key={c} label={c} selected={classification === c} onPress={() => setClassification(c)} />
            ))}
          </View>
          <Text style={{ color: colors.inkLabel }}>Outcome</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {OUTCOMES.map((o) => (
              <Chip key={o} label={o} selected={outcome === o} onPress={() => setOutcome(o)} />
            ))}
          </View>
          <Button variant="primary" onPress={submitIncident}>Save incident</Button>
        </View>
      ) : null}
      {incidents.map((i) => (
        <Card key={i.id} style={{ marginBottom: 8 }}>
          <Text style={{ color: colors.ink, fontWeight: "600" }}>{i.employeeName}</Text>
          <Text style={{ color: colors.inkBody }}>{i.description}</Text>
          <Text style={{ color: colors.inkMuted }}>
            #{i.caseNumber} · {i.outcome.replace(/_/g, " ")}
          </Text>
        </Card>
      ))}
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: selected ? colors.brand : colors.surface,
        borderWidth: 1,
        borderColor: colors.lineCard,
      }}
    >
      <Text style={{ color: selected ? "#ffffff" : colors.inkBody }}>{label}</Text>
    </Pressable>
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
