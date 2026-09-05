/** The sentence `deleteContact` refuses with, and the decision it refuses on.
 *
 * One function answers both, deliberately. The guard used to be an
 * `if (jobs > 0 || bidInvitations > 0 || ...)` standing next to a message
 * that interpolated all four counts whether or not any of them was zero, so
 * a contact with no jobs and three bid invitations was told it had
 * "0 job(s), 3 bid invitation(s), 0 logged interaction(s), and 0 people on
 * file" (#76). Naming zero of something as part of a reason is how a
 * guard's explanation stops being readable, and a guard whose reason cannot
 * be read only LOOKS like it is protecting something — there is nothing
 * left to check it against.
 *
 * So `contactDeleteRefusal` returns null exactly when the contact may be
 * deleted. The condition and the wording are the same expression and cannot
 * drift apart. `lib/actions/sales.ts`'s `deleteSalesLead` already got the
 * wording right inline and its comment names this very defect; this module
 * is that idea made testable rather than a third copy of it.
 *
 * Wording only. Every count comes from the caller's `_count` select, so
 * this file can never disagree with the database about what is on file.
 */

import { plural } from "@/components/closeoutPackageLabels";

export interface ContactHistoryCounts {
  jobs: number;
  bidInvitations: number;
  interactions: number;
  people: number;
}

/** Only the non-zero parts, properly pluralised, in a fixed order.
 *
 * Fixed order rather than "biggest first": the sentence is read once, by
 * someone who just tried to delete something, and a stable shape is easier
 * to scan than a ranked one. */
export function contactHistoryHeld(counts: ContactHistoryCounts): string[] {
  const held: string[] = [];
  if (counts.jobs > 0) held.push(plural(counts.jobs, "job", "jobs"));
  if (counts.bidInvitations > 0) {
    held.push(plural(counts.bidInvitations, "bid invitation", "bid invitations"));
  }
  if (counts.interactions > 0) {
    held.push(plural(counts.interactions, "logged interaction", "logged interactions"));
  }
  if (counts.people > 0) held.push(plural(counts.people, "person", "people"));
  return held;
}

/** "a", "a and b", "a, b and c". No trailing comma before "and" — this is a
 * sentence someone reads, not a list they parse. */
export function joinHeld(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The refusal sentence, or null when there is no history at all and the
 * delete may go ahead.
 *
 * Null is the "yes". Callers must branch on this rather than re-deriving
 * the condition, which is the whole point of the module. */
export function contactDeleteRefusal(name: string, counts: ContactHistoryCounts): string | null {
  const held = contactHistoryHeld(counts);
  if (held.length === 0) return null;
  return `${name} has ${joinHeld(held)} on file, so its record stays. Only a contact with no history can be deleted.`;
}
