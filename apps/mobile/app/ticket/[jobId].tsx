import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { DateField } from "@/components/DateField";
import { Field } from "@/components/Field";
import { JobContextChip } from "@/components/JobContextChip";
import { List } from "@/components/List";
import { Sheet } from "@/components/Sheet";
import { SignaturePad } from "@/components/SignaturePad";
import { SyncStatus } from "@/components/SyncStatus";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { emptyFor } from "@/lib/empty-state";
import { useT } from "@/lib/i18n";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import * as api from "@/lib/api";
import { uuid } from "@/lib/id";
import { saveQueued } from "@/lib/save-queued";
import { useSync } from "@/lib/use-sync";
import type { TmTicket } from "@/lib/types";

/** The user's calendar date — the day the work was done, not the UTC day. */
function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function TicketScreen() {
  const { t } = useT();
  const { me } = useMe();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { getToken } = useAuth();
  const [tickets, setTickets] = useState<TmTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [workDate, setWorkDate] = useState(localToday());
  const [workDescription, setWorkDescription] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signaturePath, setSignaturePath] = useState<string | null>(null);

  const load = async () => {
    if (!jobId) return;
    const result = await cachedRead(
      cacheKeys.tickets(jobId),
      withToken(getToken, (token) => api.listTmTickets(jobId, token)),
    );
    setError(null);
    if (result.from === "nothing") {
      setOffline("nothing");
      return;
    }
    setTickets(result.value);
    setOffline(staleNote(result));
  };


  const { pending, sync, refused, dismissRefused, retrySetAside } = useSync(load);

  const canSubmit = !!workDate && !!workDescription.trim() && !!signerName.trim() && signaturePath !== null;

  const submit = async () => {
    if (!jobId || !canSubmit || !signaturePath) return;
    const op = {
      type: "ticket:create" as const,
      jobId,
      clientOperationId: uuid(),
      workDate,
      workDescription: workDescription.trim(),
      signerName: signerName.trim(),
      signaturePath,
    };
    // Queued BEFORE the form is cleared — see lib/save-queued.ts. This
    // one carries a signature the GC's super just drew; losing it
    // silently would mean asking them to sign again for no stated reason.
    const saved = await saveQueued(op);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setError(null);
    setWorkDescription("");
    setSignerName("");
    setSignaturePath(null);
    setShowForm(false);
    await sync();
  };

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["ticket/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["ticket/[jobId]"]} />;

  return (
    <View style={styles.screen}>
      <View style={styles.chipWrap}>
        <JobContextChip />
      </View>
      <SyncStatus
        pending={pending}
        state={offline}
        refused={refused}
        onDismiss={dismissRefused}
        onRetry={retrySetAside}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <List
        data={tickets}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.head}>
              <Text style={styles.date}>{item.workDate}</Text>
              <Text style={styles.signer}>
                {t("tickets.signed", { name: item.signerName })}
                {item.hasSignature === false ? ` ${t("tickets.typed")}` : ""}
              </Text>
            </View>
            <Text style={styles.description}>{item.workDescription}</Text>
            {item.snapshot ? (
              <Text style={styles.summary}>
                {item.snapshot.labor.length === 1
                  ? t("tickets.snapshot.labor.one")
                  : t("tickets.snapshot.labor.many", { count: item.snapshot.labor.length })}
                {" · "}
                {item.snapshot.materials.length === 1
                  ? t("tickets.snapshot.materials.one")
                  : t("tickets.snapshot.materials.many", { count: item.snapshot.materials.length })}
              </Text>
            ) : null}
          </Card>
        )}
        {...emptyFor(offline, "thing.tickets", {
          title: "tickets.empty.title",
          description: "tickets.empty.body",
        })}
      />

      <View style={styles.footer}>
        <Button fullWidth onPress={() => setShowForm(true)}>
          {t("tickets.new")}
        </Button>
      </View>

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={t("tickets.sheet.title")}
        primaryLabel={t("tickets.sheet.save")}
        onPrimary={submit}
        primaryDisabled={!canSubmit}
      >
        <DateField label={t("common.date")} value={workDate} onChange={setWorkDate} max={localToday()} />
        <Field
          label={t("tickets.field.what")}
          placeholder={t("tickets.field.whatHint")}
          value={workDescription}
          onChangeText={setWorkDescription}
          multiline
        />
        <Field
          label={t("tickets.field.signer")}
          placeholder={t("tickets.field.signerHint")}
          value={signerName}
          onChangeText={setSignerName}
        />
        <Text style={styles.label}>{t("tickets.field.signature")}</Text>
        <SignaturePad key={showForm ? "open" : "closed"} onChange={setSignaturePath} />
      </Sheet>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    chipWrap: { padding: space.md, paddingBottom: 0 },
    error: { color: p.colors.tagRoseInk, padding: space.md, paddingBottom: 0, fontSize: typography.size.sm },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    date: { color: p.colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
    signer: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    description: { color: p.colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
    label: { color: p.colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    summary: { color: p.colors.inkMuted, fontSize: typography.size.sm, marginTop: 4 },
    footer: { padding: space.md, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: p.colors.lineRow },
  });
}
