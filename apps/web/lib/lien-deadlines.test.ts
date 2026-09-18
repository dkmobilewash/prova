import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DUE_SOON_DAYS,
  LienDeadlineInputError,
  daysFromToday,
  lienDateFromString,
  lienDeadlineState,
  lienKindLabel,
  servedAfterDueDate,
  sortLienDeadlines,
  summarizeLienDeadlines,
} from "./lien-deadlines";

/**
 * The derived state of a lien deadline. Nothing here is stored — liens.prisma
 * has no overdue, due-soon or served flag — so this file IS the definition,
 * and each rule is pinned by a row that would fail under the tempting wrong
 * version of it.
 *
 * And the rule over all of them: THE APP NEVER COMPUTES A DEADLINE. Every
 * `dueOn` in these fixtures stands for a date a person entered.
 */

const TODAY = "2026-09-18";

describe("lienDeadlineState", () => {
  it("calls an unserved deadline in the past OVERDUE", () => {
    expect(lienDeadlineState({ dueOn: "2026-09-17", servedOn: null }, TODAY)).toBe("overdue");
  });

  it("calls a deadline due TODAY due soon, not overdue — the day is not over", () => {
    expect(lienDeadlineState({ dueOn: TODAY, servedOn: null }, TODAY)).toBe("due_soon");
  });

  it("calls one exactly fourteen days out due soon, and fifteen upcoming", () => {
    expect(DUE_SOON_DAYS).toBe(14);
    expect(lienDeadlineState({ dueOn: "2026-10-02", servedOn: null }, TODAY)).toBe("due_soon");
    expect(lienDeadlineState({ dueOn: "2026-10-03", servedOn: null }, TODAY)).toBe("upcoming");
  });

  it("calls a served deadline served, whatever its date", () => {
    expect(lienDeadlineState({ dueOn: "2026-10-30", servedOn: "2026-09-10" }, TODAY)).toBe("served");
  });

  it("calls a deadline served AFTER its entered date still served, never overdue", () => {
    // The row this rule exists for. "Overdue" would tell somebody to serve
    // it again; whether late service still counts is for counsel.
    const lateServed = { dueOn: "2026-09-01", servedOn: "2026-09-05" };
    expect(lienDeadlineState(lateServed, TODAY)).toBe("served");
    expect(servedAfterDueDate(lateServed)).toBe(true);
  });

  it("does not call on-time or unserved rows served late", () => {
    expect(servedAfterDueDate({ dueOn: "2026-09-05", servedOn: "2026-09-05" })).toBe(false);
    expect(servedAfterDueDate({ dueOn: "2026-09-01", servedOn: null })).toBe(false);
  });
});

describe("daysFromToday", () => {
  it("counts forward positive and backward negative", () => {
    expect(daysFromToday("2026-09-25", TODAY)).toBe(7);
    expect(daysFromToday("2026-09-15", TODAY)).toBe(-3);
    expect(daysFromToday(TODAY, TODAY)).toBe(0);
  });

  it("does not drift a day across a DST change — both ends are UTC midnights", () => {
    expect(daysFromToday("2026-11-02", "2026-10-31")).toBe(2);
  });
});

describe("sortLienDeadlines", () => {
  const rows = [
    { id: "served-old", dueOn: "2026-08-01", servedOn: "2026-07-20" },
    { id: "upcoming", dueOn: "2026-12-01", servedOn: null },
    { id: "due-soon", dueOn: "2026-09-20", servedOn: null },
    { id: "overdue-recent", dueOn: "2026-09-16", servedOn: null },
    { id: "served-new", dueOn: "2026-09-10", servedOn: "2026-09-09" },
    { id: "overdue-old", dueOn: "2026-09-01", servedOn: null },
  ];

  it("puts overdue unserved first, oldest first, then the rest by date, then served newest-first", () => {
    expect(sortLienDeadlines(rows, TODAY).map((r) => r.id)).toEqual([
      "overdue-old",
      "overdue-recent",
      "due-soon",
      "upcoming",
      "served-new",
      "served-old",
    ]);
  });

  it("never puts a served row above an unserved one, even with an earlier date", () => {
    const sorted = sortLienDeadlines(rows, TODAY);
    const firstServed = sorted.findIndex((r) => r.servedOn);
    const lastUnserved = sorted.map((r) => r.servedOn).lastIndexOf(null);
    expect(firstServed).toBeGreaterThan(lastUnserved);
  });

  it("does not reorder the caller's array", () => {
    const copy = [...rows];
    sortLienDeadlines(rows, TODAY);
    expect(rows).toEqual(copy);
  });
});

describe("summarizeLienDeadlines", () => {
  it("counts overdue unserved, due within 14 days, and served — and a served row is not due", () => {
    const summary = summarizeLienDeadlines(
      [
        { dueOn: "2026-09-10", servedOn: null }, // overdue
        { dueOn: "2026-09-12", servedOn: null }, // overdue
        { dueOn: "2026-09-18", servedOn: null }, // due today -> due soon
        { dueOn: "2026-09-30", servedOn: null }, // due soon
        { dueOn: "2026-09-25", servedOn: "2026-09-01" }, // served, would be due soon
        { dueOn: "2026-09-02", servedOn: "2026-09-05" }, // served late, still served
        { dueOn: "2027-01-01", servedOn: null }, // upcoming, counted nowhere but total
      ],
      TODAY,
    );
    expect(summary).toEqual({ overdueUnserved: 2, dueWithin14Days: 2, served: 2, total: 7 });
  });
});

describe("lienDateFromString — the date is ENTERED or refused, never guessed", () => {
  it("reads a yyyy-mm-dd as UTC midnight", () => {
    expect(lienDateFromString("2026-10-02").toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("refuses an empty value rather than defaulting one", () => {
    expect(() => lienDateFromString("", "The deadline")).toThrow(LienDeadlineInputError);
    expect(() => lienDateFromString(null, "The deadline")).toThrow("The deadline is required");
  });

  it("refuses a date that does not exist rather than rolling it into the next month", () => {
    expect(() => lienDateFromString("2026-02-30")).toThrow(LienDeadlineInputError);
    expect(() => lienDateFromString("09/18/2026")).toThrow(LienDeadlineInputError);
  });
});

describe("lienKindLabel", () => {
  it("names each kind as a person would", () => {
    expect(lienKindLabel("PRELIMINARY_NOTICE", null)).toBe("Preliminary notice");
    expect(lienKindLabel("STOP_PAYMENT_NOTICE", null)).toBe("Stop payment notice");
  });

  it("names OTHER by what somebody typed, and says so when nobody did", () => {
    expect(lienKindLabel("OTHER", "Miller Act 90-day notice")).toBe("Miller Act 90-day notice");
    expect(lienKindLabel("OTHER", "  ")).toBe("Unnamed lien deadline");
  });
});

/**
 * The feature says it never states a rule of law. Review found two places
 * where it did — the schema comment and the changelog both gave the
 * California public-work preliminary notice window as a flat number of days
 * and said missing it forfeits the remedy entirely, which overstates the
 * statute (a late notice still covers some of the work). And "costs the
 * whole remedy" was repeated across the page, the Ask tool and the command
 * exclusions. The claim the repo can stand behind is weaker and is the
 * reason for the design: deadlines vary, and missing one can cost lien
 * rights.
 */
describe("the lien feature states no rule of law", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = [
    "packages/db/prisma/schema/liens.prisma",
    "apps/web/components/LienDeadlinesBoard.tsx",
    "apps/web/app/(app)/lien-deadlines/page.tsx",
    "apps/web/lib/lien-deadlines.ts",
    "apps/web/lib/actions/lienDeadlines.ts",
    "apps/web/lib/ask/tools.ts",
    "apps/web/lib/ask/handlers.ts",
    "apps/web/lib/ask/commands/exclusions.ts",
  ];

  // The changelog entry is scanned only while it exists: `pnpm
  // changelog:collect` folds it into CHANGELOG.md and deletes it, and this
  // test must not break that commit.
  const pending = "changelog.d/cyrus-lien-deadlines.md";
  const scanned = existsSync(join(root, pending)) ? [...files, pending] : files;

  it("reads every file it claims to", () => {
    for (const file of scanned) expect(readFileSync(join(root, file), "utf8").length, file).toBeGreaterThan(100);
  });

  it("gives no statutory window and no forfeiture claim as fact", () => {
    const found: string[] = [];
    for (const file of scanned) {
      readFileSync(join(root, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/forfeit|\b20 days\b|whole remedy|remedy entirely/i.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
  });
});

