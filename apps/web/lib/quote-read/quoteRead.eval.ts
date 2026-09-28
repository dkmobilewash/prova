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
 *     ANTHROPIC_API_KEY=… pnpm --filter @prova/web exec \
 *       vitest run --config vitest.eval.config.mts lib/quote-read/quoteRead.eval.ts
 *
 * NAME THE FILE. This said `pnpm --filter @prova/web ask:eval` until 2026-09-28,
 * which is the script that runs this — and also `routing.eval.ts` and
 * `top-questions.eval.ts`, because the config's `include` is `**\/*.eval.ts`.
 * That understated the cost of following the instruction, in a paragraph whose
 * entire job is to state the cost. Use the script when you mean to run every
 * eval; name this file when you mean to run this one.
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

/**
 * Whether this document should produce a caution at all.
 *
 * THE DIRECTION THIS FILE WAS BLIND TO UNTIL 2026-09-28. The first run scored
 * 7 of 7 on amounts and `declined without saying why: 0` — and every one of the
 * seven wrote a paragraph, including the two with nothing whatever to caution
 * about. `declined without saying why` only ever rewarded HAVING a note; nothing
 * penalised having one that should not exist. An asymmetric scorer for amounts
 * sitting beside a one-directional one for notes.
 *
 * It matters because of where the note lands. `QuoteReadingNotes` renders the
 * panel headed "Check these before you save" whenever `readingNotes` is
 * non-empty, and its own header says it stays silent on a clean read *"because a
 * panel that always says something teaches people to skip it"*. A note on every
 * quote defeats that in one step: the caution becomes furniture, and the cost is
 * paid on the one reading where it mattered.
 *
 * So "none" is an assertion about the SCREEN, not about prose style, and it is
 * fatal for the same reason an invented number is — both put something in front
 * of an estimator that should not be there. `required` is fatal too: a blank
 * amount with no reason reads as a failed read rather than a deliberate one.
 */
type NoteExpectation = "required" | "none";

/** Cases the fixtures do not carry on their own: what a correct reading is. */
const EXPECTED: Record<string, { amount: number | null; note: NoteExpectation; why: string }> = {
  // Clean: one printed total, exclusions listed, nothing ambiguous. The panel
  // must not speak here, and this is the case that proves it can stay quiet.
  "plain-total": { amount: 184_500, note: "none", why: "one printed total, thousands separator and cents" },
  "subtotal-tax-total": {
    amount: 78_385.86,
    // Also clean: a TOTAL is printed, so rule 2's "say so" branch (tax listed
    // with no total) does not apply and there is nothing to report.
    note: "none",
    // The TOTAL, not the subtotal: the prompt says so, and a reader who took
    // 72,400 would be levelling a pre-tax price against a post-tax one.
    why: "subtotal, tax and total on the page — the total is the price",
  },
  "range-no-single-total": {
    amount: null,
    note: "required",
    why: "a range, so there is no one figure to bid against",
  },
  "base-plus-alternates": {
    amount: null,
    note: "required",
    // Arguably 212,000. It is NOT: which alternates are in is the estimator's
    // decision, and a base bid presented as the price is the shape that loses a
    // job. The prompt is explicit and this case is here to hold it to that.
    why: "base plus separately priced alternates — no total until somebody picks",
  },
  "unit-price-no-quantity": { amount: null, note: "required", why: "$/sq ft with the quantity undetermined" },
  "not-a-quote": { amount: null, note: "required", why: "a specification section, not a price at all" },
  "no-date": {
    amount: 61_750,
    // The one case with an amount that SHOULD still speak: "valid thirty days
    // from issue" cannot be dated without the issue date, and the first run's
    // note said to ask the sub whether the price is still good — which is the
    // kind of thing this field is for.
    note: "required",
    why: "a total with no date — the amount reads, the date must not be invented",
  },
};

type Verdict = {
  id: string;
  amount: "correct" | "invented" | "wrong" | "missed";
  got: number | null;
  want: number | null;
  /** Did it say why, when it declined to give a number? */
  explained: boolean;
  /** Did the caution panel speak exactly when it should have? */
  note: "right" | "missing" | "unwanted";
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

      const spoke = Boolean(got.readingNotes?.trim());
      const note =
        expected.note === "required"
          ? spoke
            ? ("right" as const)
            : ("missing" as const)
          : spoke
            ? ("unwanted" as const)
            : ("right" as const);

      verdicts.push({
        id,
        amount,
        note,
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

      // THE CAUTION PANEL HAS TO BE RIGHT IN BOTH DIRECTIONS. An unwanted note
      // is fatal rather than cosmetic: it renders as "Check these before you
      // save" over a reading with nothing wrong with it, and a panel that always
      // speaks is one nobody reads. The message carries the note itself, because
      // "it said something it should not have" is unactionable without the text.
      expect(
        note === "unwanted" ? `unwanted note: ${got.readingNotes}` : "note ok",
        `${id}: a clean reading must leave readingNotes null — the panel is headed "Check these before you save"`,
      ).toBe("note ok");
      expect(
        note === "missing" ? "no note at all" : "note ok",
        `${id}: this reading needs a caution and produced none — ${expected.why}`,
      ).toBe("note ok");
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
      noteRight: verdicts.filter((v) => v.note === "right").length,
      noteUnwanted: verdicts.filter((v) => v.note === "unwanted").length,
      noteMissing: verdicts.filter((v) => v.note === "missing").length,
    };
    console.log(`\nquote eval: requested ${requested}, returned ${verdicts.length}`);
    if (verdicts.length !== requested) {
      console.log("  INCOMPLETE — the numbers below are over the cases that ran, not over the suite.");
    }
    console.log(
      `  amount: ${tally.correct} correct, ${tally.invented} INVENTED, ${tally.wrong} wrong, ${tally.missed} missed`,
    );
    console.log(`  declined without saying why: ${tally.unexplained}`);
    // The caution panel, in both directions — an UNWANTED note is the one the
    // first run could not see, and the length is printed so creeping verbosity
    // shows up before it becomes a paragraph nobody reads.
    console.log(
      `  caution panel: ${tally.noteRight} right, ${tally.noteUnwanted} UNWANTED, ${tally.noteMissing} missing`,
    );
    for (const v of verdicts) {
      const shape = v.amount.padEnd(8);
      console.log(`  ${shape} ${v.id}  got=${v.got ?? "null"} want=${v.want ?? "null"}  note=${v.note}`);
      if (v.notes) console.log(`           notes (${v.notes.length} chars): ${v.notes}`);
    }
  });
});
