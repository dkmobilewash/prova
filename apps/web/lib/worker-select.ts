/**
 * The value a "who worked" dropdown carries.
 *
 * A worker in this app is one of two things and the schema says so: a
 * `User` (somebody with a login) or a `CrewMember` (somebody without one —
 * see crew.prisma). `TimeEntry` names exactly one of them, enforced by a
 * database XOR check. So a single `<select>` covering both cannot post a
 * bare id: `user_abc` and `crew_abc` are different people and an id on its
 * own does not say which table to look in.
 *
 * The prefix convention is not invented here. `lib/actions/crewSchedule.ts`
 * and `setWorkerCraft` in `lib/actions/unionCompliance.ts` already post
 * `user:<id>` / `crew:<id>` for the same reason. This module is the pure,
 * tested version of that parse so the time-entry form and the action agree
 * on it without a third hand-rolled copy — and so the failure mode is a
 * returned refusal rather than a lookup against the wrong table.
 *
 * PURE. No database, no session. Whether the id names a row in THIS
 * company is a question for the action; all this decides is which table
 * the caller is talking about.
 */

export type WorkerRef =
  | { kind: "user"; userId: string }
  | { kind: "crew"; crewMemberId: string };

/** The dropdown value for a worker. */
export function workerValue(ref: WorkerRef): string {
  return ref.kind === "user" ? `user:${ref.userId}` : `crew:${ref.crewMemberId}`;
}

/**
 * The worker a submitted value names, or null when it names nothing usable.
 *
 * Null rather than a throw: the caller is a Server Action that returns its
 * refusals, and production redacts a thrown message to a digest (CLAUDE.md).
 * An empty string, a missing field and a bare id all come back null — a bare
 * id is DELIBERATELY refused rather than guessed at as a user id, because
 * guessing is how a crew member's hours would quietly land on whoever shares
 * that id shape.
 */
export function parseWorkerValue(raw: string | null | undefined): WorkerRef | null {
  const text = String(raw ?? "").trim();
  if (text.startsWith("user:") && text.length > "user:".length) {
    return { kind: "user", userId: text.slice("user:".length) };
  }
  if (text.startsWith("crew:") && text.length > "crew:".length) {
    return { kind: "crew", crewMemberId: text.slice("crew:".length) };
  }
  return null;
}
