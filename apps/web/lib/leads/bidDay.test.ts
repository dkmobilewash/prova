import { describe as group, expect, it } from "vitest";
import { bidDayFor } from "./bidDay";

/**
 * The second gate only. `readBidDay`'s parsing is already covered in
 * `lib/ask/commands/leads.test.ts` and is not re-tested here — a second test of
 * somebody else's rule is the same mistake as a second implementation of it.
 *
 * What is new, and what a browser run would never reveal because it needs a
 * stale date to reproduce: a day in the past must not reach the form, because
 * the create form carries `min={localToday()}` and a filled field the browser
 * silently refuses to submit is worse than an empty one.
 */

const TODAY = "2026-10-02";

group("the bid day a lead may start the pursuit form with", () => {
  it("takes a date the page stated as a whole day", () => {
    expect(bidDayFor("October 07, 2026, 02:00 PM", TODAY)).toBe("2026-10-07");
  });

  it("takes today itself — a bid closing this afternoon is the urgent kind", () => {
    expect(bidDayFor("October 2, 2026", TODAY)).toBe(TODAY);
  });

  it("refuses a day already gone, because the form's own min would block the save", () => {
    // The search asks only for bids after today, so this should be unreachable.
    // It is asserted anyway: every defect a browser run found in this feature
    // was something that should not have been reachable either.
    expect(bidDayFor("October 1, 2026", TODAY)).toBeNull();
    expect(bidDayFor("March 4, 2024", TODAY)).toBeNull();
  });

  it("refuses anything that is not a whole calendar day", () => {
    // These keep their raw text in the note; what they must not do is land in a
    // date column, where the form parser would turn them into null and the
    // person would never know the page had said anything at all.
    expect(bidDayFor("late spring", TODAY)).toBeNull();
    expect(bidDayFor("Q3", TODAY)).toBeNull();
    expect(bidDayFor("October 3", TODAY)).toBeNull();
  });

  it("refuses an absent date without being handed one", () => {
    expect(bidDayFor(null, TODAY)).toBeNull();
    expect(bidDayFor(undefined, TODAY)).toBeNull();
    expect(bidDayFor("", TODAY)).toBeNull();
  });
});
