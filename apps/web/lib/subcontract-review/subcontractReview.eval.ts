import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { modelFor, reviewSubcontractChunk, SUBCONTRACT_REVIEW_PROMPT_VERSION } from "@prova/integrations";
import { requireEvalApiKey } from "@/lib/ai/evalApiKey";
import { whyNot } from "@/lib/specs/quoteMatch";
import { planChunks } from "./chunks";
import { validateFindings } from "./citations";
import { findingRows } from "./run";
import { extractPdfPages, unreadPageNumbers } from "./pageText";
import { contractPdf, SUBCONTRACT_CASES, type SubcontractCase } from "./subcontractFixtures";

// AT COLLECTION, before any case runs: a run with no key must fail, never skip.
requireEvalApiKey("subcontract-review eval");

/**
 * CAN THE SUBCONTRACT REVIEW BE TRUSTED TO QUOTE, AND NOT TO INVENT?
 *
 * Run it deliberately, never in CI — it spends real money:
 *
 *     pnpm eval:subcontract-review
 *
 * Three numbers, in the order they matter:
 *
 *   1. CITATION VALIDITY must be 100%. Every quote the model returns, BEFORE
 *      the runtime gate drops anything, must be found verbatim in the text it
 *      was given (`whyNot === null`). The product drops a failed quote, so a
 *      user never sees one — but a reader that fails citations is losing
 *      clauses silently, and only this number can see it. FATAL below 100%.
 *   2. PRECISION. On the clean, sub-friendly agreement no finding may be HIGH:
 *      an invented risk sends a sub to pick a fight over a fair clause. FATAL.
 *   3. RECALL over the planted clauses: each must be found in its category, on
 *      the page code locates, at or above its severity floor, carrying any
 *      figure the clause states. Reported, and required to be at least 6 in 7
 *      on the planted case — a review that misses pay-if-paid is not a review.
 *
 * Every case goes through the SAME path as production: real PDF → pdf.js →
 * per-page text → `planChunks` → `reviewSubcontractChunk` per chunk →
 * `validateFindings` → `findingRows`. Only the database is absent.
 *
 * A REAL CONTRACT can be pointed at with `REAL_SUBCONTRACT_PDF=/path/to.pdf`.
 * It is read from outside the repo, nothing is written anywhere, and only
 * METADATA is printed (page counts, finding counts by category and severity,
 * citation failures) — never the contract's text. That is `realPlan.eval.ts`'s
 * rule for real plans, applied to the most sensitive document anybody hands us.
 */

const model = process.env.SUBCONTRACT_REVIEW_MODEL ?? modelFor("SUBCONTRACT_REVIEW").model;
const SEVERITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

type Verdict = {
  name: string;
  quotesReturned: number;
  quoteFailures: string[];
  found: { category: string; severity: string; title: string; pages: string }[];
  missed: string[];
  wrongPage: string[];
  wrongFigure: string[];
  highOnClean: string[];
  unreadOk: boolean;
  chunks: number;
  msPerChunk: number[];
};

const verdicts: Verdict[] = [];

async function reviewPdf(pdf: Buffer, label: string) {
  const pages = await extractPdfPages(pdf);
  const plan = planChunks(pages);
  const returned: { quote: string; lines: string[] }[] = [];
  const kept: ReturnType<typeof findingRows> = [];
  const msPerChunk: number[] = [];
  for (const pageNumbers of plan) {
    const chunk = pageNumbers.map((page) => ({ page, lines: pages[page - 1] ?? [] }));
    const started = Date.now();
    const extraction = await reviewSubcontractChunk({ documentLabel: label, roleLabel: "the agreement", pages: chunk, model });
    msPerChunk.push(Date.now() - started);
    for (const finding of extraction.findings) {
      returned.push({ quote: finding.quote, lines: chunk.flatMap((page) => page.lines) });
    }
    kept.push(...findingRows(validateFindings(extraction.findings, chunk).kept));
  }
  return { pages, plan, returned, kept, msPerChunk };
}

async function runCase(kase: SubcontractCase) {
  const { pages, plan, returned, kept, msPerChunk } = await reviewPdf(await contractPdf(kase.pages), kase.name);

  const quoteFailures = returned.filter((r) => whyNot(r.quote, r.lines) !== null).map((r) => r.quote.slice(0, 80));
  const missed: string[] = [];
  const wrongPage: string[] = [];
  const wrongFigure: string[] = [];
  for (const clause of kase.planted) {
    const match = kept.find((row) => row.category === clause.category && row.quote.includes(clause.phrase));
    if (!match || SEVERITY_RANK[match.severity] > SEVERITY_RANK[clause.atLeast]) {
      missed.push(`${clause.name}${match ? ` (found as ${match.severity})` : ""}`);
      continue;
    }
    if (match.pageStart !== clause.pages[0] || match.pageEnd !== clause.pages[clause.pages.length - 1]) {
      wrongPage.push(`${clause.name}: pp. ${match.pageStart}-${match.pageEnd}`);
    }
    if (clause.term) {
      const value = (match.terms as Record<string, unknown> | null)?.[clause.term.key];
      if (value !== clause.term.value) wrongFigure.push(`${clause.name}: ${clause.term.key}=${String(value)}`);
    }
  }

  const verdict: Verdict = {
    name: kase.name,
    quotesReturned: returned.length,
    quoteFailures,
    found: kept.map((row) => ({
      category: row.category,
      severity: row.severity,
      title: row.title,
      pages: row.pageStart === row.pageEnd ? `${row.pageStart}` : `${row.pageStart}-${row.pageEnd}`,
    })),
    missed,
    wrongPage,
    wrongFigure,
    highOnClean: kase.noHighFindings ? kept.filter((row) => row.severity === "HIGH").map((row) => row.title) : [],
    unreadOk: JSON.stringify(unreadPageNumbers(pages)) === JSON.stringify(kase.unread ?? []),
    chunks: plan.length,
    msPerChunk,
  };
  verdicts.push(verdict);

  expect(quoteFailures, `${kase.name}: quotes not found verbatim in the text the model was given`).toEqual([]);
  expect(verdict.highOnClean, `${kase.name}: HIGH findings on the sub-friendly control`).toEqual([]);
  expect(verdict.unreadOk, `${kase.name}: unread pages`).toBe(true);
  if (kase.name === "planted-gc-form") {
    expect(kase.planted.length - missed.length, `${kase.name}: planted clauses found`).toBeGreaterThanOrEqual(kase.planted.length - 1);
  }
}

for (const kase of SUBCONTRACT_CASES) {
  it(`${kase.name}`, async () => runCase(kase), 300_000);
}

const realPath = process.env.REAL_SUBCONTRACT_PDF;
if (realPath) {
  it("a real contract, metadata only", async () => {
    const { pages, plan, returned, kept, msPerChunk } = await reviewPdf(readFileSync(realPath), "the subcontract");
    const failures = returned.filter((r) => whyNot(r.quote, r.lines) !== null).length;
    const byCategory = new Map<string, number>();
    for (const row of kept) byCategory.set(`${row.category}/${row.severity}`, (byCategory.get(`${row.category}/${row.severity}`) ?? 0) + 1);
    console.log(
      [
        "",
        `REAL CONTRACT (text not printed): ${pages.length} pages, ${unreadPageNumbers(pages).length} unread, ${plan.length} chunks`,
        `quotes returned ${returned.length}, failed citation ${failures}, kept ${kept.length}`,
        `slowest chunk ${Math.max(...msPerChunk)} ms`,
        ...[...byCategory].sort().map(([key, count]) => `  ${key.padEnd(32)} ${count}`),
      ].join("\n"),
    );
  }, 1_800_000);
}

afterAll(() => {
  // THE COUNT FIRST, so a partial run cannot read as a result (#195).
  const requested = SUBCONTRACT_CASES.length;
  const total = (pick: (v: Verdict) => number) => verdicts.reduce((sum, v) => sum + pick(v), 0);
  const plantedTotal = SUBCONTRACT_CASES.reduce((sum, kase) => sum + kase.planted.length, 0);
  const allChunkMs = verdicts.flatMap((v) => v.msPerChunk);
  const lines = [
    "",
    `subcontract-review eval — ${SUBCONTRACT_REVIEW_PROMPT_VERSION} on ${model}`,
    `verdicts: requested ${requested}, returned ${verdicts.length}`,
  ];
  if (verdicts.length !== requested) {
    lines.push(`  *** ${requested - verdicts.length} CASE(S) RETURNED NO VERDICT — every number below is over a SUBSET. ***`);
  }
  lines.push(
    "",
    `CITATION VALIDITY  ${total((v) => v.quotesReturned - v.quoteFailures.length)}/${total((v) => v.quotesReturned)}   <- must be 100%`,
    `HIGH ON CLEAN      ${total((v) => v.highOnClean.length)}   <- fatal: an invented risk`,
    `RECALL             ${plantedTotal - total((v) => v.missed.length)}/${plantedTotal} planted clauses`,
    `wrong page         ${total((v) => v.wrongPage.length)}`,
    `wrong figure       ${total((v) => v.wrongFigure.length)}`,
    `chunk time         max ${allChunkMs.length ? Math.max(...allChunkMs) : 0} ms (the action's deadline is 50,000)`,
    "",
  );
  for (const v of verdicts) {
    lines.push(`${v.name} (${v.chunks} chunk${v.chunks === 1 ? "" : "s"})`);
    for (const f of v.found) lines.push(`    ${f.severity.padEnd(6)} ${f.category.padEnd(20)} p.${f.pages.padEnd(5)} ${f.title}`);
    if (v.quoteFailures.length) lines.push(`    QUOTE FAILURES: ${v.quoteFailures.join(" | ")}`);
    if (v.highOnClean.length) lines.push(`    HIGH ON CLEAN: ${v.highOnClean.join(", ")}`);
    if (v.missed.length) lines.push(`    missed: ${v.missed.join(", ")}`);
    if (v.wrongPage.length) lines.push(`    wrong page: ${v.wrongPage.join(", ")}`);
    if (v.wrongFigure.length) lines.push(`    wrong figure: ${v.wrongFigure.join(", ")}`);
  }
  lines.push(
    "",
    "BOUNDED: synthetic contracts written for this repo, short and clean. Nothing here measures a",
    "120-page GC form with cross-references into a prime contract, nor two-column layouts, nor scans.",
    "",
  );
  console.log(lines.join("\n"));
});
