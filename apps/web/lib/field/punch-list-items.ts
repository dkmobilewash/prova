import { prisma } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";

/**
 * The body of "put this on the punch list", lifted out of the Server Action
 * so two callers can share it: `createPunchListItem` (the punch list page's
 * form, one item at a time) and the Ask command `add_punch_items` (a whole
 * pasted list, created in one confirm).
 *
 * Same arrangement as lib/billing/create-invoice.ts: a plain object in, a
 * plain result out. No FormData, no `requireCapabilityForAction`, no
 * `revalidatePath` — the caller supplies the company it has already
 * verified and does its own revalidation, so this also runs from a database
 * test. The card path needs both halves of that: the ids back, and a
 * refusal as a SENTENCE rather than a throw, because production redacts a
 * thrown Server Action message and a card cannot show a sentence that never
 * arrives. That is the whole reason punch items were HANDOFF before.
 *
 * The job is asserted in-company HERE rather than inherited, because this is
 * the boundary a card's server-held payload crosses. The three sentences are
 * the ones the action threw (`requireOwnJobForPunchList`'s "Job not found"
 * included), moved rather than restated — the form's behaviour is unchanged,
 * it just gets them from a return value it converts back into a throw.
 *
 * There is no counter model behind a punch item: it has no sequence number,
 * only a description, so CLAUDE.md's counter rules have nothing to apply to
 * here (verified against packages/db/prisma/schema — no PunchListCounter,
 * and no `number` field on PunchListItem). What IS one transaction is the
 * LIST: N descriptions become N rows or none, so a list that fails halfway
 * never leaves somebody guessing which half they have to retype.
 */

/**
 * How many items one card may create.
 *
 * A walkthrough produces a dozen or so; a paste of hundreds is a
 * spreadsheet import, which is not this. The card previews every single
 * item, and a card nobody reads to the bottom is a card nobody confirmed
 * knowingly — so the cap is what keeps the preview honest, not a storage
 * limit.
 */
export const MAX_PUNCH_ITEMS = 25;

export const NO_DESCRIPTION = "Description is required";
export const NO_JOB = "Pick a job";
export const JOB_NOT_FOUND = "Job not found";

export function tooManyPunchItems(count: number): string {
  return `That list has ${count} items and one card carries at most ${MAX_PUNCH_ITEMS}. Send the first ${MAX_PUNCH_ITEMS} and ask again for the rest, or type them on the punch list page.`;
}

/**
 * A pasted list, one item per line.
 *
 * Blank lines are dropped and counted, so the card can say how many were
 * ignored rather than silently changing the count the person expects. A
 * leading bullet or "1." is stripped because it is list punctuation from
 * wherever they copied it, not part of what needs fixing — everything after
 * it is left exactly as they wrote it, and the card shows the final text of
 * every item before anything is created. The numbering form is deliberately
 * narrow (`1.` / `1)` / `-` / `*` / `•`): "2 doors missing hardware" is an
 * item, not a numbered line.
 */
export function splitPunchItems(items: string): { descriptions: string[]; blanks: number } {
  const lines = items.split(/\r?\n/);
  const descriptions: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    const cleaned = line.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, "").trim();
    if (cleaned) descriptions.push(cleaned);
    else blanks += 1;
  }
  return { descriptions, blanks };
}

/** What counts as the same item when deciding whether one is already open:
 * case and run-of-whitespace differences only. Nothing cleverer — two items
 * that differ by a word are two items, and a false match would drop
 * something a person asked for. */
export function punchItemKey(description: string): string {
  return description.toLowerCase().replace(/\s+/g, " ").trim();
}

export type CreatePunchListItemsInput = {
  descriptions: string[];
  /** The signed-in person, from the caller's own context; never a form
   * field (see PunchListItem.raisedByUserId in operations.prisma). */
  raisedByUserId: string | null;
};

export type CreatePunchListItemsResult = {
  items: { id: string; description: string }[];
};

export async function createPunchListItems(
  companyId: string,
  jobId: string,
  input: CreatePunchListItemsInput,
): Promise<ActionResultWith<CreatePunchListItemsResult>> {
  // Trimmed and emptied-out here as well as by any splitter the caller
  // used: the command path's payload is server-held but a week old by the
  // time it is confirmed, and the form path never went through a splitter
  // at all. One place decides what an item is.
  const descriptions = input.descriptions.map((description) => description.trim()).filter(Boolean);
  if (descriptions.length === 0) return { ok: false, error: NO_DESCRIPTION };
  if (descriptions.length > MAX_PUNCH_ITEMS) {
    return { ok: false, error: tooManyPunchItems(descriptions.length) };
  }
  if (!jobId) return { ok: false, error: NO_JOB };

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true } });
  if (!job) return { ok: false, error: JOB_NOT_FOUND };

  const items = await prisma.$transaction(async (tx) => {
    const created: { id: string; description: string }[] = [];
    for (const description of descriptions) {
      created.push(
        await tx.punchListItem.create({
          data: { companyId, jobId, description, raisedByUserId: input.raisedByUserId },
          select: { id: true, description: true },
        }),
      );
    }
    return created;
  });

  return { ok: true, value: { items } };
}
