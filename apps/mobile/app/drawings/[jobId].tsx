import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { JobContextChip } from "@/components/JobContextChip";
import { List } from "@/components/List";
import { SyncStatus } from "@/components/SyncStatus";
import { emptyFor } from "@/lib/empty-state";
import { useT } from "@/lib/i18n";
import { NotYourJobFunction } from "@/components/NotYourJobFunction";
import { SCREEN_CAPABILITY, SCREEN_NOUN } from "@/lib/screen-capabilities";
import { holds } from "@/lib/capabilities";
import { useMe } from "@/lib/use-me";
import { type Palette, hitTarget, space, typography } from "@/lib/theme";
import { usePalette } from "@/lib/use-palette";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote, withToken } from "@/lib/cached-read";
import { formatBytes, forgetFile, heldBytes, heldFile, keepForOffline } from "@/lib/drawing-files";
import { useStableGetToken } from "@/lib/use-stable-get-token";
import type { DrawingSetRow } from "@/lib/types";

/**
 * The drawings, as the question a foreman actually has: **is what I am
 * holding still current, and do we even have the current one?**
 *
 * Read-only on purpose. Drawings are recorded off a transmittal at a
 * desk, with a file to attach and a label to copy off a title block;
 * none of that is a phone job. What site needs is the answer, and the
 * file when there is one.
 *
 * There are no SHEETS in this product — a set has revisions and a
 * revision may carry one file — so this does not pretend to be a sheet
 * browser. Keeping a revision is per revision, and deliberate: rows are
 * cached automatically because they are cheap, and a drawing file is
 * megabytes on somebody's cellular plan.
 */
/**
 * Opens a file held on the phone, if this build can.
 *
 * A `file://` uri cannot go to `WebBrowser` — that is
 * SFSafariViewController on iOS and it takes http(s) only, which is the
 * bug this function exists to fix. The OS share sheet (Quick Look) can,
 * and that is `expo-sharing`.
 *
 * IMPORTED LAZILY, AND THAT IS THE POINT. `expo-sharing` is a NATIVE
 * module: adding the package changes the JS bundle but not the binary
 * already installed on a phone, so a dev client built before it existed
 * throws `Cannot find native module 'ExpoSharing'` — at module scope,
 * which took the whole screen down with a red box. Found on a device on
 * 2026-09-20, because nothing that runs in node can see it.
 *
 * So the import happens inside the tap, inside a try, and a build that
 * cannot do it falls back to opening online and says so. The next native
 * build gets the held copy for free.
 */
async function openHeldFile(uri: string): Promise<boolean> {
  try {
    const Sharing = await import("expo-sharing");
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri, { UTI: "com.adobe.pdf", mimeType: "application/pdf" });
    return true;
  } catch {
    return false;
  }
}

export default function DrawingsScreen() {
  const { me } = useMe();
  const { t } = useT();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const getToken = useStableGetToken();
  const [sets, setSets] = useState<DrawingSetRow[]>([]);
  const [offline, setOffline] = useState<string | "nothing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Bumped after a download or a delete so the held badges re-read the
   * disk — the file system is not React state. */
  const [heldAt, setHeldAt] = useState(0);

  const load = useCallback(async () => {
    if (!jobId) return;
    const result = await cachedRead(
      cacheKeys.drawings(jobId),
      withToken(getToken, (token) => api.listDrawings(jobId, token)),
    );
    if (result.from === "nothing") {
      setOffline("nothing");
      return;
    }
    setSets(result.value);
    setOffline(staleNote(result));
  }, [getToken, jobId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const held = heldBytes();

  // The server refuses this route to anybody without the
  // capability (see lib/screen-capabilities.ts, checked against the
  // route itself in its test). Saying so beats a 403 rendering as
  // an empty screen with no explanation.
  if (!holds(me, SCREEN_CAPABILITY["drawings/[jobId]"])) return <NotYourJobFunction what={SCREEN_NOUN["drawings/[jobId]"]} />;

  return (
    <View style={styles.screen}>
      <View style={styles.chipWrap}>
        <JobContextChip />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SyncStatus state={offline} />

      <List
        data={sets}
        keyExtractor={(set) => set.id}
        renderItem={({ item: set }) => (
          <Card style={styles.card}>
            <Text style={styles.name}>{set.name}</Text>
            {set.description ? <Text style={styles.meta}>{set.description}</Text> : null}

            {/* The one line that matters on a wall. */}
            {set.currentNotReceived ? (
              <Text style={styles.warn}>
                {t("drawings.notOnSite", {
                  label:
                    set.revisions.find((r) => r.id === set.latestReceivedRevisionId)?.label ??
                    t("drawings.nothingYet"),
                })}
              </Text>
            ) : null}

            {set.revisions.map((revision) => {
              const isCurrent = revision.id === set.currentRevisionId;
              const localUri = revision.fileUrl ? heldFile(revision.id, revision.fileName) : null;
              void heldAt; // re-read on change

              return (
                <View key={revision.id} style={styles.revision}>
                  <View style={styles.revisionHead}>
                    <Text style={[styles.label, isCurrent && styles.labelCurrent]}>
                      {revision.label}
                      {isCurrent ? ` · ${t("drawings.current")}` : ""}
                    </Text>
                    {localUri ? <Text style={styles.held}>{t("drawings.onThisPhone")}</Text> : null}
                  </View>

                  <Text style={styles.meta}>
                    {t("drawings.issued", { date: revision.issuedOn.slice(0, 10) })}
                    {revision.receivedOn
                      ? ` · ${t("drawings.received", { date: revision.receivedOn.slice(0, 10) })}`
                      : ` · ${t("drawings.notReceived")}`}
                  </Text>
                  {revision.description ? <Text style={styles.meta}>{revision.description}</Text> : null}

                  {revision.fileUrl ? (
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityRole="button"
                        style={styles.action}
                        onPress={async () => {
                          setError(null);
                          const opened = localUri ? await openHeldFile(localUri) : false;
                          if (opened) return;
                          try {
                            await WebBrowser.openBrowserAsync(revision.fileUrl!);
                          } catch {
                            setError(
                              localUri
                                ? t("drawings.cantOpenSaved")
                                : t("drawings.cantOpen"),
                            );
                          }
                        }}
                      >
                        <Icon name="chevron" size={16} color={palette.colors.link} />
                        <Text style={styles.actionLabel}>{t("drawings.open")}</Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        style={styles.action}
                        disabled={busy === revision.id}
                        onPress={async () => {
                          setError(null);
                          if (localUri) {
                            forgetFile(revision.id, revision.fileName);
                            setHeldAt(Date.now());
                            return;
                          }
                          setBusy(revision.id);
                          try {
                            await keepForOffline(revision.id, revision.fileName, revision.fileUrl!);
                            setHeldAt(Date.now());
                          } catch {
                            setError(t("drawings.cantDownload"));
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <Icon
                          name={localUri ? "trash" : "refresh"}
                          size={16}
                          color={busy === revision.id ? palette.colors.inkMuted : palette.colors.link}
                        />
                        <Text style={styles.actionLabel}>
                          {busy === revision.id
                            ? t("drawings.saving")
                            : localUri
                              ? t("drawings.removeFromPhone")
                              : t("drawings.keepOnPhone")}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={styles.meta}>{t("drawings.noFile")}</Text>
                  )}
                </View>
              );
            })}
          </Card>
        )}
        {...emptyFor(offline, "thing.drawings", {
          title: "drawings.empty.title",
          description: "drawings.empty.body",
        })}
      />

      {held > 0 ? <Text style={styles.footer}>{t("drawings.kept", { size: formatBytes(held) })}</Text> : null}
    </View>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.colors.canvas },
    chipWrap: { padding: space.md, paddingBottom: 0 },
    error: { color: p.colors.tagRoseInk, padding: space.md, paddingBottom: 0, fontSize: typography.size.sm },
    card: { gap: space.six },
    name: { color: p.colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
    meta: { color: p.colors.inkMuted, fontSize: typography.size.sm },
    warn: {
      color: p.colors.tagAmberInk,
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
    },
    revision: { borderTopWidth: 1, borderTopColor: p.colors.lineRow, paddingTop: 10, marginTop: 8, gap: 2 },
    revisionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    label: { color: p.colors.inkBody, fontSize: typography.size.md, flex: 1 },
    labelCurrent: { color: p.colors.ink, fontWeight: typography.weight.semibold },
    held: {
      color: p.colors.barGreen,
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
    },
    // A proper 44pt target each, icon and label together — the old bare
    // text links were the row's padding pretending to be a button.
    actions: { flexDirection: "row", gap: space.lg, marginTop: 6 },
    action: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: hitTarget,
      paddingHorizontal: space.xs,
    },
    actionLabel: {
      color: p.colors.link,
      fontSize: typography.size.md,
      fontWeight: typography.weight.semibold,
    },
    footer: {
      color: p.colors.inkMuted,
      fontSize: typography.size.xs,
      padding: space.md,
      borderTopWidth: 1,
      borderTopColor: p.colors.lineRow,
    },
  });
}
