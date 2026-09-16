import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Sheet } from "@/components/Sheet";
import { colors, typography } from "@/lib/theme";
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
    (async () => {
      await load();
    })();
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Toolbox talks</Text>
        <Button variant="secondary" onPress={() => setShowTalkForm(true)}>
          Add talk
        </Button>
      </View>
      {talks.length === 0 ? (
        <EmptyState title="No talks logged" />
      ) : (
        talks.map((t) => (
          <Card key={t.id}>
            <Text style={styles.cardTitle}>{t.topic}</Text>
            <Text style={styles.cardMeta}>{t.heldOn}</Text>
          </Card>
        ))
      )}

      <View style={[styles.sectionHead, styles.sectionHeadGap]}>
        <Text style={styles.sectionTitle}>Incidents</Text>
        <Button variant="secondary" onPress={() => setShowIncidentForm(true)}>
          Add incident
        </Button>
      </View>
      {incidents.length === 0 ? (
        <EmptyState title="No incidents" />
      ) : (
        incidents.map((i) => (
          <Card key={i.id}>
            <Text style={styles.cardTitle}>{i.employeeName}</Text>
            <Text style={styles.cardBody}>{i.description}</Text>
            <Text style={styles.cardMeta}>
              #{i.caseNumber} · {i.outcome.replace(/_/g, " ")}
            </Text>
          </Card>
        ))
      )}

      <Sheet
        visible={showTalkForm}
        onClose={() => setShowTalkForm(false)}
        title="Add toolbox talk"
        primaryLabel="Save talk"
        onPrimary={submitTalk}
      >
        <Field label="Topic" placeholder="e.g. Fall protection" value={topic} onChangeText={setTopic} />
        <Field label="Date" placeholder="YYYY-MM-DD" value={heldOn} onChangeText={setHeldOn} />
      </Sheet>

      <Sheet
        visible={showIncidentForm}
        onClose={() => setShowIncidentForm(false)}
        title="Add incident"
        primaryLabel="Save incident"
        onPrimary={submitIncident}
      >
        <Field label="Employee name" value={employeeName} onChangeText={setEmployeeName} />
        <Field label="Description" placeholder="What happened" value={description} onChangeText={setDescription} multiline />
        <Field label="Date" placeholder="YYYY-MM-DD" value={occurredAt} onChangeText={setOccurredAt} />
        <Text style={styles.chipLabel}>Classification</Text>
        <View style={styles.chips}>
          {CLASSIFICATIONS.map((c) => (
            <Chip key={c} label={c.replace(/_/g, " ")} selected={classification === c} onPress={() => setClassification(c)} />
          ))}
        </View>
        <Text style={styles.chipLabel}>Outcome</Text>
        <View style={styles.chips}>
          {OUTCOMES.map((o) => (
            <Chip key={o} label={o.replace(/_/g, " ")} selected={outcome === o} onPress={() => setOutcome(o)} />
          ))}
        </View>
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 12 },
  error: { color: colors.tagRoseInk, fontSize: typography.size.sm },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionHeadGap: { marginTop: 12 },
  sectionTitle: { color: colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  cardTitle: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  cardBody: { color: colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
  cardMeta: { color: colors.inkMuted, fontSize: typography.size.sm, marginTop: 4 },
  chipLabel: { color: colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
