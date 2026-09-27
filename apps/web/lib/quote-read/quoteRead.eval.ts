import { afterAll, describe, expect, it } from "vitest";
import { extractBidQuote, type BidQuoteExtraction } from "@prova/integrations";
import { QUOTE_FIXTURES, quotePdf } from "./quoteFixtures";

/**
 * DOES THE QUOTE READER INVENT NUMBERS? — the one question worth paying to ask.
 *
 * Everything else about feature 5 is checkable for free and already is: the
 * switch, the allowance, the capability, that nothing is written without a
 * person. What none of that touches is whether the READING is any good, and this
 * is the first AI feature in this product where the quality of the answer
 * matters more than the plumbing around it. A wrong amount here is not a wrong
 * pixel — an estimator is about to level two subs against it.
 *
 * ── THE SCORING IS ASYMMETRIC, AND THAT IS THE WHOLE DESIGN ──
 *
 * Three ways to be wrong about an amount, and they are not equally bad:
 *
 *   INVENTED — a number where the document had no single total. The expensive
 *              failure. It puts a figure on screen that nothing marks as a
 *              guess, on the field a bid is built from. **Any of these fails
 *              the eval.**
 *   WRONG    — a number, but not the one printed. Equally bad, same reason, and
 *              counted separately only so a report can say which kind it was.
 *   MISSED   — null where there was a total. A safe failure: the estimator types
 *              the figure, which is what they did before this feature existed.
 *              **Reported, never fatal.**
 *
 * An eval that scored these together would let a model trade three inventions
 * for three extra reads and call it progress. That is the trade this file exists
 * to refuse.
 *
 * ── HOW TO RUN IT, AND WHAT IT COSTS ──
 *
 *     ANTHROPIC_API_KEY=… pnpm --filter @prova/web ask:eval
 *
 * By hand, never in CI, like every other eval here — and this repo's memory
 * carries a scar about an eval run emptying a shared credit balance, so the
 * figure is stated rather than left to be discovered: **seven documents, one
 * Opus call each.** No retries, no loop. It refuses to start without a key
 * rather than passing on nothing, because a green run of zero cases and a green
 * run of seven look identical in a terminal.
 *
 * ── WHAT IT CANNOT TELL YOU ──
 *
 * These are SYNTHETIC documents, and deliberately so — a real quote is a
 * competitor's pricing and must never be a fixture. The cost is real and worth
 * naming: they are clean, single-column, digitally generated text. A scanned fax
 * at an angle is a harder problem and this eval says nothing about it. What it
 * does measure is the JUDGEMENT — a range, a base plus alternates, a unit price
 * with no quantity, a spec section that is not a quote at all — and that is the
 * half where a confident wrong answer costs money.
 */

/** Cases the fixtures do not carry on their own: what a correct reading is. */
const EXPECTED: Record<string, { amount: number | null; why: string }> = {
  "plain-total": { amount: 184_500, why: "one printed total, thousands separator and cents" },
  "subtotal-tax-total": {
    amount: 78_385.86,
    // The TOTAL, not the subtotal: the prompt says so, and a reader who took
    // 72,400 would be levelling a pre-tax price against a post-tax one.
    why: "subtotal, tax and total on the page — the total is the price",
  },
  "range-no-single-total": { amount: null, why: "a range, so there is no one figure to bid against" },
  "base-plus-alternates": {
    amount: null,
    // Arguably 212,000. It is NOT: which alternates are in is the estimator's
    // decision, and a base bid presented as the price is the shape that loses a
    // job. The prompt is explicit and this case is here to hold it to that.
    why: "base plus separately priced alternates — no total until somebody picks",
  },
  "unit-price-no-quantity": { amount: null, why: "$/sq ft with the quantity undetermined" },
  "not-a-quote": { amount: null, why: "a specification section, not a price at all" },
  "no-date": { amount: 61_750, why: "a total with no date — the amount reads, the date must not be invented" },
};

type Verdict = {
  id: string;
  amount: "correct" | "invented" | "wrong" | "missed";
  got: number | null;
  want: number | null;
  /** Did it say why, when it declined to give a number? */
  explained: boolean;
  dateOk: boolean;
  notes: string | null;
};

const verdicts: Verdict[] = [];

function requireApiKey(): void {
  // The same posture `lib/ask/eval/harness.ts` takes, and for the reason its own
  // comment gives: absence of a failure is not a pass.
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is not set: the quote eval did not run. It is not a pass.");
  }
}

async function read(id: string): Promise<BidQuoteExtraction> {
  const fixture = QUOTE_FIXTURES.find((f) => f.id === id);
  if (!fixture) throw new Error(`no fixture named ${id}`);
  return extractBidQuote({
    fileBase64: quotePdf(fixture.lines).toString("base64"),
    mediaType: "application/pdf",
    fileName: `${id}.pdf`,
  });
}

/** Money compared to the cent, because that is the precision a quote is written
 *  at and `BidQuote.amount` stores — `Decimal(12,2)`. */
function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

describe("the quote reader, against synthetic documents", () => {
  requireApiKey();

  for (const [id, expected] of Object.entries(EXPECTED)) {
    it(`${id} — ${expected.why}`, async () => {
      const got = await read(id);

      const amount =
        expected.amount === null
          ? got.amount === null
            ? ("correct" as const)
            : ("invented" as const)
          : got.amount === null
            ? ("missed" as const)
            : sameMoney(got.amount, expected.amount)
              ? ("correct" as const)
              : ("wrong" as const);

      verdicts.push({
        id,
        amount,
        got: got.amount,
        want: expected.amount,
        // When it declines a number it must say why, or the estimator is left
        // with an empty box and no reason — which reads as a failed read rather
        // than a deliberate one.
        explained: got.amount !== null || Boolean(got.readingNotes?.trim()),
        // A date is either absent or a real ISO day. Never today's.
        dateOk:
          got.quotedOn === null ||
          (/^\d{4}-\d{2}-\d{2}$/.test(got.quotedOn) && got.quotedOn !== new Date().toISOString().slice(0, 10)),
        notes: got.readingNotes?.trim() || null,
      });

      // PER-CASE, THE ONLY FATAL OUTCOME IS A NUMBER THAT SHOULD NOT EXIST.
      // A missed total is reported and allowed: it degrades to the behaviour
      // this feature replaced, which is a person typing the figure.
      expect(
        amount === "invented" ? `invented ${got.amount} — ${expected.why}` : "no invention",
        `${id}: the document has no single total and the reader supplied one`,
      ).toBe("no invention");
      expect(amount === "wrong" ? `read ${got.amount}, printed ${expected.amount}` : "amount ok").toBe("amount ok");
      expect(verdicts.at(-1)!.dateOk, `${id}: quotedOn should be a real ISO day or null, got ${got.quotedOn}`).toBe(
        true,
      );
    });
  }

  it("exclusions come back on the cases that printed them", async () => {
    // Read once and reused from the verdicts above would be cheaper, but this
    // asserts a different field and sharing a response between two cases makes a
    // rate-limited run look like a content failure.
    const got = await read("plain-total");
    const exclusions = (got.exclusions ?? "").toLowerCase();
    // The FIELD THAT DECIDES whether the cheapest is the best. All three,
    // because picking one is the failure that matters: a quote that excludes
    // painting and is read as excluding only firestopping is the hole in the
    // scope somebody buys.
    for (const item of ["firestopping", "soffits", "painting"]) {
      expect(exclusions, `plain-total excluded ${item} and the reading should say so`).toContain(item);
    }
  });

  afterAll(() => {
    // THE REPORT, and it is the point of running this rather than the pass/fail.
    // Verdicts RETURNED against verdicts REQUESTED first, because a run that
    // died on a rate limit after two cases must not read as two passes — the
    // rule CLAUDE.md states for anything that aggregates.
    const requested = Object.keys(EXPECTED).length;
    const tally = {
      correct: verdicts.filter((v) => v.amount === "correct").length,
      invented: verdicts.filter((v) => v.amount === "invented").length,
      wrong: verdicts.filter((v) => v.amount === "wrong").length,
      missed: verdicts.filter((v) => v.amount === "missed").length,
      unexplained: verdicts.filter((v) => !v.explained).length,
    };
    console.log(`\nquote eval: requested ${requested}, returned ${verdicts.length}`);
    if (verdicts.length !== requested) {
      console.log("  INCOMPLETE — the numbers below are over the cases that ran, not over the suite.");
    }
    console.log(
      `  amount: ${tally.correct} correct, ${tally.invented} INVENTED, ${tally.wrong} wrong, ${tally.missed} missed`,
    );
    console.log(`  declined without saying why: ${tally.unexplained}`);
    for (const v of verdicts) {
      const shape = v.amount.padEnd(8);
      console.log(`  ${shape} ${v.id}  got=${v.got ?? "null"} want=${v.want ?? "null"}`);
      if (v.notes) console.log(`           notes: ${v.notes}`);
    }
  });
});
