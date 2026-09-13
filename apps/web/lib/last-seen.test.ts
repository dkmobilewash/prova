import { describe, expect, it } from "vitest";
import {
  ACTIVE_WITHIN_DAYS,
  LAST_SEEN_INTERVAL_MS,
  QUIET_AFTER_DAYS,
  USAGE_STATUSES,
  daysSinceSeen,
  describeSeenAge,
  shouldStampLastSeen,
  usageStatus,
} from "./last-seen";

/**
 * The two pure halves of usage visibility, and they are pure for opposite
 * reasons.
 *
 * `shouldStampLastSeen` decides whether a WRITE happens on an ordinary
 * page load, so its off-by-one is measured in database writes per person
 * per day. `usageStatus` is the DERIVED half — "active" and "quiet" are
 * never stored anywhere (CLAUDE.md: derived state is never stored), so
 * this file is the only place either answer is pinned.
 *
 * Both are tested at their exact boundaries rather than in the middle,
 * because the middle of a 15-minute window and the middle of a 7-day one
 * are the cases that cannot be wrong.
 */

const at = (iso: string) => new Date(iso);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

describe("shouldStampLastSeen — the throttle", () => {
  const now = at("2026-09-13T12:00:00.000Z");

  it("stamps a user who has never been seen", () => {
    // The state EVERY existing row is in the moment the migration lands:
    // nullable column, no backfill, so null has to mean "write one now"
    // rather than "wait 15 minutes to find out".
    expect(shouldStampLastSeen(null, now)).toBe(true);
    expect(shouldStampLastSeen(undefined, now)).toBe(true);
  });

  it("writes nothing while the stored value is inside the interval", () => {
    // This is the whole cost control. requireCompanyContext runs on every
    // authenticated request, and a page load is many requests — so "false"
    // here is the normal answer and every "true" is a write.
    expect(shouldStampLastSeen(new Date(now.getTime() - 1), now)).toBe(false);
    expect(shouldStampLastSeen(new Date(now.getTime() - 14 * MINUTE), now)).toBe(false);
    expect(shouldStampLastSeen(new Date(now.getTime() - LAST_SEEN_INTERVAL_MS + 1), now)).toBe(
      false,
    );
  });

  it("stamps again exactly at the interval, and after it", () => {
    expect(shouldStampLastSeen(new Date(now.getTime() - LAST_SEEN_INTERVAL_MS), now)).toBe(true);
    expect(shouldStampLastSeen(new Date(now.getTime() - 4 * DAY), now)).toBe(true);
  });

  it("stamps when the stored value is in the FUTURE", () => {
    // Not hypothetical tidiness: a row written by a host whose clock is
    // ahead, or restored from a backup taken later, stores a timestamp
    // that has not happened yet. Elapsed time is then negative, so a
    // naive `elapsed >= interval` refuses to write — and the column stays
    // wrong until real time catches up to it, which for a badly skewed
    // clock is never. A value that cannot be true is corrected on sight.
    expect(shouldStampLastSeen(new Date(now.getTime() + MINUTE), now)).toBe(true);
  });

  it("takes the interval as an argument, so a caller can say what it means", () => {
    const twoMinutesAgo = new Date(now.getTime() - 2 * MINUTE);
    expect(shouldStampLastSeen(twoMinutesAgo, now, MINUTE)).toBe(true);
    expect(shouldStampLastSeen(twoMinutesAgo, now, 5 * MINUTE)).toBe(false);
  });

  it("uses a 15-minute default, stated as a number rather than implied", () => {
    // Pinned because the number is a product decision (see the module's
    // header) and a silent change to it changes the write volume of every
    // page in the app.
    expect(LAST_SEEN_INTERVAL_MS).toBe(15 * 60 * 1000);
  });
});

describe("usageStatus — derived at read time, never stored", () => {
  const now = at("2026-09-13T12:00:00.000Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

  it("says NEVER for a null column and does not guess", () => {
    // A design partner who has not signed in since the column shipped is
    // the single row this whole feature exists to surface. It must not be
    // rendered as "quiet a long time ago" — nothing is recorded, and the
    // page says exactly that.
    expect(usageStatus(null, now)).toBe("NEVER");
  });

  it("calls someone seen inside the active window ACTIVE", () => {
    expect(usageStatus(now, now)).toBe("ACTIVE");
    expect(usageStatus(daysAgo(1), now)).toBe("ACTIVE");
    expect(usageStatus(daysAgo(ACTIVE_WITHIN_DAYS - 1), now)).toBe("ACTIVE");
  });

  it("calls the week-to-a-fortnight gap SLIPPING", () => {
    // The band the feature is for. "The ones who churn go quiet first" —
    // a partner last seen nine days ago is the call to make this week,
    // and under a two-state active/inactive split they read the same as
    // someone who was here yesterday.
    expect(usageStatus(daysAgo(ACTIVE_WITHIN_DAYS), now)).toBe("SLIPPING");
    expect(usageStatus(daysAgo(QUIET_AFTER_DAYS - 1), now)).toBe("SLIPPING");
  });

  it("calls anything past the quiet threshold QUIET", () => {
    expect(usageStatus(daysAgo(QUIET_AFTER_DAYS), now)).toBe("QUIET");
    expect(usageStatus(daysAgo(400), now)).toBe("QUIET");
  });

  it("treats a future timestamp as seen now rather than as negative age", () => {
    expect(usageStatus(new Date(now.getTime() + DAY), now)).toBe("ACTIVE");
    expect(daysSinceSeen(new Date(now.getTime() + DAY), now)).toBe(0);
  });

  it("counts whole elapsed days, not calendar days", () => {
    // lastSeenAt is an INSTANT (@default-free, written by the stamp), not
    // a UTC-midnight calendar column, so its age is elapsed time. 23
    // hours ago is still "today" to a reader and must not round to 1.
    expect(daysSinceSeen(new Date(now.getTime() - 23 * 60 * MINUTE), now)).toBe(0);
    expect(daysSinceSeen(new Date(now.getTime() - 25 * 60 * MINUTE), now)).toBe(1);
  });

  it("says how long ago in words, with no off-by-one at 'yesterday'", () => {
    // The page renders this next to the date, and it is the half a reader
    // actually acts on. Singular/plural and the 0/1 boundary are exactly
    // where a hand-written ternary in a page component goes wrong, so the
    // phrase is built here where it can be pinned.
    expect(describeSeenAge(0)).toBe("today");
    expect(describeSeenAge(1)).toBe("yesterday");
    expect(describeSeenAge(2)).toBe("2 days ago");
    expect(describeSeenAge(9)).toBe("9 days ago");
  });

  it("has a label for every status it can return, and no orphans", () => {
    // The size cross-check. USAGE_STATUSES is what the page iterates to
    // build its summary row, so a status added to the function and
    // forgotten here would be a band the operator page silently never
    // counts — and a count that is quietly missing a category looks
    // exactly like a count of zero.
    const reachable = new Set([
      usageStatus(null, now),
      usageStatus(now, now),
      usageStatus(daysAgo(ACTIVE_WITHIN_DAYS), now),
      usageStatus(daysAgo(QUIET_AFTER_DAYS), now),
    ]);
    expect(new Set(USAGE_STATUSES)).toEqual(reachable);
    expect(USAGE_STATUSES).toHaveLength(4);
  });
});
