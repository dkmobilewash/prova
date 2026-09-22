import type { PunchItemStatus } from "@prova/db";

/**
 * The punch list's rules that do not need a database: what a status is
 * called, who an item is assigned to, when it is late, and what a form's
 * fields mean.
 *
 * Lifted out of the Server Actions for the same reason `delays-core.ts`
 * was — a parser reached only through a `"use server"` module can only be
 * tested by writing rows, so it tends not to be tested at all. Everything
 * here is a pure function over values.
 */

export const PUNCH_STATUSES = ["OPEN", "READY_FOR_REVIEW", "VERIFIED"] as const;

/** What each state is called on screen.
 *
 * "Ready for review" rather than "Done" is the whole point of the split and
 * the label has to carry it: a foreman who reads the middle state as "done"
 * will stop expecting anybody to look at it. */
export const PUNCH_STATUS_LABELS: Record<PunchItemStatus, string> = {
  OPEN: "Open",
  READY_FOR_REVIEW: "Ready for review",
  VERIFIED: "Verified",
};

export function punchStatusLabel(status: PunchItemStatus): string {
  return PUNCH_STATUS_LABELS[status];
}

export type AssigneeFields = {
  assignedUserId: string | null;
  assignedCrewMemberId: string | null;
  assignedName: string | null;
};

export const NOBODY: AssigneeFields = {
  assignedUserId: null,
  assignedCrewMemberId: null,
  assignedName: null,
};

/**
 * The assignee picker posts ONE value, because the three columns are
 * mutually exclusive and a form with three separate fields can post two of
 * them. `user:<id>` and `crew:<id>` name a record; `name` means "the typed
 * name in the other box", which is how a sub, a day hire or somebody
 * else's guy gets recorded at all.
 *
 * Returns null for "nobody", which is a valid answer and not an error.
 */
export function parseAssignee(
  assignedTo: string,
  typedName: string,
): { ok: true; value: AssigneeFields } | { ok: false; error: string } {
  const choice = assignedTo.trim();
  if (!choice) return { ok: true, value: NOBODY };

  if (choice.startsWith("user:")) {
    const id = choice.slice(5).trim();
    if (!id) return { ok: false, error: "Pick who is fixing it" };
    return { ok: true, value: { ...NOBODY, assignedUserId: id } };
  }
  if (choice.startsWith("crew:")) {
    const id = choice.slice(5).trim();
    if (!id) return { ok: false, error: "Pick who is fixing it" };
    return { ok: true, value: { ...NOBODY, assignedCrewMemberId: id } };
  }
  if (choice === "name") {
    const name = typedName.trim();
    // The database refuses a blank name too (PunchListItem_assigned_name_not_blank).
    // This is the sentence a person reads; that constraint is what stops a
    // caller that never reached this function.
    if (!name) return { ok: false, error: "Type the name of whoever is fixing it" };
    return { ok: true, value: { ...NOBODY, assignedName: name } };
  }
  return { ok: false, error: "Pick who is fixing it" };
}

/** Who it is assigned to, for display. The three columns are exclusive, so
 * the first non-null is the answer. */
export function assigneeLabel(item: {
  assignedUserName?: string | null;
  assignedCrewMemberName?: string | null;
  assignedName: string | null;
}): string | null {
  return item.assignedUserName ?? item.assignedCrewMemberName ?? item.assignedName ?? null;
}

/**
 * A date typed on a form, at UTC midnight — the same convention every other
 * entered date in this app uses (see CLAUDE.md: stored at UTC midnight,
 * rendered in UTC). An empty box is "no due date", which most items have.
 */
export function parseDueOn(value: string): { ok: true; value: Date | null } | { ok: false; error: string } {
  const text = value.trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, error: "Due date must be a date" };
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { ok: false, error: "Due date must be a date" };
  return { ok: true, value: date };
}

/**
 * Late, and never stored — a stored "overdue" flag is wrong every midnight
 * until something rewrites it. An item nobody has to look at any more
 * cannot be late, so VERIFIED is never overdue; READY_FOR_REVIEW still is,
 * because the GC is waiting on the sign-off, not on the crew.
 */
export function isOverdue(
  item: { dueOn: Date | null; status: PunchItemStatus },
  today: Date,
): boolean {
  if (!item.dueOn) return false;
  if (item.status === "VERIFIED") return false;
  return item.dueOn.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}

/**
 * Whether to ask for a photo of the fix.
 *
 * Asked, not enforced — Diego's call, 2026-09-20. An after-photo is what
 * makes a closed item evidence rather than a claim, but a crew standing in
 * a stairwell with no signal and a GC waiting is exactly who a hard block
 * would punish, and the item still has to be closable. So the prompt says
 * what is missing and why, and the item can go ready anyway.
 *
 * The prompt is about the item's own photos: Gap 3's capture attaches one
 * to a punch item at the shutter, so "add a photo" is a real instruction
 * with somewhere to go, not a nag.
 */
export function wantsFixPhoto(item: { status: PunchItemStatus; photoCount: number }): boolean {
  return item.status !== "OPEN" && item.photoCount === 0;
}

/** Who may move an item into each state.
 *
 * READY_FOR_REVIEW is the crew's own claim, so MANAGE_FIELD is enough.
 * VERIFIED needs VERIFY_PUNCH_ITEMS, which the FIELD job function does not
 * hold — that is the sub/GC boundary the split exists to draw.
 *
 * Reopening depends on what is being undone: sending back the crew's claim
 * is field work, but undoing somebody's VERIFICATION is reversing a
 * signature, so it takes the capability that could have signed it.
 */
export function capabilityForStatus(
  next: PunchItemStatus,
  current: PunchItemStatus,
): "MANAGE_FIELD" | "VERIFY_PUNCH_ITEMS" {
  if (next === "VERIFIED") return "VERIFY_PUNCH_ITEMS";
  if (next === "OPEN" && current === "VERIFIED") return "VERIFY_PUNCH_ITEMS";
  return "MANAGE_FIELD";
}
