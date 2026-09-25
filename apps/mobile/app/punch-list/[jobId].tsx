import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { GroupedList } from "@/components/GroupedList";
import { GroupedRow } from "@/components/GroupedRow";
import { Icon } from "@/components/Icon";
import { JobContextChip } from "@/components/JobContextChip";
import { SyncStatus } from "@/components/SyncStatus";
import { emptyFor } from "@/lib/empty-state";
import { Field } from "@/components/Field";
import { Sheet } from "@/components/Sheet";
import { JobSections } from "@/components/JobSections";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { useT, type StringKey } from "@/lib/i18n";
import { leadingFor, type Palette, radius, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import * as api from "@/lib/api";
import { uuid } from "@/lib/id";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { saveQueued } from "@/lib/save-queued";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import { useSync } from "@/lib/use-sync";
import type { PunchItemStatus, PunchListItem } from "@/lib/types";

/** What each state is called here. The same words as the web row, because
 * the foreman marking it ready and the PM verifying it are talking about
 * the same item on the phone. */
const STATUS_LABEL: Record<PunchItemStatus, StringKey> = {
  OPEN: "punch.status.open",
  READY_FOR_REVIEW: "punch.status.ready",
  VERIFIED: "punch.status.verified",
};

export default function PunchListScreen() {
  const { t } = useT();
  const { me } = useMe();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
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
    const result = await cachedRead(
      cacheKeys.punchList(jobId),
      withToken(getToken, (token) => api.listPunchListItems(jobId, token)),
    );
    setError(null);
    if (result.from === "nothing") {
      setLoadedFrom("nothing");
      return;
    }
    setItems(result.value);
    setLoadedFrom(staleNote(result));
    setLocal((current) => {
      const next: Record<string, PunchItemStatus> = {};
      for (const [id, status] of Object.entries(current)) {
        const server = result.value.find((item) => item.id === id);
        // Still waiting: the server has not caught up with this tap yet.
        if (server && server.status !== status) next[id] = status;
      }
      return next;
    });
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
    // Queued BEFORE the form is cleared — see lib/save-queued.ts.
    const saved = await saveQueued({
      type: "punch-list:create",
      jobId,
      clientOperationId: uuid(),
      description: text,
      ...(where ? { area: where } : {}),
    });
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setError(null);
    setDescription("");
    setArea("");
    setShowForm(false);
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
      setError(t("punch.verifiedOnWeb"));
      return;
    }
    const next: PunchItemStatus = current === "OPEN" ? "READY_FOR_REVIEW" : "OPEN";
    setError(null);
    setLocal((existing) => ({ ...existing, [item.id]: next }));
    const saved = await saveQueued({ type: "punch-list:status", jobId, itemId: item.id, status: next });
    if (!saved.ok) {
      // Put the row back the way it was: the optimistic flip above is now
      // a claim about a change nothing recorded.
      setLocal((existing) => ({ ...existing, [item.id]: current }));
      setError(saved.error);
      return;
    }
    await sync();
  };

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["punch-list/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["punch-list/[jobId]"]} />;

  const empty = emptyFor(loadedFrom, "thing.punchList", {
    title: "punch.empty.title",
    description: "punch.empty.body",
  });

  return (
    <View style={styles.screen}>
      <JobSections jobId={jobId} active="punch-list" />
      <View style={styles.chipWrap}>
        <JobContextChip />
      </View>
      <SyncStatus
        pending={pending}
        state={loadedFrom}
        refused={refused}
        onDismiss={dismissRefused}
        onRetry={retrySetAside}
        refusedTitle={(n) => (n === 1 ? t("common.notSaved.one") : t("common.notSaved.many", { count: n }))}
        refusedLine={(r) => r.error}
        dismissLabel={t("common.dismiss")}
        maxRefused={3}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{empty.emptyTitle}</Text>
            {empty.emptyDescription ? <Text style={styles.emptyBody}>{empty.emptyDescription}</Text> : null}
          </View>
        ) : (
          <GroupedList>
            {items.map((item, i) => {
              const status = statusOf(item);
              const queued = local[item.id] !== undefined;
              return (
                <GroupedRow
                  key={item.id}
                  role="checkbox"
                  checked={status !== "OPEN"}
                  icon={
                    <View style={[styles.box, status !== "OPEN" && styles.boxDone]}>
                      {status !== "OPEN" ? (
                        <Icon name="check" size={16} color={palette.colors.brandInk} />
                      ) : null}
                    </View>
                  }
                  title={item.description}
                  titleStyle={status === "VERIFIED" ? styles.descriptionDone : undefined}
                  subtitle={[t(STATUS_LABEL[status]) + (queued ? ` · ${t("common.syncing")}` : ""), item.area]
                    .filter(Boolean)
                    .join(" · ") || undefined}
                  detail={[
                    item.assignedName,
                    item.dueOn ? t("punch.due", { date: item.dueOn.slice(0, 10) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined}
                  divider={i > 0}
                  onPress={() => toggle(item)}
                  accessibilityLabel={
                    status === "OPEN" ? t("punch.markReady") : t("punch.markOpen")
                  }
                >
                  {/* Asked for, not required — a crew with no signal still
                      has to be able to close the item. The camera screen
                      attaches the photo to THIS item at the shutter. */}
                  {status !== "OPEN" && item.photoCount === 0 ? (
                    <Pressable
                      onPress={() => router.push(`/photos/${jobId}?punchListItemId=${item.id}`)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.photoPrompt}>{t("punch.noPhoto")}</Text>
                    </Pressable>
                  ) : null}
                </GroupedRow>
              );
            })}
          </GroupedList>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button fullWidth onPress={() => setShowForm(true)}>
          {t("punch.add")}
        </Button>
      </View>

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={t("punch.sheet.title")}
        primaryLabel={t("punch.sheet.save")}
        onPrimary={submit}
      >
        <Field
          label={t("punch.field.what")}
          placeholder={t("punch.field.whatHint")}
          value={description}
          onChangeText={setDescription}
          multiline
        />
        {/* Typed here because here is where it is known: standing in front
            of it. At a desk an hour later it is a guess. */}
        <Field
          label={t("punch.field.where")}
          placeholder={t("punch.field.whereHint")}
          value={area}
          onChangeText={setArea}
        />
      </Sheet>
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    chipWrap: { padding: space.md, paddingBottom: 0 },
    error: { color: p.colors.tagRoseInk, padding: space.md, paddingBottom: 0, fontSize: typography.size.sm },
    listScroll: { flex: 1 },
    listContent: { padding: space.md, paddingTop: 0 },
    empty: { gap: space.xs, paddingTop: space.xl, alignItems: "center" },
    emptyTitle: {
      color: p.colors.ink,
      fontSize: typography.size.lg,
      fontWeight: typography.weight.semibold,
      textAlign: "center",
    },
    emptyBody: {
      color: p.colors.inkBody,
      fontSize: typography.size.md,
      lineHeight: leadingFor(typography.size.md),
      textAlign: "center",
    },
    box: {
      width: 24,
      height: 24,
      borderRadius: radius.checkbox,
      borderWidth: 2,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    boxDone: { backgroundColor: p.colors.brand, borderColor: p.colors.brand },
    descriptionDone: { color: p.colors.inkMuted, textDecorationLine: "line-through" },
    photoPrompt: { color: p.colors.link, fontSize: typography.size.sm, marginTop: 2 },
    footer: { padding: space.md, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: p.colors.lineRow },
  });
}
