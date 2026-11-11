/**
 * ── ONE JOB'S AUTOMATION, FROM ITS TAKEOFF EVENTS ──
 *
 * Pure, so every rule is unit-tested; the query is `eventStatsQuery.ts`.
 *
 *   touches: what a person pressed. ACCEPT, PICK, HEIGHT_EDIT, SKIP, UNDO and CHANGE
 *     each count one; an "Accept all" press counts one however many groups it took
 *     (its rows share a `batch`). AUTO_POST and SEND are not touches.
 *   autoPosted: groups the auto-post rule typed.
 *   accepted: groups taken by a person's accept (Enter or Accept all).
 *   changedAfterAccept: of the groups accepted or auto-posted, how many a later UNDO
 *     or CHANGE (Set type, Clear type) on the same target reached: the accuracy
 *     signal. A later accept of the same group after an undo is the person's own
 *     second answer, not a further change.
 *   minutesToSend: from the job's first plan set to its first SEND; null until sent.
 */
export type StatEvent = { kind: string; target: string | null; batch: string | null; createdAt: Date };
export type JobAutomation = {
  touches: number;
  autoPosted: number;
  accepted: number;
  changedAfterAccept: number;
  minutesToSend: number | null;
};

const TOUCH = new Set(["ACCEPT", "PICK", "HEIGHT_EDIT", "SKIP", "UNDO", "CHANGE"]);
const TAKEN = new Set(["ACCEPT", "ACCEPT_ALL", "AUTO_POST"]);
const REVERSES = new Set(["UNDO", "CHANGE"]);

export function jobAutomation(events: readonly StatEvent[], firstUploadAt: Date | null): JobAutomation {
  const ordered = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const batches = new Set<string>();
  let touches = 0;
  for (const e of ordered) {
    if (TOUCH.has(e.kind)) touches += 1;
    else if (e.kind === "ACCEPT_ALL") {
      const press = e.batch ?? `${e.createdAt.getTime()}`;
      if (!batches.has(press)) {
        batches.add(press);
        touches += 1;
      }
    }
  }
  // When each target was first taken, and whether anything reversed it afterwards.
  const takenAt = new Map<string, number>();
  const changed = new Set<string>();
  for (const e of ordered) {
    if (e.target === null) continue;
    if (TAKEN.has(e.kind) && !takenAt.has(e.target)) takenAt.set(e.target, e.createdAt.getTime());
    else if (REVERSES.has(e.kind) && takenAt.has(e.target) && e.createdAt.getTime() >= takenAt.get(e.target)!) changed.add(e.target);
  }
  const sent = ordered.find((e) => e.kind === "SEND");
  return {
    touches,
    autoPosted: ordered.filter((e) => e.kind === "AUTO_POST").length,
    accepted: ordered.filter((e) => e.kind === "ACCEPT" || e.kind === "ACCEPT_ALL").length,
    changedAfterAccept: changed.size,
    minutesToSend: sent && firstUploadAt && sent.createdAt >= firstUploadAt ? Math.round((sent.createdAt.getTime() - firstUploadAt.getTime()) / 60000) : null,
  };
}
