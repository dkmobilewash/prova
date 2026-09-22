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
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { OfflineNote } from "@/components/OfflineNote";
import { emptyFor } from "@/lib/empty-state";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { uuid } from "@/lib/id";
import { enqueue } from "@/lib/sync-queue";
import { useSync } from "@/lib/use-sync";
import type { SafetyIncident, ToolboxTalk } from "@/lib/types";

const CLASSIFICATIONS = ["INJURY", "SKIN_DISORDER", "RESPIRATORY_CONDITION", "POISONING", "HEARING_LOSS", "OTHER_ILLNESS"];
const OUTCOMES = ["DEATH", "DAYS_AWAY", "RESTRICTED_OR_TRANSFER", "OTHER_RECORDABLE", "FIRST_AID_ONLY"];

/** `emptyFor` speaks the List's prop names; EmptyState takes its own. */
function titles({ emptyTitle, emptyDescription }: { emptyTitle: string; emptyDescription?: string }) {
  return { title: emptyTitle, description: emptyDescription };
}

export default function SafetyScreen() {
  const { me } = useMe();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [talks, setTalks] = useState<ToolboxTalk[]>([]);
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The line saying this came off the phone, or null when it is fresh;
   * "nothing" when there was no signal and nothing cached. */
  const [offline, setOffline] = useState<string | "nothing" | null>(null);

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
    if (!jobId) return;
    // Both lists under one key: half a screen fresh and the other half a
    // week old is worse than either.
    const result = await cachedRead(
      cacheKeys.safety(jobId),
      withToken(getToken, async (token) => ({
        talks: await api.listToolboxTalks(jobId, token),
        incidents: await api.listIncidents(jobId, token),
      })),
    );
    setError(null);
    if (result.from === "nothing") {
      setOffline("nothing");
      return;
    }
    setTalks(result.value.talks);
    setIncidents(result.value.incidents);
    setOffline(staleNote(result));
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const { pending, sync } = useSync(load);

  const submitTalk = async () => {
    if (!jobId || !topic || !heldOn) return;
    setTopic("");
    setHeldOn("");
    setShowTalkForm(false);
    await enqueue({ type: "toolbox-talk:create", jobId, clientOperationId: uuid(), topic, heldOn });
    await sync();
  };

  const submitIncident = async () => {
    if (!jobId || !employeeName || !description || !occurredAt) return;
    setEmployeeName("");
    setDescription("");
    setOccurredAt("");
    setShowIncidentForm(false);
    await enqueue({
      type: "incident:create",
      jobId,
      clientOperationId: uuid(),
      employeeName,
      description,
      occurredAt,
      classification,
      outcome,
    });
    await sync();
  };

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["safety/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["safety/[jobId]"]} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {pending > 0 ? <Text style={styles.pending}>Pending sync: {pending}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <OfflineNote state={offline} />

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Toolbox talks</Text>
        <Button variant="secondary" onPress={() => setShowTalkForm(true)}>
          Add talk
        </Button>
      </View>
      {talks.length === 0 ? (
        <EmptyState {...titles(emptyFor(offline, "the safety talks", { title: "No talks logged" }))} />
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
        <EmptyState {...titles(emptyFor(offline, "the incidents", { title: "No incidents" }))} />
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
  pending: { color: colors.link, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
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
