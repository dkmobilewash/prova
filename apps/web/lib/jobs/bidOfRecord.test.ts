import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bidTotalOf } from "@/lib/estimating/recap-state";

/**
 * ONE FUNCTION FOR "THE BID" — bug C from the 2026-10-19 walk.
 *
 * The job header said BID $0.00 directly above a bid recap that said
 * $10,249.47. Both were right about different things: the header adds up the
 * line PRICES (the bid of record, which the proposal prints and the contract
 * value becomes), the recap adds markup to the line COSTS (what those prices
 * become once applied). Nothing tied them together, and the header computed its
 * figure with a sum of its own rather than the `bidTotalOf` that
 * `recap-state.ts` already documents as "WHAT THE BID COMES TO".
 *
 * A census rather than a render, because the claim is about where the number
 * comes FROM: two separately written sums of quantity × price agree on the day
 * they are written and stop agreeing the day one of them learns something —
 * this repo's "a guard that a list is complete cannot notice a second list".
 * Comments are stripped first: both files explain this bug in prose that quotes
 * the very expressions being forbidden.
 */

const web = join(dirname(fileURLToPath(import.meta.url)), "../..");
const code = (path: string) =>
  readFileSync(join(web, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

describe("the bid of record has one source (bug C)", () => {
  it("loadJobSummary takes the header's figure from bidTotalOf and sums no prices itself", () => {
    const source = code("lib/jobs/job-summary.ts");
    expect(source).toMatch(/contractValue\s*=\s*bidTotalOf\(job\.lineItems\)/);
    // `unitPrice` is still SELECTED — it is what bidTotalOf reads — so the
    // check runs over the code AFTER the query, where a second sum would be.
    const anchor = source.indexOf("if (!job || job.companyId !== companyId)");
    expect(anchor, "the anchor moved; re-point this census").toBeGreaterThan(0);
    const afterQuery = source.slice(anchor);
    expect(afterQuery).toContain("bidTotalOf(");
    expect(afterQuery).not.toMatch(/unitPrice/);
  });

  it("the bid recap's 'Bid on the job now' row reads bidTotalOf too", () => {
    expect(code("components/BidRecapPanel.tsx")).toMatch(/bidOnJob:\s*bidTotalOf\(shownLines\)/);
  });

  it("bidTotalOf counts a cost-only line at $0 and takes either numbers or Prisma-style decimals", () => {
    expect(
      bidTotalOf([
        { quantity: "2800", unitPrice: null },
        { quantity: 300, unitPrice: "6.5" },
      ]),
    ).toBe(1950);
  });
});
