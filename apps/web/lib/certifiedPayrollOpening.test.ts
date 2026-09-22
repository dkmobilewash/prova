/**
 * The certified-payroll sheet opens on a week that has hours in it.
 *
 * Found by clicking a demo job: 35.3 hours logged in the week of Sep 13, the
 * page opened on the current week (Sep 20) and said "No time entries logged
 * on this job for this week." — with no hint that the hours were one week
 * back. Payroll is run after the week closes, so the current week is almost
 * never the one a contractor came to look at.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openingCertifiedPayrollWeek } from "./certified-payroll-week";
import { fileLiterals } from "./source-literals";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);
const PAGE = join(dirname(fileURLToPath(import.meta.url)), "../app/(app)/jobs/[id]/certified-payroll/page.tsx");

describe("openingCertifiedPayrollWeek", () => {
  const now = utc("2026-09-21"); // a Monday

  it("with no week asked for, opens on the week of the latest hours, not the current week", () => {
    expect(day(openingCertifiedPayrollWeek({ requested: undefined, latestEntryDate: utc("2026-09-15"), now }))).toBe(
      "2026-09-13",
    );
  });

  it("a week the reader asked for always wins", () => {
    expect(day(openingCertifiedPayrollWeek({ requested: "2026-08-26", latestEntryDate: utc("2026-09-15"), now }))).toBe(
      "2026-08-23",
    );
  });

  it("falls back to the current week when the job has no hours", () => {
    expect(day(openingCertifiedPayrollWeek({ requested: undefined, latestEntryDate: null, now }))).toBe("2026-09-20");
  });

  it("an unreadable week parameter is treated as no parameter", () => {
    expect(day(openingCertifiedPayrollWeek({ requested: "not-a-date", latestEntryDate: utc("2026-09-15"), now }))).toBe(
      "2026-09-13",
    );
  });
});

describe("the certified-payroll page", () => {
  const source = readFileSync(PAGE, "utf8");
  const texts = fileLiterals(PAGE).map((l) => l.text);

  it("decides its week through openingCertifiedPayrollWeek, fed the job's latest hours", () => {
    expect(source).toMatch(/openingCertifiedPayrollWeek\(\{\s*requested: weekStartParam,\s*latestEntryDate/);
    expect(source).toContain("loadLatestTimeEntryDate(");
  });

  it("an empty week points at the week that has hours, and at Crew & time", () => {
    expect(texts).toContain("/jobs/${}/certified-payroll?weekStart=${}");
    expect(texts).toContain("/jobs/${}/crew");
    expect(texts.join(" ")).toContain("The latest hours on this job are in the week of");
  });

  it("says 'fringe rate schedule' in words, never the model name", () => {
    const visible = fileLiterals(PAGE).filter((l) => l.kind === "jsx-text").map((l) => l.text).join(" ");
    expect(visible).not.toContain("FringeRateSchedule");
    expect(visible.replace(/\s+/g, " ")).toContain("fringe rate schedule set under Union");
  });
});
