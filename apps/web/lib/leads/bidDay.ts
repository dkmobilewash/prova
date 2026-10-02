import { readBidDay } from "@/lib/ask/commands/leads";

/**
 * THE ISO DAY A FOUND LEAD'S BID DATE MAY START THE PURSUIT FORM WITH, OR NULL.
 *
 * In its own module rather than inside `lib/actions/leadSearch.ts` for a reason
 * CLAUDE.md names under Traps: that file is `"use server"`, and a `"use server"`
 * module may only export async functions. Exporting a sync helper from one
 * fails at BUILD and not at typecheck — so it would have passed every check I
 * run locally and broken CI. It is here so it can be exported, and therefore
 * tested.
 *
 * ── TWO GATES, AND THE SECOND IS ABOUT THE FORM RATHER THAN THE DATE ──
 *
 * `readBidDay` is the first and it is already tested in
 * `lib/ask/commands/leads.test.ts`: "October 3, 2026" reads as a day,
 * "October 3" does not, and neither does "late spring". A date the page did not
 * state as a whole calendar day must leave the column empty — this is the rule
 * `executeFindBidLeads` has always applied, and the /pipeline control now
 * applies the same one instead of refusing every date.
 *
 * The second gate is a day BEFORE the viewer's today. `BidPursuitFields` puts
 * `min={localToday()}` on that input when creating, so a past value would make
 * the browser refuse the submit with its own message and nothing on the page
 * would say why — a filled form that will not save, which is worse than a blank
 * field. The search already asks only for bids after today, so this should be
 * unreachable; it is here because "should be unreachable" is how the three
 * defects a browser run found in this feature got in.
 */
export function bidDayFor(bidDateText: string | null | undefined, today: string): string | null {
  if (!bidDateText) return null;
  const day = readBidDay(bidDateText);
  if (!day) return null;
  // Strictly before today. Today itself is allowed — a bid closing this
  // afternoon is the most urgent kind there is.
  if (day < today) return null;
  return day;
}
