import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { useT } from "@/lib/i18n";
import { colors, typography } from "@/lib/theme";
import { tokenOrNull } from "@/lib/clerk-token";
import { jobNames, statusOf, toOutboxItem, triesLeft, describeRefused, type OutboxItem } from "@/lib/outbox";
import {
  clearRefused,
  flushQueue,
  listQueued,
  listRefused,
  removeQueued,
  retryRefused,
  sendNow,
  type RefusedOp,
} from "@/lib/sync-queue";
import { useStableGetToken } from "@/lib/use-stable-get-token";

/**
 * Everything this phone is still holding, in one place.
 *
 * Before this there was a number — "Pending sync: 3" — on whichever
 * screen you happened to be standing on, and nothing anywhere could tell
 * you WHICH three, how old they were, or why one of them was not moving.
 * A foreman who logs eight hours in a basement and drives home could not
 * find out whether the office has them. That is the whole point of this
 * screen: the count was never the question.
 *
 * Two sections, and the difference between them is the difference the
 * whole queue is built around. "Waiting to send" is ordinary — no signal,
 * nothing wrong, it goes up by itself. "Needs attention" is the server
 * having ANSWERED and said no: nothing more will happen to those until a
 * person decides, so they are shown with what the server said and the two
 * decisions available — put it back on the queue, or let it go.
 */
export default function OutboxScreen() {
  const { t } = useT();
  const getToken = useStableGetToken();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [refused, setRefused] = useState<RefusedOp[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [queued, setAside, jobs] = await Promise.all([listQueued(), listRefused(), jobNames()]);
    setNames(jobs);
    setItems(queued.map((op) => toOutboxItem(op, jobs)));
    setRefused(setAside);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const send = async () => {
    setBusy(true);
    setNote(null);
    // "Send now" means NOW: the backoff a failing write is sitting out is
    // cleared first, because the person pressing this button is telling
    // the phone that something has changed — usually that they have walked
    // outside.
    await sendNow();
    const token = await tokenOrNull(getToken);
    if (!token) {
      setNote(t("outbox.stillOffline"));
    } else {
      try {
        await flushQueue(token);
      } catch {
        setNote(t("outbox.signInAgain"));
      }
    }
    await load();
    setBusy(false);
  };

  const nothingHeld = items.length === 0 && refused.length === 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {nothingHeld ? (
        <EmptyState
          title={t("outbox.empty.title")}
          description={t("outbox.empty.body")}
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <Text style={styles.heading}>{t("outbox.waiting")}</Text>
          {items.map((item) => (
            <Card key={item.opId}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.detail}>{item.detail}</Text>
              <Text style={item.attempts > 0 ? styles.trying : styles.waiting}>{statusOf(item)}</Text>
              {item.attempts > 0 ? (
                <Text style={styles.detail}>
                  {triesLeft(item) === 1
                    ? t("outbox.triesLeft.one")
                    : t("outbox.triesLeft.many", { count: triesLeft(item) })}
                </Text>
              ) : null}
              <View style={styles.row}>
                <Button
                  variant="secondary"
                  onPress={async () => {
                    await removeQueued(item.opId);
                    await load();
                  }}
                >
                  {t("outbox.remove")}
                </Button>
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {refused.length > 0 ? (
        <>
          <Text style={styles.heading}>{t("outbox.needsAttention")}</Text>
          <Text style={styles.detail}>{t("outbox.needsAttention.body")}</Text>
          {refused.map((entry, index) => {
            const { title, detail } = describeRefused(entry, names);
            return (
              <Card key={`${entry.at}-${index}`}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.detail}>{detail}</Text>
                <Text style={styles.refused}>{t("outbox.serverSaid", { error: entry.error })}</Text>
              </Card>
            );
          })}
          <View style={styles.row}>
            <Button
              variant="secondary"
              onPress={async () => {
                await retryRefused();
                await load();
              }}
            >
              {t("outbox.putBack")}
            </Button>
            <Button
              variant="secondary"
              onPress={async () => {
                await clearRefused();
                await load();
              }}
            >
              {t("outbox.letGo")}
            </Button>
          </View>
        </>
      ) : null}

      {note ? <Text style={styles.note}>{note}</Text> : null}

      {items.length > 0 ? (
        <Button fullWidth disabled={busy} onPress={send}>
          {busy ? t("outbox.sending") : t("outbox.sendNow")}
        </Button>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 12 },
  heading: { color: colors.ink, fontSize: typography.size.lg, fontWeight: typography.weight.semibold },
  title: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  detail: { color: colors.inkBody, fontSize: typography.size.sm },
  waiting: { color: colors.inkMuted, fontSize: typography.size.sm },
  trying: { color: colors.tagAmberInk, fontSize: typography.size.sm },
  refused: { color: colors.tagRoseInk, fontSize: typography.size.sm },
  note: { color: colors.inkBody, fontSize: typography.size.sm },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
});
