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
import { hitTarget, leadingFor, type Palette, radius, space, typography } from "@/lib/theme";
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

  /**
   * The id of the ONE row whose delete is armed, or null.
   *
   * A single id rather than a set, deliberately: two rows offering
   * "Remove it" at once on a 375pt screen is two destructive buttons a
   * gloved thumb can reach, and arming the second disarming the first is
   * free here.
   */
  const [armed, setArmed] = useState<string | null>(null);

  /**
   * Items this phone has asked to remove and the server has not confirmed
   * gone. The delete half of `local` above, and here for the same reason:
   * the write is QUEUED, so with no signal the row is still in this
   * phone's cache and will keep coming back from `load()` until the queue
   * drains.
   *
   * The row therefore STAYS, saying it is on its way out, rather than
   * vanishing and reappearing — a row that comes back looks like the
   * delete failed, and the only honest alternative (hide it locally) would
   * be this screen keeping a second opinion about what is on the list.
   * Cleared per item the moment the server's own list no longer has it.
   */
  const [removing, setRemoving] = useState<Record<string, true>>({});

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
    // Still on its way out: the list this phone just read still has it.
    // Gone from the list means the delete landed, so the flag goes with it
    // — it must never outlive the write it stands in for.
    setRemoving((current) => {
      const next: Record<string, true> = {};
      for (const id of Object.keys(current)) {
        if (result.value.some((item) => item.id === id)) next[id] = true;
      }
      return next;
    });
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
    // What `local` held for this item BEFORE the optimistic flip — `undefined`
    // when nothing of this phone's was in flight for it. Read here, in the
    // same render that fired the tap and before any await, so it agrees with
    // the `current` computed above.
    const previous = local[item.id];
    setError(null);
    setLocal((existing) => ({ ...existing, [item.id]: next }));
    const saved = await saveQueued({ type: "punch-list:status", jobId, itemId: item.id, status: next });
    if (!saved.ok) {
      // PUT THE ENTRY BACK AS IT WAS, key and all. Writing `current` into it
      // restored the right status and left the KEY behind, and the key is
      // what `queued` reads (`local[item.id] !== undefined`) to draw
      // "· Syncing…" — so the row went on claiming a change was on its way
      // to the office, directly beside the line saying nothing was sent.
      // Measured in Chromium: "Open · L3" before the tap, "Open · Syncing… ·
      // L3" after it, with an empty queue.
      //
      // Deleting the key unconditionally would be the other half of the same
      // mistake: a tap that IS still in flight from before would stop being
      // drawn. So the previous entry is restored exactly, including its
      // absence.
      setLocal((existing) => {
        const rolledBack = { ...existing };
        if (previous === undefined) delete rolledBack[item.id];
        else rolledBack[item.id] = previous;
        return rolledBack;
      });
      setError(saved.error);
      return;
    }
    await sync();
  };

  /**
   * Taking an item off the list — #592.
   *
   * QUEUED, not sent, like every other write on this phone: the person who
   * typed the typo is standing in the building where they typed it, and a
   * basement is the normal case. The op carries NO `clientOperationId`, for
   * the same reason `punch-list:status` carries none — deleting the same row
   * twice lands on the same outcome, and the server answers a replayed
   * DELETE with a 404 that the queue settles as done (see the route's own
   * comment, and `punch-list:delete` in lib/sync-queue.ts).
   *
   * NOTHING IS DISARMED OR MARKED UNTIL THE WRITE IS ON DISK. That ordering
   * is lib/save-queued.ts's rule and write-ordering.test.ts is its guard: a
   * phone that cannot write to its own storage must not leave a row looking
   * removed.
   */
  const remove = async (item: PunchListItem) => {
    if (!jobId) return;
    setError(null);
    const saved = await saveQueued({ type: "punch-list:delete", jobId, itemId: item.id });
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setArmed(null);
    setRemoving((current) => ({ ...current, [item.id]: true }));
    await sync();
  };

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["punch-list/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["punch-list/[jobId]"]} />;

  /**
   * WHETHER TO DRAW THE REMOVE CONTROL AT ALL.
   *
   * The DELETE route is owner-only (`ownerRefusal`, in parity with the web
   * row), so offering this to a crew member would be a button whose only
   * outcome is a 403 sitting in "needs attention" with the server's
   * sentence under it. lib/use-me.ts exists precisely so the shell does not
   * lie about what it can do.
   *
   * `me === null` — never been online, nothing cached — draws it, the same
   * way `holds()` answers true for an unknown capability and for the same
   * reason: one honest refusal beats a phone that has quietly hidden the
   * way out. One rule in the app, not two.
   *
   * THIS LEAVES #592's OWN EXAMPLE UNSOLVED and that is a decision above
   * this screen, not a gap in it: the issue is about "a crew member who
   * typos an item", and a crew member still cannot remove one. Flipping it
   * is this one predicate plus the route's guard — it is written as a
   * predicate so that it is one line in each place.
   */
  const mayRemove = me === null || me.role === "OWNER";

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
              const onItsWayOut = removing[item.id] !== undefined;
              const isArmed = armed === item.id;
              /** Rule 1 of issue #152: an armed row hides EVERY ordinary
               * action, not just the one somebody remembered. Here those
               * are the row's own tap (which changes status) and the photo
               * prompt. A row already on its way out has nothing to toggle
               * either. */
              const ordinaryActions = !isArmed && !onItsWayOut;
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
                  subtitle={[
                    t(STATUS_LABEL[status]) +
                      (onItsWayOut ? ` · ${t("punch.removing")}` : queued ? ` · ${t("common.syncing")}` : ""),
                    item.area,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined}
                  detail={[
                    item.assignedName,
                    item.dueOn ? t("punch.due", { date: item.dueOn.slice(0, 10) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined}
                  divider={i > 0}
                  onPress={ordinaryActions ? () => toggle(item) : undefined}
                  /* ISSUE #593. `GroupedRow` defaults `chevron = true` and
                   * draws one whenever `onPress` exists — even with
                   * `role="checkbox"` — so this row promised a destination
                   * and delivered a STATUS CHANGE, which is the one thing a
                   * foreman acts on. Set here rather than on `GroupedRow`,
                   * whose default is right for the rows that really do
                   * navigate.
                   *
                   * Dropped rather than given a real destination (an item
                   * detail screen) on two grounds: once the row has an
                   * explicit Remove, a chevron promising a destination is
                   * strictly worse than nothing, and dropping is reversible
                   * where inventing a screen is not. The detail-screen
                   * option stays the founder's to choose and is in the PR
                   * body. */
                  chevron={false}
                  accessibilityLabel={
                    status === "OPEN" ? t("punch.markReady") : t("punch.markOpen")
                  }
                >
                  {/* Asked for, not required — a crew with no signal still
                      has to be able to close the item. The camera screen
                      attaches the photo to THIS item at the shutter. */}
                  {status !== "OPEN" && item.photoCount === 0 && ordinaryActions ? (
                    <Pressable
                      onPress={() => router.push(`/photos/${jobId}?punchListItemId=${item.id}`)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.photoPrompt}>{t("punch.noPhoto")}</Text>
                    </Pressable>
                  ) : null}

                  {/* THE WAY OUT — #592. Not offered on a VERIFIED item:
                      that status is somebody else's sign-off, and the
                      toggle above already refuses to take one back from a
                      phone. Not offered while the item is already on its
                      way out, because there is nothing left to arm. */}
                  {mayRemove && status !== "VERIFIED" && !onItsWayOut ? (
                    <View style={styles.removeBlock}>
                      {isArmed ? (
                        /* CANCEL ON TOP, CONFIRM BELOW, BOTH FULL WIDTH.
                         *
                         * CLAUDE.md, "Cancel inherits the delete pixel":
                         * the rule is not "Cancel first", it is that the
                         * confirm must not land on the pixel the delete
                         * just vacated. On a phone there is no x axis to
                         * read it on, so the armed pair is a COLUMN and
                         * Cancel takes the top — the slot "Remove" was
                         * sitting in — which is that sentence read
                         * vertically. A hurried second tap costs a tap.
                         *
                         * Nothing is inserted above Cancel (no heading, no
                         * hint): whatever took the top slot would take
                         * Cancel out of it, and what is being removed is
                         * already the row's own title, two lines up. The
                         * long form rides in the trigger's
                         * accessibilityLabel, which costs no width — the
                         * third axis of that same entry, where a long
                         * delete LABEL made the armed pair too narrow to
                         * reach the pixel at all.
                         */
                        <>
                          <Pressable
                            onPress={() => setArmed(null)}
                            accessibilityRole="button"
                            style={styles.confirmCancel}
                          >
                            <Text style={styles.confirmCancelLabel}>{t("punch.remove.cancel")}</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => remove(item)}
                            accessibilityRole="button"
                            style={styles.confirmDelete}
                          >
                            <Text style={styles.confirmDeleteLabel}>{t("punch.remove.confirm")}</Text>
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          onPress={() => setArmed(item.id)}
                          accessibilityRole="button"
                          accessibilityLabel={t("punch.remove.which", { what: item.description })}
                          style={styles.removeTrigger}
                        >
                          <Text style={styles.removeLabel}>{t("punch.remove")}</Text>
                        </Pressable>
                      )}
                    </View>
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
    photoPrompt: { color: p.colors.link, fontSize: typography.size.sm, marginTop: space.two },

    /**
     * THE DELETE BLOCK. Built here rather than from `Button` because the
     * destructive half needs the rose pair and `Button` has three variants,
     * none of them destructive — and `components/` is another lane this
     * week. If a `Button variant="destructive"` lands, this collapses into
     * it; the geometry, which is the part that is a scar, is in the JSX
     * above rather than in these three styles.
     *
     * `alignSelf: "stretch"` on both armed controls is the FULL WIDTH half
     * of the phone rule, and the `gap` is the separation a destructive
     * action is owed from the control beside it.
     */
    removeBlock: { marginTop: space.sm, gap: space.sm, alignSelf: "stretch" },
    /** Quiet by design: this sits on every open row, and a filled button on
     * each one would make removing look like the thing the screen is for.
     * It still clears the gloved-hand floor. */
    removeTrigger: { minHeight: hitTarget, justifyContent: "center" },
    removeLabel: { color: p.colors.link, fontSize: typography.size.sm },
    confirmCancel: {
      minHeight: hitTarget,
      alignSelf: "stretch",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: p.colors.lineCard,
      backgroundColor: p.colors.surface,
    },
    confirmCancelLabel: {
      color: p.colors.ink,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
    confirmDelete: {
      minHeight: hitTarget,
      alignSelf: "stretch",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.card,
      backgroundColor: p.colors.tagRose,
    },
    /** `tagRoseInk` on `tagRose` — the pair theme-contrast.test.ts already
     * holds to 4.5:1 in all three palettes. The meaning is carried by the
     * WORD as well as the colour, per the field rules. */
    confirmDeleteLabel: {
      color: p.colors.tagRoseInk,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
    footer: { padding: space.md, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: p.colors.lineRow },
  });
}
