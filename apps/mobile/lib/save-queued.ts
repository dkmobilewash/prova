import { t, type StringKey } from "./i18n";
import { enqueue, type PendingOp } from "./sync-queue";

/**
 * Put a write on the queue, and SAY whether it got there.
 *
 * The queue is the whole reason this app works in a basement: a write
 * goes to disk, the screen moves on, and the drain sends it whenever
 * there is signal. That contract holds right up until the write to disk
 * itself fails — `enqueue` ends in `AsyncStorage.setItem`, which is
 * uncaught and throws on a full disk or a store the OS has taken away.
 *
 * NINE submit functions called `enqueue` bare, and every one of them
 * cleared its form and closed its sheet FIRST:
 *
 *     setTopic("");
 *     setShowTalkForm(false);
 *     await enqueue({ type: "toolbox-talk:create", … });   // throws
 *
 * So the sheet closed, the typed words were gone, nothing reached the
 * queue, and nothing was said. Not a missing error message — a SILENT
 * LOSS wearing the shape of a save, on screens that record a safety
 * incident and a T&M ticket a GC signs.
 *
 * This returns instead of throwing, for the same reason the web's Server
 * Actions do (CLAUDE.md: production redacts a thrown message, so a
 * refusal that reads perfectly in dev reaches a real person as a dead
 * button). The caller's shape becomes:
 *
 *     const saved = await saveQueued(op);
 *     if (!saved.ok) return setError(saved.error);
 *     …clear the form only now…
 *
 * which also fixes the ordering: nothing is cleared until the write is
 * safely on disk.
 *
 * The message is deliberately about THIS PHONE rather than the network.
 * No signal is the normal case and the queue already handles it; this
 * only fires when the phone could not write to its own storage, and
 * telling somebody to "check your connection" would send them outside to
 * fix the wrong thing.
 *
 * IT IS A KEY RATHER THAN A SENTENCE, for the reason lib/empty-state.ts
 * gives at the same seam: every screen that draws this is in the
 * translated set (`TRANSLATED` in strings-census.test.ts), so an English
 * literal here would put one English sentence on an otherwise Spanish
 * screen — and the person it reads as a bug to is the one who cannot
 * report it. `t` is callable outside a component, which is how `emptyFor`
 * does it; this is not a hook and must not become one.
 *
 * strings-census.test.ts CANNOT see this string: its literal detector
 * reads text elements and text props, and this is a bare value in lib/.
 * queued-writes.test.ts asserts the Spanish instead, which a hard-coded
 * English sentence cannot satisfy.
 */
export type SaveResult = { ok: true } | { ok: false; error: string };

/** The key, so the dead-key census can see it and the Spanish cannot
 * drift. `saveFailedMessage()` is the sentence — it depends on the
 * language in force, so it must not be frozen into a module-level const. */
export const SAVE_FAILED_KEY = "save.failed" satisfies StringKey;

export function saveFailedMessage(): string {
  return t(SAVE_FAILED_KEY);
}

export async function saveQueued(op: PendingOp): Promise<SaveResult> {
  try {
    await enqueue(op);
    return { ok: true };
  } catch {
    // The thrown value is not shown. It is an AsyncStorage/native error
    // whose text means nothing to somebody holding a phone, and the one
    // useful instruction — write it down — does not depend on which.
    return { ok: false, error: saveFailedMessage() };
  }
}
