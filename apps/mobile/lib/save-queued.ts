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
 */
export type SaveResult = { ok: true } | { ok: false; error: string };

export const SAVE_FAILED =
  "This phone couldn't save that. Nothing was sent, so write it down before you leave the screen.";

export async function saveQueued(op: PendingOp): Promise<SaveResult> {
  try {
    await enqueue(op);
    return { ok: true };
  } catch {
    // The thrown value is not shown. It is an AsyncStorage/native error
    // whose text means nothing to somebody holding a phone, and the one
    // useful instruction — write it down — does not depend on which.
    return { ok: false, error: SAVE_FAILED };
  }
}
