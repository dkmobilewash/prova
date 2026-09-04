import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { companyRetainageScope } from "./retainage-query";

/**
 * Issue #97 asks for more than a fix: it asks that the next reintroduction
 * be visible. This file is that, and it is deliberately honest about which
 * half does the work.
 *
 * THE DURABLE GUARD IS NOT HERE. It is
 * `expect(bar.retainageHeld).toBe(card.retainageHeld)` in
 * retainage-query.dbtest.ts, which is indifferent to which side drifts and
 * catches any disagreement however it is written. Do not let this file be
 * sold as the answer, or the next person will trust it further than it
 * goes.
 *
 * What this file adds is the case a behavioural test cannot reach: a
 * SEVENTH copy of the query, written in a file that does not exist yet.
 * A behavioural test only catches copies that are already wired up.
 */

const WEB = process.cwd();

/**
 * The population decision, asserted as a VALUE rather than as a string
 * search.
 *
 * An earlier draft of this guard grepped the source for "CONTRACTED" and
 * required it absent. That is satisfied by `status: { not: "ESTIMATE" }`,
 * by `status: { notIn: [...] }`, and by importing a status constant from
 * somewhere else — every one of which reintroduces #97 with the guard
 * still green. Deep equality on the whole object has no such hole: any
 * added key at all, spelled any way at all, fails.
 */
describe("the company-wide retainage population", () => {
  it("is every job in the company and nothing else", () => {
    expect(companyRetainageScope("company_1")).toEqual({ job: { companyId: "company_1" } });
  });

  it("is the same object for both halves of the subtraction", () => {
    // Withheld and released must be summed over the same population or the
    // difference is meaningless — a release counted against a job whose
    // withholding was filtered out would push the figure negative.
    expect(companyRetainageScope("a")).toEqual(companyRetainageScope("a"));
    expect(companyRetainageScope("a")).not.toEqual(companyRetainageScope("b"));
  });
});

/**
 * Every file that names the retainage column, enumerated on purpose.
 *
 * This is an opt-in list, not a lint rule: adding a file here is cheap and
 * takes ten seconds, and having to do it is the whole point. #97 happened
 * because a second read of this column appeared in a file nobody thought
 * of as a retainage file, and stayed there through a fix aimed at exactly
 * that bug.
 *
 * Each entry says what it does with the column, and the two categories are
 * NOT interchangeable:
 *
 *   COMPANY-WIDE SCALAR — must come from loadRetainageHeld. There is
 *   exactly one, and it is the loader itself.
 *
 *   PER-JOB / PER-INVOICE ROWS — legitimately builds its own read, because
 *   it needs job names and ids rather than a total, and cannot consume a
 *   scalar. These were left alone in the #97 PR deliberately: folding them
 *   in is a refactor of four files across two lanes, and they are correct
 *   today.
 */
const RETAINAGE_COLUMN_FILES: Record<string, string> = {
  // -------------------------------------------------- the one source ---
  "lib/retainage-query.ts": "THE company-wide figure. Two aggregates, no status filter.",

  // ------------------------------ per-job / per-invoice, by necessity ---
  "app/(app)/cash-flow/page.tsx": "Retainage receivable TABLE — needs job rows, not a total.",
  "app/(app)/jobs/[id]/page.tsx": "One job's own retainage panel.",
  "lib/pay-application-query.ts":
    "Assembles one pay application. PR #156 moved this out of the page so the G702 arithmetic could be tested without a database; the page now renders what this returns.",
  "lib/pay-application-query.test.ts": "Pins that assembly, including the removed-line close-out.",
  "lib/alerts-query.ts": "RETAINAGE_RELEASE alerts — one alert per job, with its name.",
  "lib/closeout-query.ts": "Retainage at stake on one job's closeout row.",

  // ----------------------------------- writes, exports, documentation ---
  "lib/actions/billing.ts": "WRITES the snapshot at invoice creation. Never reads a total.",
  "lib/actions/quickbooks.ts": "Maps one invoice's snapshot into a QuickBooks memo.",
  "lib/export.ts": "Names the column in the Invoice CSV export.",
  "lib/pay-application.ts": "Pure G702 arithmetic — documentation only, no query.",
  "lib/retainage.ts": "Per-job arithmetic — documentation only, no query.",

  // ------------------------------------------------------------ tests ---
  "lib/retainage-query.dbtest.ts": "Proves the figure against real rows.",
  "lib/retainage-single-source.test.ts": "This file — it names the column in order to look for it.",
  "lib/alerts-query.dbtest.ts": "Proves the alert reads the same sum.",
  "lib/closeout-query.dbtest.ts": "Proves the closeout row reads the same sum.",
};

/** Case-sensitive, and not matched inside a longer identifier: this is the
 * Prisma column `Invoice.retainageWithheld`, not `retainageWithheldCents`
 * (QuickBooks' integer form) and not `invoiceRetainageWithheld` (a pure
 * function's parameter). */
const COLUMN = /retainageWithheld(?![A-Za-z])/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("every file that reads the retainage column is accounted for", () => {
  const found = sourceFiles(join(WEB, "app"))
    .concat(sourceFiles(join(WEB, "components")), sourceFiles(join(WEB, "lib")))
    .filter((file) => COLUMN.test(readFileSync(file, "utf8")))
    .map((file) => relative(WEB, file))
    .sort();

  it("matches the enumerated list exactly", () => {
    // Fails BOTH ways on purpose. A new file naming the column is an
    // undeclared copy of the query; a listed file that no longer names it
    // is a stale entry, and a stale allowlist is how a guard stops
    // guarding.
    expect(found).toEqual(Object.keys(RETAINAGE_COLUMN_FILES).sort());
  });
});

describe("the two callers that render a company-wide total", () => {
  // These are the two that disagreed in #97 — the metric bar via the app
  // layout, and the Today card. Neither may name the column at all now:
  // the list above would fail if they did. What is asserted here is the
  // positive side, that they ask the one loader.
  for (const path of ["lib/company-financials-query.ts", "lib/today-dashboard.ts"]) {
    it(`${path} asks lib/retainage-query.ts rather than the database`, () => {
      const source = readFileSync(join(WEB, path), "utf8");
      expect(source).toContain("loadRetainageHeld");
      expect(source).not.toMatch(COLUMN);
    });
  }
});
