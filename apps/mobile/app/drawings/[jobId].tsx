import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { List } from "@/components/List";
import { OfflineNote } from "@/components/OfflineNote";
import { colors, typography } from "@/lib/theme";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, staleNote } from "@/lib/cached-read";
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
    const token = await getToken();
    if (!token) return;
    const result = await cachedRead(cacheKeys.drawings(jobId), () => api.listDrawings(jobId, token));
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

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <OfflineNote state={offline} />

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
                Current revision hasn&apos;t reached site — the crew is on{" "}
                {set.revisions.find((r) => r.id === set.latestReceivedRevisionId)?.label ?? "nothing yet"}
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
                      {isCurrent ? " · current" : ""}
                    </Text>
                    {localUri ? <Text style={styles.held}>On this phone</Text> : null}
                  </View>

                  <Text style={styles.meta}>
                    Issued {revision.issuedOn.slice(0, 10)}
                    {revision.receivedOn ? ` · received ${revision.receivedOn.slice(0, 10)}` : " · not received"}
                  </Text>
                  {revision.description ? <Text style={styles.meta}>{revision.description}</Text> : null}

                  {revision.fileUrl ? (
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={async () => {
                          setError(null);
                          const opened = localUri ? await openHeldFile(localUri) : false;
                          if (opened) return;
                          try {
                            await WebBrowser.openBrowserAsync(revision.fileUrl!);
                          } catch {
                            setError(
                              localUri
                                ? "This build can't open a saved drawing yet — it opens online until the app is rebuilt."
                                : "Couldn't open that drawing.",
                            );
                          }
                        }}
                      >
                        <Text style={styles.action}>Open</Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
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
                            setError("Couldn't download that drawing — try again in range.");
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <Text style={styles.action}>
                          {busy === revision.id ? "Saving…" : localUri ? "Remove from phone" : "Keep on phone"}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={styles.meta}>No file recorded for this revision</Text>
                  )}
                </View>
              );
            })}
          </Card>
        )}
        emptyTitle={offline === "nothing" ? "Can't load the drawings right now." : "No drawing sets on this job."}
        emptyDescription={
          offline === "nothing"
            ? "No connection, and this phone hasn't loaded them before."
            : "Sets and revisions are recorded on the web, off the transmittal."
        }
      />

      {held > 0 ? <Text style={styles.footer}>{formatBytes(held)} of drawings kept on this phone</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  error: { color: colors.tagRoseInk, padding: 16, paddingBottom: 0, fontSize: typography.size.sm },
  card: { gap: 6 },
  name: { color: colors.ink, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  meta: { color: colors.inkMuted, fontSize: typography.size.sm },
  warn: { color: colors.tagAmberInk, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  revision: { borderTopWidth: 1, borderTopColor: colors.lineRow, paddingTop: 10, marginTop: 8, gap: 2 },
  revisionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { color: colors.inkBody, fontSize: typography.size.md, flex: 1 },
  labelCurrent: { color: colors.ink, fontWeight: typography.weight.semibold },
  held: { color: colors.barGreen, fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
  actions: { flexDirection: "row", gap: 20, marginTop: 6, minHeight: 44, alignItems: "center" },
  action: { color: colors.link, fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  footer: {
    color: colors.inkMuted,
    fontSize: typography.size.xs,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.lineRow,
  },
});
