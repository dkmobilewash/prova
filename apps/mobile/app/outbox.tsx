import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { SectionHeader } from "@/components/SectionHeader";
import { type Palette, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
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
  const getToken = useStableGetToken();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
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
      setNote("Still no connection. Everything here is kept until there is.");
    } else {
      try {
        await flushQueue(token);
      } catch {
        setNote("Sign-in expired — open any screen to sign in again, then send.");
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
          title="Everything on this phone has reached the office."
          description="Anything you save with no signal waits here until it can go up, and this screen tells you which."
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <SectionHeader uppercase={false}>Waiting to send</SectionHeader>
          <GroupedList>
            {items.map((item, i) => (
              <GroupedRow
                key={item.opId}
                icon={<View style={styles.waitingDot} />}
                title={item.title}
                subtitle={item.detail}
                detail={statusOf(item)}
                note={
                  item.attempts > 0
                    ? triesLeft(item) === 1
                      ? "One more try, then it moves to Needs attention."
                      : `${triesLeft(item)} more tries, then it moves to Needs attention.`
                    : undefined
                }
                divider={i > 0}
                chevron={false}
              >
                <View style={styles.rowActions}>
                  <Button
                    variant="secondary"
                    onPress={async () => {
                      await removeQueued(item.opId);
                      await load();
                    }}
                  >
                    Remove
                  </Button>
                </View>
              </GroupedRow>
            ))}
          </GroupedList>
        </>
      ) : null}

      {refused.length > 0 ? (
        <>
          <SectionHeader uppercase={false}>Needs attention</SectionHeader>
          <Text style={styles.detail}>
            The server read these and said no. They will not go up on their own.
          </Text>
          <GroupedList>
            {refused.map((entry, index) => {
              const { title, detail } = describeRefused(entry, names);
              return (
                <GroupedRow
                  key={`${entry.at}-${index}`}
                  icon={<View style={styles.refusedDot} />}
                  title={title}
                  subtitle={detail}
                  note={`The server said: “${entry.error}”`}
                  divider={index > 0}
                  chevron={false}
                />
              );
            })}
          </GroupedList>
          <View style={styles.row}>
            <Button
              variant="secondary"
              onPress={async () => {
                await retryRefused();
                await load();
              }}
            >
              Put them back on
            </Button>
            <Button
              variant="secondary"
              onPress={async () => {
                await clearRefused();
                await load();
              }}
            >
              Let them go
            </Button>
          </View>
        </>
      ) : null}

      {note ? <Text style={styles.note}>{note}</Text> : null}

      {items.length > 0 ? (
        <View style={styles.sendRow}>
          <Button fullWidth disabled={busy} onPress={send}>
            {busy ? "Sending…" : "Send now"}
          </Button>
        </View>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    content: { padding: space.md, paddingBottom: space.xxl },
    detail: {
      color: p.colors.inkBody,
      fontSize: typography.size.sm,
      paddingHorizontal: space.md,
      paddingBottom: space.xs,
    },
    note: {
      color: p.colors.inkBody,
      fontSize: typography.size.sm,
      paddingHorizontal: space.md,
      paddingTop: space.sm,
    },
    row: { flexDirection: "row", gap: space.xs, flexWrap: "wrap", marginTop: space.sm },
    rowActions: { flexDirection: "row", marginTop: space.xs },
    sendRow: { marginTop: space.md },
    waitingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: p.colors.brand },
    refusedDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: p.colors.tagRoseInk },
  });
}
