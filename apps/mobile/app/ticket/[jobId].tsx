import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { DateField } from "@/components/DateField";
import { Field } from "@/components/Field";
import { List } from "@/components/List";
import { RefusedBanner } from "@/components/RefusedBanner";
import { Sheet } from "@/components/Sheet";
import { SignaturePad } from "@/components/SignaturePad";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { OfflineNote } from "@/components/OfflineNote";
import { emptyFor } from "@/lib/empty-state";
import { useT } from "@/lib/i18n";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { uuid } from "@/lib/id";
import { enqueue } from "@/lib/sync-queue";
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
    setWorkDescription("");
    setSignerName("");
    setSignaturePath(null);
    setShowForm(false);
    await enqueue(op);
    await sync();
  };

  return (
    <View style={styles.screen}>
      {pending > 0 ? <Text style={styles.pending}>{t("common.pendingSync", { count: pending })}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <OfflineNote state={offline} />
      <RefusedBanner refused={refused} onDismiss={dismissRefused} onRetry={retrySetAside} />
      <List
        data={tickets}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.head}>
              <Text style={styles.date}>{item.workDate}</Text>
              <Text style={styles.signer}>
                Signed: {item.signerName}
                {item.hasSignature === false ? " (typed)" : ""}
              </Text>
            </View>
            <Text style={styles.description}>{item.workDescription}</Text>
            {item.snapshot ? (
              <Text style={styles.summary}>
                {item.snapshot.labor.length} labour entr{item.snapshot.labor.length === 1 ? "y" : "ies"} ·{" "}
                {item.snapshot.materials.length} material{item.snapshot.materials.length === 1 ? "" : "s"}
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
          New ticket
        </Button>
      </View>

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title="New T&M ticket"
        primaryLabel="Sign & save"
        onPrimary={submit}
        primaryDisabled={!canSubmit}
      >
        <DateField label="Date" value={workDate} onChange={setWorkDate} max={localToday()} />
        <Field
          label="What was done"
          placeholder="Describe the extra work"
          value={workDescription}
          onChangeText={setWorkDescription}
          multiline
        />
        <Field
          label="Client's name"
          placeholder="Printed under their signature"
          value={signerName}
          onChangeText={setSignerName}
        />
        <Text style={styles.label}>Client&rsquo;s signature</Text>
        <SignaturePad key={showForm ? "open" : "closed"} onChange={setSignaturePath} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  pending: { color: colors.link, padding: 16, paddingBottom: 0, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  signer: { color: colors.inkMuted, fontSize: typography.size.sm },
  description: { color: colors.inkBody, fontSize: typography.size.md, marginTop: 4 },
  label: { color: colors.inkLabel, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  summary: { color: colors.inkMuted, fontSize: typography.size.sm, marginTop: 4 },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
});
