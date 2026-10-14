/**
 * The Crew & time tab after the declutter pass (density audit #1: 9.94
 * screens — an open Log-time form, every time entry ever, then sign-off,
 * T&M and an open dispatch form under all of it).
 *
 * Read from the page source, like dispatchSlipForm.test.ts: the page is an
 * async server component over Prisma, and what is pinned here is its
 * SHAPE — which form waits behind which button, and in what order the
 * sections come. The behaviours underneath have their own tests:
 * CollapsedForm.test.tsx (closed by default, the closed button carries the
 * hash id, opens on #log-time), logTimeEntryForm.test.ts (the open form is
 * `id="log-time"`), weekly-hours.test.ts (splitThisWeek).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/(app)/jobs/[id]/(tabs)/crew/page.tsx"), "utf8");
const at = (needle: string) => {
  const i = page.indexOf(needle);
  expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("the Crew & time tab, decluttered", () => {
  it("puts Log time behind a button that #log-time still opens", () => {
    const open = at('<CollapsedForm label="Log time" openOnHash="log-time">');
    const form = at("<LogTimeEntryForm");
    expect(form).toBeGreaterThan(open);
    expect(form).toBeLessThan(page.indexOf("</CollapsedForm>", open));
    // The form inside keeps the id the link lands on once it is open.
    const logForm = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "LogTimeEntryForm.tsx"), "utf8");
    expect(logForm).toContain('id="log-time"');
  });

  it("puts the dispatch form behind a SECONDARY button — one yellow primary per page", () => {
    const open = at('<CollapsedForm label="Log a dispatch slip" tone="secondary">');
    const form = at("<DispatchSlipForm");
    expect(form).toBeGreaterThan(open);
    expect(form).toBeLessThan(page.indexOf("</CollapsedForm>", open));
  });

  it("orders it: schedule week, Log time, this week, the collapsed sections, then a capped history", () => {
    const order = [
      "<CrewWeekGrid",
      'openOnHash="log-time"',
      "<WeeklyHoursTable",
      "{thisWeekEntries.map(timeEntryRow)}",
      'id="timesheet-signoff"',
      'id="tm-tickets"',
      'id="dispatch"',
      'id="time-history"',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("caps the history with SeeAll and keeps the schedule week in its links", () => {
    expect(page).toMatch(/seeAllWindow\(all\)/);
    expect(page).toContain("{shownHistory.map(timeEntryRow)}");
    expect(page).toContain("<SeeAll");
    expect(page).toContain("href={`?${weekQuery}all=1#time-history`}");
    // The whole history is never mapped straight onto the page again.
    expect(page).not.toContain("job.timeEntries.map((entry) => (");
  });
});
