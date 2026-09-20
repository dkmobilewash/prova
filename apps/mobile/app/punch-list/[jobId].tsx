import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { List } from "@/components/List";
import { Sheet } from "@/components/Sheet";
import { JobSections } from "@/components/JobSections";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { uuid } from "@/lib/id";
import { cacheAge, cacheGet, cacheSet } from "@/lib/offline-cache";
import { enqueue } from "@/lib/sync-queue";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import { useSync } from "@/lib/use-sync";
import type { PunchItemStatus, PunchListItem } from "@/lib/types";

/** What each state is called here. The same words as the web row, because
 * the foreman marking it ready and the PM verifying it are talking about
 * the same item on the phone. */
const STATUS_LABEL: Record<PunchItemStatus, string> = {
  OPEN: "Open",
  READY_FOR_REVIEW: "Ready for review",
  VERIFIED: "Verified",
};

export default function PunchListScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const getToken = useStableGetToken();
  const [items, setItems] = useState<PunchListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [area, setArea] = useState("");

  /**
   * Statuses this phone has changed but the server has not confirmed.
   *
   * The tap used to call the API directly and throw when there was no
   * signal, so the one thing a punch list has to survive — a basement —
   * was the one thing it did not. The change is queued now, and this is
   * what keeps the row showing what the person just did until the queue
   * drains. Cleared per item as soon as the server agrees, so it can never
   * outlive the write it is standing in for.
   */
  const [local, setLocal] = useState<Record<string, PunchItemStatus>>({});

  /** Null when the list on screen came from the server just now. A sentence
   * when it came from this phone's cache, and "nothing" when there was no
   * cache to fall back on — which is the one case where the screen must not
   * claim the job is clear. */
  const [loadedFrom, setLoadedFrom] = useState<string | "nothing" | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    const cacheKey = `punch-list.${jobId}`;
    const token = await getToken();

    /** What to show when the list cannot be fetched: the rows this phone
     * last saw, and how old they are. Saying nothing here is what produced
     * "Nothing outstanding on this job." on a screen that simply had not
     * loaded. */
    const fallBackToCache = async () => {
      const cached = await cacheGet<PunchListItem[]>(cacheKey);
      if (!cached) {
        setLoadedFrom("nothing");
        return;
      }
      setItems(cached.rows);
      setLoadedFrom(`Showing the list from ${cacheAge(cached.at)} — no connection`);
    };

    if (!token) {
      await fallBackToCache();
      return;
    }

    try {
      const fresh = await api.listPunchListItems(jobId, token);
      setItems(fresh);
      await cacheSet(cacheKey, fresh);
      setLoadedFrom(null);
      setLocal((current) => {
        const next: Record<string, PunchItemStatus> = {};
        for (const [id, status] of Object.entries(current)) {
          const server = fresh.find((item) => item.id === id);
          // Still waiting: the server has not caught up with this tap yet.
          if (server && server.status !== status) next[id] = status;
        }
        return next;
      });
      setError(null);
    } catch {
      // Not an error banner: with no signal this is the expected state, and
      // the queue is still holding anything that was typed.
      setError(null);
      await fallBackToCache();
    }
  }, [getToken, jobId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const { pending, sync, refused, dismissRefused, retrySetAside } = useSync(load);

  const submit = async () => {
    if (!jobId || !description.trim()) return;
    const text = description.trim();
    const where = area.trim();
    setDescription("");
    setArea("");
    setShowForm(false);
    await enqueue({
      type: "punch-list:create",
      jobId,
      clientOperationId: uuid(),
      description: text,
      ...(where ? { area: where } : {}),
    });
    await sync();
  };

  const statusOf = (item: PunchListItem): PunchItemStatus => local[item.id] ?? item.status;

  const toggle = async (item: PunchListItem) => {
    if (!jobId) return;
    const current = statusOf(item);
    // A verified item is somebody else's signature. Taking it back needs a
    // reason, and asking for one on this screen would be a keyboard in a
    // stairwell — the web row does it.
    if (current === "VERIFIED") {
      setError("Verified items are reopened on the web, with a reason.");
      return;
    }
    const next: PunchItemStatus = current === "OPEN" ? "READY_FOR_REVIEW" : "OPEN";
    setError(null);
    setLocal((existing) => ({ ...existing, [item.id]: next }));
    await enqueue({ type: "punch-list:status", jobId, itemId: item.id, status: next });
    await sync();
  };

  return (
    <View style={styles.screen}>
      <JobSections jobId={jobId} active="punch-list" />
      {pending > 0 ? <Text style={styles.pending}>Pending sync: {pending}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loadedFrom && loadedFrom !== "nothing" ? <Text style={styles.stale}>{loadedFrom}</Text> : null}

      {refused.length > 0 ? (
        <Card style={styles.refused}>
          <Text style={styles.refusedTitle}>
            {refused.length === 1 ? "1 change wasn't saved" : `${refused.length} changes weren't saved`}
          </Text>
          {refused.slice(0, 3).map((entry, index) => (
            <Text key={index} style={styles.refusedLine}>
              {entry.error}
            </Text>
          ))}
          <View style={styles.refusedActions}>
            <Pressable onPress={retrySetAside} accessibilityRole="button">
              <Text style={styles.refusedAction}>Try again</Text>
            </Pressable>
            <Pressable onPress={dismissRefused} accessibilityRole="button">
              <Text style={styles.refusedAction}>Dismiss</Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      <List
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const status = statusOf(item);
          const queued = local[item.id] !== undefined;
          return (
            <Card style={styles.itemCard}>
              <Pressable
                onPress={() => toggle(item)}
                style={styles.itemRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: status !== "OPEN" }}
                accessibilityLabel={
                  status === "OPEN" ? "Mark as ready for review" : "Mark as still open"
                }
              >
                <View style={[styles.box, status !== "OPEN" && styles.boxDone]}>
                  {status !== "OPEN" ? <Text style={styles.check}>✓</Text> : null}
                </View>
                <View style={styles.itemBody}>
                  <Text style={[styles.description, status === "VERIFIED" && styles.descriptionDone]}>
                    {item.description}
                  </Text>
                  <Text style={styles.meta}>
                    {STATUS_LABEL[status]}
                    {queued ? " · syncing…" : ""}
                    {item.area ? ` · ${item.area}` : ""}
                    {item.assignedName ? ` · ${item.assignedName}` : ""}
                    {item.dueOn ? ` · due ${item.dueOn.slice(0, 10)}` : ""}
                  </Text>
                  {/* Asked for, not required — a crew with no signal still
                      has to be able to close the item. The camera screen
                      attaches the photo to THIS item at the shutter. */}
                  {status !== "OPEN" && item.photoCount === 0 ? (
                    <Pressable
                      onPress={() => router.push(`/photos/${jobId}?punchListItemId=${item.id}`)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.photoPrompt}>No photo of the fix — add one</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            </Card>
          );
        }}
        emptyTitle={
          loadedFrom === "nothing"
            ? "Can't load the punch list right now."
            : "Nothing outstanding on this job."
        }
        emptyDescription={
          loadedFrom === "nothing"
            ? "No connection, and this phone hasn't loaded this job's list before. Anything you add is kept and sent when you're back in range."
            : "Tap “Add item” to log what still needs fixing."
        }
      />

      <View style={styles.footer}>
        <Button fullWidth onPress={() => setShowForm(true)}>
          Add item
        </Button>
      </View>

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title="Add punch list item"
        primaryLabel="Save item"
        onPrimary={submit}
      >
        <Field
          label="What needs fixing"
          placeholder="e.g. Ceiling grid out of level"
          value={description}
          onChangeText={setDescription}
          multiline
        />
        {/* Typed here because here is where it is known: standing in front
            of it. At a desk an hour later it is a guess. */}
        <Field
          label="Where (optional)"
          placeholder="e.g. Level 3 corridor"
          value={area}
          onChangeText={setArea}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  pending: { color: colors.link, padding: 16, paddingBottom: 0, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  stale: { color: colors.inkMuted, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  refused: { margin: 16, marginBottom: 0, borderColor: colors.tagRoseInk, borderWidth: 1, gap: 4 },
  refusedTitle: { color: colors.tagRoseInk, fontSize: typography.size.md, fontWeight: typography.weight.bold },
  refusedLine: { color: colors.ink, fontSize: typography.size.sm },
  refusedActions: { flexDirection: "row", justifyContent: "flex-end", gap: 20, marginTop: 8 },
  refusedAction: { color: colors.link, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  itemCard: { padding: 0 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  itemBody: { flex: 1, gap: 2 },
  box: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.lineCard,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  boxDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  check: { color: colors.brandInk, fontSize: 18, fontWeight: typography.weight.bold, lineHeight: 22 },
  description: { color: colors.ink, fontSize: typography.size.md },
  descriptionDone: { color: colors.inkMuted, textDecorationLine: "line-through" },
  meta: { color: colors.inkMuted, fontSize: typography.size.sm },
  photoPrompt: { color: colors.link, fontSize: typography.size.sm, marginTop: 2 },
  footer: { padding: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineRow },
});
