import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
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
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE WAS GREEN WHILE TWO RETAINAGE FORMULAS WERE LIVE, which is
 * worth more than the fix it is attached to.
 *
 * `lib/billing/create-invoice.ts` computed the snapshot as
 * `(Number(amount) * (pct / 100)).toFixed(2)`. `lib/actions/billing.ts`
 * computed it as `((amount * Number(pct)) / 100).toFixed(2)`. Both float,
 * and they round $1,000.35 at 10% to different cents — $100.04 and $100.03.
 * The column is snapshotted at creation and never recomputed, so the wrong
 * cent is permanent on a document the GC has already been sent.
 *
 * This census did not miss them. BOTH FILES WERE IN THE ALLOWLIST BELOW,
 * with notes saying, in capitals, "WRITES the snapshot". The pattern was
 * right. The scope was right. Nothing had drifted.
 *
 * The question was wrong. This census asks "does any file name this column
 * without having been declared?" — a question about FILES. Nobody had asked
 * "and how does a declared file produce the value?", which is a question
 * about EXPRESSIONS, and no answer to the first question can contain an
 * answer to the second.
 *
 * That makes this the third of a family CLAUDE.md already records: the
 * scratch-cleanup guard whose regex silently matched nothing, and the
 * contrast census whose pattern was fine and whose scan root could not see
 * the offending file. Both of those were fixed by asserting something the
 * check could not fake — a size, a scope. This one needs a third thing
 * asserted, and it is neither: the check has to be told what QUESTION each
 * listed file answers. So the writers are now declared separately below,
 * that declaration is checked against a set derived from the code, and each
 * writer is required to obtain its value from the one shared formula.
 * ────────────────────────────────────────────────────────────────────────
 */

const WEB = process.cwd();
const REPO = join(WEB, "..", "..");

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
  // jobs/[id]/page.tsx was one file until 2026-09-20, when the job page
  // was rebuilt into eight routes (app/(app)/jobs/[id]/(tabs)/…, see that
  // layout's own doc comment) so each section could fetch only its own
  // data. Its retainage reads split into three, all per-job:
  "app/(app)/jobs/[id]/(tabs)/retainage/page.tsx": "The Retainage tab itself — same calculateRetainageSummary call the old page made, now with its own targeted query.",
  "app/(app)/jobs/[id]/(tabs)/billing/page.tsx": "Per-invoice retainageWithheld, printed on each invoice row in the Billing tab — never summed into a total here.",
  "lib/jobs/job-summary.ts": "The always-visible summary header's retainage-held figure — the same calculateRetainageSummary call, over a leaner per-job query shared by every tab.",
  "lib/pay-application-query.ts":
    "Assembles one pay application. PR #156 moved this out of the page so the G702 arithmetic could be tested without a database; the page now renders what this returns.",
  "lib/pay-application-query.test.ts": "Pins that assembly, including the removed-line close-out.",
  "lib/alerts-query.ts": "RETAINAGE_RELEASE alerts — one alert per job, with its name.",
  "lib/ask/handlers.ts":
    "TWO read tools, both per-job by necessity. retainage_held builds the per-job rows the way /cash-flow builds its table and takes the COMPANY-WIDE total from loadRetainageHeld rather than summing them — the rows carry job names, which a scalar cannot; cash_flow_forecast feeds calculateRetainageSummary per job into the forecast the same way that page does. Neither derives a company total from this column. Arrived with roadmap item 4 of the Ask build.",
  "lib/closeout-query.ts": "Retainage at stake on one job's closeout row.",

  // ----------------------------------- writes, exports, documentation ---
  "lib/actions/billing.ts":
    "WRITES the snapshot when a pay application is submitted. The plain-invoice write moved out in phase 3 of the Ask build (below). Never reads a total. Declared in RETAINAGE_WRITERS below.",
  "lib/billing/create-invoice.ts":
    "WRITES the snapshot for a plain invoice: createInvoice's body, lifted so the form and the draft_invoice card share one write and one formula. Never reads a total. Declared in RETAINAGE_WRITERS below.",
  "lib/billing/retainage-amount.ts":
    "THE FORMULA — the only expression in this product that multiplies an amount by a retainage rate, in exact decimal. Names the column in its header to say what it produces; computes no total and touches no database.",
  "lib/billing/payment-entry.test.ts":
    "A TEST FIXTURE, and the only reason it names the column at all: #288 made retainageWithheld required on ReliabilityInvoiceInput, so every fixture building one must now state it. This one passes null — a job with no retainage terms — because its subject is the recorded platform fee and it makes no claim about retainage. Reads no total and exercises no retainage behaviour. Added when the fee work and #288 were merged together; each was green alone and only this type disagreed.",
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
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * WHERE THIS CENSUS CAN SEE, and it is no longer "the three folders
 * somebody typed".
 *
 * The contrast-census scar in CLAUDE.md is the reason: that check's pattern
 * and size assertion were both fine, and it was green because the one
 * offending file lived in `packages/ui`, outside a scan root spelled by
 * hand. Nothing is ever missing from a directory you do not walk, so a size
 * assertion cannot reach it.
 *
 * The non-drifting source here is `pnpm-workspace.yaml`: it is the
 * definition of which directories are this product's source, and adding a
 * workspace package extends this census with no edit to this file. Retainage
 * lives in `apps/web` today, but nothing stops a future `packages/billing`
 * from writing the column, and this is what makes that visible on the day it
 * happens rather than a year later.
 */
function workspaceSourceRoots(): string[] {
  const yaml = readFileSync(join(REPO, "pnpm-workspace.yaml"), "utf8");
  // The `packages:` block's list items, e.g. `- "apps/*"`.
  const globs = [...yaml.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]);
  // Plain throws rather than `expect`, because this runs at module load
  // where a failed assertion surfaces as a collect error instead of a
  // named failing test. The message has to carry the diagnosis itself.
  if (globs.length < 2) {
    throw new Error(`pnpm-workspace.yaml parsed to ${globs.length} globs; the scan would be near-empty`);
  }

  const roots: string[] = [];
  for (const glob of globs) {
    const [parent, star] = glob.split("/");
    // The only shape this parser claims to handle. A `packages/**` or a
    // bare path would be silently mis-scanned.
    if (star !== "*") throw new Error(`unhandled workspace glob shape: ${glob}`);
    const parentDir = join(REPO, parent);
    const children = readdirSync(parentDir).filter((name) =>
      statSync(join(parentDir, name)).isDirectory(),
    );
    // A workspace glob matching no package means the parse is wrong, not
    // that the repo is empty.
    if (children.length === 0) throw new Error(`workspace glob ${glob} matched no package`);
    for (const child of children) roots.push(join(parentDir, child));
  }
  return roots;
}

const SCANNED = workspaceSourceRoots().flatMap((root) => sourceFiles(root));

describe("every file that reads the retainage column is accounted for", () => {
  const found = SCANNED.filter((file) => COLUMN.test(readFileSync(file, "utf8")))
    .map((file) => relative(WEB, file))
    .sort();

  it("walks every workspace package, not three folders in this one", () => {
    // The scope assertion the contrast-census scar asks for. `apps/web` is
    // where retainage lives today; what must not happen is the walk
    // quietly ending at this package's edge.
    expect(SCANNED.length).toBeGreaterThan(500);
    expect(SCANNED.some((file) => file.includes(`${sep}packages${sep}`))).toBe(true);
    expect(SCANNED.some((file) => file.includes(`${sep}apps${sep}web${sep}lib${sep}`))).toBe(true);
  });

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

// ═══════════════════════════════════════════════════════════════════════
// THE WRITE SIDE — the question this file was not asking.
//
// Everything above is about READING the column. What was live for weeks was
// a disagreement about how to COMPUTE the value that goes into it, in two
// files this census had already signed off.
// ═══════════════════════════════════════════════════════════════════════

/** The one module allowed to turn an amount and a rate into a cent. */
const FORMULA = "lib/billing/retainage-amount.ts";

/**
 * Every file that PRODUCES a retainage figure, declared by hand, each
 * saying why it is entitled to.
 *
 * Adding to this list is the deliberate ten seconds that the allowlist
 * above is also built on. What makes it a guard rather than a comment is
 * the assertion below: the same set is derived from the code, by asking who
 * calls the formula, and the two must be identical. So a new producer has
 * exactly two futures — it calls the formula, and then it must be declared
 * here; or it does not, and then the arithmetic assertion after this is
 * what it has to get past.
 */
const RETAINAGE_WRITERS: Record<string, string> = {
  "lib/billing/create-invoice.ts":
    "The lump-sum invoice write. Held one of the two float expressions.",
  "lib/actions/billing.ts":
    "submitPayApplication's write. Held the other one — `((amount * Number(pct)) / 100).toFixed(2)`.",
  "lib/ask/commands/billing.ts":
    "Writes nothing; PREVIEWS the figure on the draft_invoice card before the tap. It has to run the identical formula or the card promises a cent the write does not deliver, which is worse than showing none.",
};

/**
 * Comments stripped, so a doc comment QUOTING the old expression — which
 * three files in this fix deliberately do, because the next person needs to
 * see what was wrong — cannot fail the arithmetic assertion below, and
 * cannot satisfy the positive one either.
 *
 * #185 is the scar: a census was disarmed by a comment that quoted its own
 * pattern. This is the same hazard pointed the other way, and the stripper
 * is checked rather than trusted — every writer must still contain the
 * formula call after stripping, which a stripper that ate the code could
 * not produce.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * The rate used as an ARITHMETIC OPERAND: `x * rate`, `rate / x`, with a
 * `Number(...)` or parentheses in between. That is the exact shape of both
 * expressions that were live, and of any third one somebody reaches for.
 *
 * BE HONEST ABOUT WHAT THIS CANNOT SEE, because a guard sold too high is
 * how this file ended up green in the first place. It looks for the float
 * shape. A second implementation written in decimal.js — `new
 * Decimal(amount).times(rate).dividedBy(100)` — uses method calls, not
 * operators, and would walk straight past it. The assertion that catches
 * THAT one is the positive one above: a second implementation is still a
 * file that produces the figure without calling the formula, so the derived
 * writer set stops matching the declared one.
 *
 * Neither assertion is sufficient alone. Together they cover the two ways a
 * second formula can arrive: written inside a declared writer, or written
 * somewhere new.
 */
/** Tests and database tests are excluded from both scans below. A test
 * legitimately spells an expression out as a fixture — this very file does,
 * in the mutation assertions at the bottom — and no test writes a column on
 * a document a GC reads. */
const NON_PRODUCTION = /\.(test|dbtest)\.tsx?$/;

const RATE_AS_OPERAND =
  /[*/]\s*\(*\s*(?:Number\s*\(\s*)?[A-Za-z_$][\w$]*\.?retainagePercent|retainagePercent\s*\)*\s*[*/]/;

describe("there is one retainage formula", () => {
  /** Derived from the code rather than declared: who CALLS the formula.
   * The trailing `(` matters — `import { retainageWithheldFor }` is not a
   * call, and a file that imports the formula and then computes the figure
   * by hand must not be able to buy its way past this. */
  const callers = SCANNED.map((file) => relative(WEB, file))
    .filter((path) => path !== FORMULA && !NON_PRODUCTION.test(path))
    .filter((path) => readFileSync(join(WEB, path), "utf8").includes("retainageWithheldFor("))
    .sort();

  it("is called by exactly the files declared as producing the figure", () => {
    // Fails both ways. A new caller is an undeclared producer; a declared
    // file that stopped calling it has either gone away or gone rogue.
    expect(callers).toEqual(Object.keys(RETAINAGE_WRITERS).sort());
  });

  it("has producers at all — a scan that found none would pass everything after it", () => {
    // The size assertion the scratch-cleanup scar asks for, against a
    // literal that cannot drift with the pattern that produced it. Three:
    // two writes and one card preview.
    expect(callers.length).toBe(3);
  });

  it("is defined in exactly one file", () => {
    const definitions = SCANNED.map((file) => relative(WEB, file))
      // Tests excluded, and this file is the reason: it quotes the pattern
      // it searches for, so it matched itself on the first run. Exactly the
      // #185 shape — a census disarmed, here inverted into a census
      // indicting itself — and it is left recorded rather than tidied away.
      .filter((path) => !/\.(test|dbtest)\.tsx?$/.test(path))
      .filter((path) => /export function retainageWithheldFor\b/.test(readFileSync(join(WEB, path), "utf8")));
    expect(definitions).toEqual([FORMULA]);
  });

  it("is the only place in any workspace package that does the arithmetic", () => {
    // REPO-WIDE, not writer-wide, and that is the point. Restricting this
    // to the three declared writers would answer only "did a known writer
    // grow a second formula" and leave the more likely future — a fourth
    // file nobody has declared yet — to the allowlist alone. The scan
    // covers every workspace package (see `workspaceSourceRoots`), 1,273
    // files at the time of writing, and comes back with nothing but this
    // test file, which quotes both expressions on purpose a few lines down.
    const offenders = SCANNED.map((file) => relative(WEB, file))
      .filter((path) => path !== FORMULA && !NON_PRODUCTION.test(path))
      .filter((path) => RATE_AS_OPERAND.test(withoutComments(readFileSync(join(WEB, path), "utf8"))));
    expect(offenders).toEqual([]);
  });

  for (const [path, why] of Object.entries(RETAINAGE_WRITERS)) {
    describe(`${path} — ${why}`, () => {
      const stripped = withoutComments(readFileSync(join(WEB, path), "utf8"));

      it("calls the formula in code, not only in a comment", () => {
        // Two things at once, and both are load-bearing. It proves the
        // declared writer really calls the shared formula; and it proves
        // the comment stripper did not eat the code the assertion above
        // reads, which is what would make that assertion vacuous.
        expect(stripped).toContain("retainageWithheldFor(");
      });
    });
  }

  it("refuses the expressions that were actually live", () => {
    // The mutation test, inlined, so the regex above is never taken on
    // trust. These are the two real lines, verbatim.
    expect("(Number(amount) * (retainagePercent / 100)).toFixed(2)").toMatch(RATE_AS_OPERAND);
    expect("((amount * Number(job.retainagePercent)) / 100).toFixed(2)").toMatch(RATE_AS_OPERAND);
    // And the shapes that must keep passing, or the guard is unusable:
    // reading the column, selecting it, storing it, printing it.
    expect("select: { retainagePercent: true }").not.toMatch(RATE_AS_OPERAND);
    expect("retainageWithheldFor(amountValue, job.retainagePercent);").not.toMatch(RATE_AS_OPERAND);
    expect("data: { retainagePercent, substantialCompletionDate }").not.toMatch(RATE_AS_OPERAND);
    expect("`${Number(retainagePercent)}% per the job's terms`").not.toMatch(RATE_AS_OPERAND);
  });
});
