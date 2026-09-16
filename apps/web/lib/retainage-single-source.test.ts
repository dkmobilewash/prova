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
  "app/(app)/contacts/[id]/page.tsx":
    "One invoice's snapshot, fed to calculatePaymentReliability so a retainage-bearing invoice can settle. Per-invoice by necessity; never a total. Arrived with #288.",
  "lib/today-dashboard.ts":
    "TWO per-invoice reads, both arrived with #288: the receivables tile nets it out of `outstanding` via arBalanceFor, and the GC reliability column passes it to calculatePaymentReliability. The COMPANY-WIDE retainage figure on this page is still loadRetainageHeld and is asserted below — these are per-invoice rows, never summed into a total here.",
  "app/(app)/jobs/[id]/page.tsx": "One job's own retainage panel.",
  "lib/pay-application-query.ts":
    "Assembles one pay application. PR #156 moved this out of the page so the G702 arithmetic could be tested without a database; the page now renders what this returns.",
  "lib/pay-application-query.test.ts": "Pins that assembly, including the removed-line close-out.",
  "lib/alerts-query.ts": "RETAINAGE_RELEASE alerts — one alert per job, with its name.",
  "lib/ask/handlers.ts":
    "TWO read tools, both per-job by necessity. retainage_held builds the per-job rows the way /cash-flow builds its table and takes the COMPANY-WIDE total from loadRetainageHeld rather than summing them — the rows carry job names, which a scalar cannot; cash_flow_forecast feeds calculateRetainageSummary per job into the forecast the same way that page does. Neither derives a company total from this column. Arrived with roadmap item 4 of the Ask build.",
  "lib/closeout-query.ts": "Retainage at stake on one job's closeout row.",

  // ----------------------------------- writes, exports, documentation ---
  "lib/actions/billing.ts":
    "WRITES the snapshot when a pay application is submitted. The plain-invoice write moved out in phase 3 of the Ask build (below). Never reads a total.",
  "lib/billing/create-invoice.ts":
    "WRITES the snapshot for a plain invoice: createInvoice's body, lifted so the form and the draft_invoice card share one write and one formula. Never reads a total.",
  "lib/billing/retainage-release.ts":
    "READS one job's snapshots to sum them the way the job page does — the same calculateRetainageSummary call over the same rows — for the release_retainage card's three figures and for the ceiling and the stale-card check on its tap. Per-job by necessity; never a total. Arrived with phase 4d of the Ask build.",
  "lib/actions/quickbooks.ts": "Maps one invoice's snapshot into a QuickBooks memo.",
  "lib/export.ts": "Names the column in the Invoice CSV export.",
  "lib/pay-application.ts": "Pure G702 arithmetic — documentation only, no query.",
  "lib/retainage.ts": "Per-job arithmetic — documentation only, no query.",
  "lib/cash-flow.ts":
    "Pure arithmetic, no query — names the column as an INPUT FIELD so the AR balance can be net of it (#288). `arBalanceFor` is the one place that subtraction happens; every AR surface imports it rather than mirroring it.",
  "lib/gc-reliability.ts":
    "Pure arithmetic, no query — names the column as an input field so `isSettled` can compare cash against what was CERTIFIED DUE rather than gross (#288).",

  // ------------------------------------------------------------ tests ---
  "lib/retainage-query.dbtest.ts": "Proves the figure against real rows.",
  "lib/retainage-single-source.test.ts": "This file — it names the column in order to look for it.",
  "lib/alerts-query.dbtest.ts": "Proves the alert reads the same sum.",
  "lib/closeout-query.dbtest.ts": "Proves the closeout row reads the same sum.",
  "lib/actions/quickbooks-invoice-push.test.ts":
    "Pins the invoice-push idempotency path, which asserts on the retainage snapshot it sends. Arrived with #160.",
  "lib/ask/commands/billing.test.ts": "Fakes the lifted core's result, snapshot included, to pin what the invoice card hands back.",
  "lib/billing/retainage-release.test.ts": "Fakes the invoice rows the lifted release core sums, snapshot included, to pin its cents and its two refusals.",
  "lib/ask/commands/retainage.test.ts": "Fakes the invoice rows the release card is made from, so the card's figures run through the real per-job read.",
  "lib/ask/handlers.retainageHeld.test.ts":
    "Fakes the invoice rows retainage_held sums per job, and makes loadRetainageHeld disagree with them on purpose — the only way to prove which of the two the company figure is read from.",
  "lib/ask/handlers.cashFlowForecast.test.ts":
    "Fakes the invoice rows the forecast's retainage half is built from, including one job with no substantial completion date.",
  "lib/actions/ask.dbtest.ts": "Asserts the snapshot on the invoice a tapped card created, and seeds the snapshots a release card is made from, against real rows.",
  "app/(app)/cash-flow/page.test.ts":
    "Renders the page with money on it — the assembly rather than the arithmetic, which is where #288 actually lived.",
  "lib/cash-flow.test.ts":
    "Pins the AR balance as net of retainage, and the forecast identity that no dollar is in both halves (#288).",
  "lib/gc-reliability.test.ts": "Pins that a retainage-bearing invoice can settle, and that a genuine shortfall still cannot (#288).",
  "lib/ask/handlers.receivables.test.ts":
    "Fakes the invoice rows the receivables tool sums, snapshot included — the first behavioural test that tool's arithmetic has ever had (#288).",
  "lib/today-dashboard.test.ts":
    "Fakes the invoice rows the receivables tile and the GC reliability column are built from, snapshot included — and asserts that the COMPANY-WIDE retainage figure is still whatever loadRetainageHeld returns, which is the #97 guarantee that grep used to provide for that file.",
  "lib/actions/billing.dbtest.ts":
    "Reads the snapshot off the real invoice row it feeds to calculateArAgingInvoice, so the #102 boundary assertion stays honest if that fixture ever gains a retainage rate.",
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
  // layout, and the Today card. What is asserted here is the positive
  // side, that both ask the one loader for the COMPANY-WIDE figure.
  for (const path of ["lib/company-financials-query.ts", "lib/today-dashboard.ts"]) {
    it(`${path} asks lib/retainage-query.ts rather than the database`, () => {
      const source = readFileSync(join(WEB, path), "utf8");
      expect(source).toContain("loadRetainageHeld");
    });
  }

  // BOTH halves used to be asserted for BOTH files: the negative one said
  // neither may name the column at all. #288 ended that for
  // today-dashboard.ts, which now reads the column per invoice twice — the
  // receivables tile nets it out of `outstanding`, and the GC reliability
  // column needs it for `isSettled`. Both are per-invoice reads; neither
  // sums anything.
  //
  // SAY PLAINLY WHAT IS NO LONGER CHECKED, rather than letting the loss
  // hide in a passing suite: nothing here now stops someone summing the
  // column in today-dashboard.ts and rendering that as the company total,
  // which is #97 exactly. The remaining defences are the assertion above,
  // the allowlist entry that had to be written by hand to add this file,
  // and `retainage-query.dbtest.ts`, which compares the bar against the
  // card and is indifferent to which side drifts.
  //
  // company-financials-query.ts keeps the strict form. It has no per-invoice
  // question to ask, so naming the column there is still a defect on sight.
  it("lib/company-financials-query.ts does not name the column at all", () => {
    expect(readFileSync(join(WEB, "lib/company-financials-query.ts"), "utf8")).not.toMatch(COLUMN);
  });
});

/**
 * The one #288 call site with no render test behind it.
 *
 * BE HONEST ABOUT WHAT THIS PROVES, the same way page-money-guards.test.ts
 * is: it is a static check that the contact page still hands the column to
 * `calculatePaymentReliability`. It renders nothing and cannot tell you the
 * value is right. The arithmetic is proven behaviourally in
 * gc-reliability.test.ts, and the same wiring is proven by a real render in
 * today-dashboard.test.ts for the OTHER caller of that function.
 *
 * What it catches is the realistic regression and the one this repo keeps
 * paying for — "written, documented, and never called": somebody tidying
 * the object literal, the field going missing, and every timing figure on
 * that page silently reverting to gross with the suite still green. The
 * allowlist above would not notice, because the file would still name the
 * column in its Prisma include.
 */
describe("the contact page hands the column to the calculator", () => {
  const source = readFileSync(join(WEB, "app/(app)/contacts/[id]/page.tsx"), "utf8");

  it("passes retainageWithheld into calculatePaymentReliability's input", () => {
    expect(source).toContain("calculatePaymentReliability");
    expect(source).toMatch(/retainageWithheld:\s*invoice\.retainageWithheld/);
  });

  it("says on screen what the timing figures left out", () => {
    expect(source).toContain("reliability.retainageExcluded");
  });
});
