import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { DateField } from "@/components/DateField";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { JobContextChip } from "@/components/JobContextChip";
import { Sheet } from "@/components/Sheet";
import { SyncStatus } from "@/components/SyncStatus";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { emptyFor } from "@/lib/empty-state";
import { useT } from "@/lib/i18n";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { localToday } from "@/lib/local-today";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import * as api from "@/lib/api";
import { uuid } from "@/lib/id";
import { saveQueued } from "@/lib/save-queued";
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
  const { t } = useT();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
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
  const [heldOn, setHeldOn] = useState(localToday());

  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [employeeName, setEmployeeName] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(localToday());
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

  const { pending, sync, refused, dismissRefused, retrySetAside } = useSync(load);

  const submitTalk = async () => {
    if (!jobId || !topic || !heldOn) return;
    // Queued BEFORE the form is cleared, so a phone that cannot write to
    // its own storage does not swallow what somebody typed. See
    // lib/save-queued.ts.
    const saved = await saveQueued({
      type: "toolbox-talk:create",
      jobId,
      clientOperationId: uuid(),
      topic,
      heldOn,
    });
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setError(null);
    setTopic("");
    setHeldOn(localToday());
    setShowTalkForm(false);
    await sync();
  };

  const submitIncident = async () => {
    if (!jobId || !employeeName || !description || !occurredAt) return;
    const saved = await saveQueued({
      type: "incident:create",
      jobId,
      clientOperationId: uuid(),
      employeeName,
      description,
      occurredAt,
      classification,
      outcome,
    });
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setError(null);
    setEmployeeName("");
    setDescription("");
    setOccurredAt(localToday());
    setShowIncidentForm(false);
    await sync();
  };

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["safety/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["safety/[jobId]"]} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <JobContextChip />
      <SyncStatus
        pending={pending}
        state={offline}
        refused={refused}
        onDismiss={dismissRefused}
        onRetry={retrySetAside}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t("safety.talks")}</Text>
        <Button variant="secondary" onPress={() => setShowTalkForm(true)}>
          {t("safety.addTalk")}
        </Button>
      </View>
      {talks.length === 0 ? (
        <EmptyState {...titles(emptyFor(offline, "thing.safety.talks", { title: "safety.noTalks" }))} />
      ) : (
        talks.map((talk) => (
          <Card key={talk.id}>
            <Text style={styles.cardTitle}>{talk.topic}</Text>
            <Text style={styles.cardMeta}>{talk.heldOn}</Text>
          </Card>
        ))
      )}

      <View style={[styles.sectionHead, styles.sectionHeadGap]}>
        <Text style={styles.sectionTitle}>{t("safety.incidents")}</Text>
        <Button variant="secondary" onPress={() => setShowIncidentForm(true)}>
          {t("safety.addIncident")}
        </Button>
      </View>
      {incidents.length === 0 ? (
        <EmptyState {...titles(emptyFor(offline, "thing.safety.incidents", { title: "safety.noIncidents" }))} />
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
        title={t("safety.talk.title")}
        primaryLabel={t("safety.talk.save")}
        onPrimary={submitTalk}
      >
        <Field
          label={t("safety.field.topic")}
          placeholder={t("safety.field.topicHint")}
          value={topic}
          onChangeText={setTopic}
        />
        <DateField label={t("common.date")} value={heldOn} onChange={setHeldOn} max={localToday()} />
      </Sheet>

      <Sheet
        visible={showIncidentForm}
        onClose={() => setShowIncidentForm(false)}
        title={t("safety.incident.title")}
        primaryLabel={t("safety.incident.save")}
        onPrimary={submitIncident}
      >
        <Field label={t("safety.field.employee")} value={employeeName} onChangeText={setEmployeeName} />
        <Field
          label={t("safety.field.description")}
          placeholder={t("safety.field.descriptionHint")}
          value={description}
          onChangeText={setDescription}
          multiline
        />
        <DateField label={t("common.date")} value={occurredAt} onChange={setOccurredAt} max={localToday()} />
        <Text style={styles.chipLabel}>{t("safety.classification")}</Text>
        <View style={styles.chips}>
          {CLASSIFICATIONS.map((c) => (
            <Chip key={c} label={c.replace(/_/g, " ")} selected={classification === c} onPress={() => setClassification(c)} />
          ))}
        </View>
        <Text style={styles.chipLabel}>{t("safety.outcome")}</Text>
        <View style={styles.chips}>
          {OUTCOMES.map((o) => (
            <Chip key={o} label={o.replace(/_/g, " ")} selected={outcome === o} onPress={() => setOutcome(o)} />
          ))}
        </View>
      </Sheet>
    </ScrollView>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    content: { padding: space.md, gap: space.sm, paddingBottom: space.xxl },
    error: { color: p.colors.tagRoseInk, fontSize: typography.size.sm },
    sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    sectionHeadGap: { marginTop: space.sm },
    sectionTitle: { color: p.colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.bold },
    cardTitle: { color: p.colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
    cardBody: { color: p.colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
    cardMeta: { color: p.colors.inkMuted, fontSize: typography.size.sm, marginTop: 4 },
    chipLabel: { color: p.colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  });
}
