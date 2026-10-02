import { afterAll, describe, expect, it } from "vitest";
import { extractSheetTitleBlock, PLAN_SHEET_PROMPT_VERSION, type SheetTitleBlock } from "@prova/integrations";
import { planSetPdf, type SyntheticSheet } from "./planFixtures";
import { SHEET_CASES, sameish } from "./planSheetCases";
import { openPlanPdf, titleBlockText } from "./planPdf";
import { requireEvalApiKey } from "@/lib/ai/evalApiKey";

/**
 * IS THE READER HONEST ABOUT WHAT IT DOES NOT KNOW? — the question worth paying for.
 *
 * `docs/ai/DECISIONS.md` lists "whether Haiku 4.5 is accurate enough for sheet
 * classification and title blocks" as an open question and says the eval decides it.
 * It also says which metric decides:
 *
 *   "The metric I care most about is false confidence, not accuracy. A count that is
 *    85% accurate and says so is useful; a count that is 85% accurate and reads as
 *    certain is a wrong bid. So every feature is graded on calibration as well as
 *    correctness."
 *
 * So this grades both, and they are scored DIFFERENTLY.
 *
 * ── THE SCORING, AND WHY IT IS SHAPED THIS WAY ──
 *
 * Four ways to be wrong about a sheet number:
 *
 *   INVENTED   a number on a sheet that printed none. The expensive failure: a sheet
 *              index nobody can navigate by, and an estimator measuring quantities
 *              onto the wrong floor's label. **Fatal.**
 *   WRONG      a number, but not the printed one — usually a reference to ANOTHER
 *              sheet picked up from the drawing area. Same cost. **Fatal.**
 *   MISSED     null where a number was printed. Safe: the review screen asks for it
 *              to be typed, which is what happened before this feature existed.
 *              **Reported, never fatal.**
 *   OVERCLAIMED any of the first two, reported as HIGH. **Fatal, and counted
 *              separately**, because it is the difference between a reader somebody
 *              can work with and one they cannot. A wrong answer marked LOW sorts to
 *              the top of the review list and gets looked at; the same answer marked
 *              HIGH sorts to the bottom and is trusted.
 *
 * UNDER-claiming — a number read CORRECTLY but marked LOW — is reported and allowed.
 * A reader that hedges everything is useless, but useless in the safe direction, and
 * the figure is on screen so it can be argued about rather than assumed away.
 *
 * It applies only where a confident answer was available. Answering LOW about a sheet
 * that prints no number is not hedging, it is the correct reading — and `not-a-sheet`
 * carries `ceiling: "LOW"` to require exactly that. The first run counted those two
 * as hedged, so the report was demanding LOW and scoring it as a weakness three lines
 * apart.
 *
 * ── WHAT RUNS, END TO END ──
 *
 * Each case is a real multi-page PDF, opened with the real `openPlanPdf`, its
 * title-block text extracted by the real region filter, and THAT text sent to the
 * model. So a failure here can be the prompt, the model, or the extraction — which
 * is the honest scope, because those three are what an estimator actually meets. The
 * report prints the extracted text on any failure so the next person can tell which.
 *
 * ── HOW TO RUN IT, AND WHAT IT COSTS ──
 *
 *     ANTHROPIC_API_KEY=… pnpm --filter @prova/web exec \
 *       vitest run --config vitest.eval.config.mts lib/plan-ingest/planSheets.eval.ts
 *
 * NAME THE FILE. `pnpm ask:eval` runs every `*.eval.ts` — this one, the Ask routing
 * eval and the top-questions eval — and the quote eval's header records why that
 * matters: a paragraph whose job is to state the cost must not understate it.
 *
 * **One Haiku call per case in `planSheetCases.ts`**, nine of them today. The figure
 * lives in that list rather than in this paragraph, because a count written into
 * prose is the kind of claim this repo deletes for rotting faster than the thing it
 * decorates — and the report prints `requested N, returned N` from the list itself.
 *
 * No retries and no loop. Haiku 4.5 is what `modelFor("PLAN_INGESTION")` resolves,
 * so this measures what production actually runs rather than a better model standing
 * in for it. It refuses to start without a key rather than passing on nothing,
 * because a green run of zero cases and a green run of nine look identical in a
 * terminal.
 *
 * ── WHAT IT CANNOT TELL YOU ──
 *
 * These are SYNTHETIC sheets, and deliberately: a customer's plan set is
 * confidential and must never be a fixture. They are clean, digitally generated
 * text, which is the easy half — a scanned set has no text layer at all and is
 * refused upstream by `hasTextLayer` rather than read badly. What this measures is
 * the JUDGEMENT: a reference mistaken for the sheet's own number, a missing number
 * invented, a scale silently converted, a date reformatted. Those are where a
 * confident wrong answer reaches a bid.
 */

type Verdict = {
  id: string;
  number: "correct" | "invented" | "wrong" | "missed";
  overclaimed: boolean;
  underclaimed: boolean;
  got: string | null;
  want: string | null;
  confidence: string;
  reason: string;
  fieldNotes: string[];
  text: string;
};

const verdicts: Verdict[] = [];

function requireApiKey(): void {
  // Shared with every other eval — see `lib/ai/evalApiKey.ts`. It also rejects
  // the PLACEHOLDER from this file's own run instructions, which the local copy
  // this replaced did not: "is the variable set" is satisfied perfectly by a
  // single character, and the run then dies at the API looking like a broken
  // eval rather than an unedited command.
  requireEvalApiKey("plan-sheet eval");
}

/** The fixture, through the real extraction, as text. */
async function textOf(sheet: SyntheticSheet): Promise<string> {
  const doc = await openPlanPdf(planSetPdf([sheet]));
  try {
    return titleBlockText(await doc.pageText(1)).text;
  } finally {
    await doc.close();
  }
}

const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

describe("reading a title block, against synthetic sheets", () => {
  requireApiKey();

  for (const one of SHEET_CASES) {
    it(`${one.id} — ${one.why}`, async () => {
      const text = await textOf(one.sheet);
      // A CASE WHOSE TEXT CAME OUT EMPTY IS A HARNESS FAILURE, not a model one, and
      // it must not be scored as a refusal. `planPdf.test.ts` covers the extraction;
      // this guards against a fixture that silently stopped producing text.
      expect(text.trim().length, `${one.id}: the fixture produced no title-block text to send`).toBeGreaterThan(0);

      const read = await extractSheetTitleBlock({
        titleBlockText: text,
        pageNumber: 1,
        model: "claude-haiku-4-5",
      });

      const number =
        one.sheetNumber === null
          ? read.sheetNumber === null
            ? ("correct" as const)
            : ("invented" as const)
          : read.sheetNumber === null
            ? ("missed" as const)
            : sameish(read.sheetNumber, one.sheetNumber)
              ? ("correct" as const)
              : ("wrong" as const);

      const badNumber = number === "invented" || number === "wrong";
      const ceiling = one.ceiling ?? "HIGH";

      // The other fields, reported rather than fatal: a wrong scale is a field an
      // estimator corrects in place, not a number a bid is built on.
      const fieldNotes: string[] = [];
      for (const [field, want] of Object.entries(one.expect ?? {}) as [keyof SheetTitleBlock, string][]) {
        const got = read[field];
        if (!sameish(typeof got === "string" ? got : null, want)) {
          fieldNotes.push(`${field}: got ${JSON.stringify(got)}, printed ${JSON.stringify(want)}`);
        }
      }

      verdicts.push({
        id: one.id,
        number,
        // CONFIDENT AND WRONG — the failure this eval is named for.
        overclaimed: (badNumber && read.confidence === "HIGH") || RANK[read.confidence] > RANK[ceiling],
        // ONLY WHERE A CONFIDENT ANSWER WAS AVAILABLE, which the first run showed
        // this had wrong. It counted `no-number` and `not-a-sheet` as "hedged when
        // right" for answering LOW — but on a sheet that prints no number, LOW IS
        // the right answer, and `not-a-sheet` has `ceiling: "LOW"` precisely to
        // require it. The report was demanding LOW and then scoring it as a
        // weakness, in the same three lines. A null answer cannot be under-claimed.
        underclaimed: number === "correct" && one.sheetNumber !== null && read.confidence === "LOW",
        got: read.sheetNumber,
        want: one.sheetNumber,
        confidence: read.confidence,
        reason: read.reason,
        fieldNotes,
        text,
      });

      // FATAL: a number that should not exist, or the wrong one.
      expect(
        number === "invented" ? `invented ${read.sheetNumber}` : "no invention",
        `${one.id}: the sheet printed no number and the reader supplied one — ${one.why}`,
      ).toBe("no invention");
      expect(
        number === "wrong" ? `read ${read.sheetNumber}, printed ${one.sheetNumber}` : "number ok",
        `${one.id}: ${one.why}`,
      ).toBe("number ok");

      // FATAL: over-claimed confidence. Graded separately from correctness because
      // DECISIONS.md says it is the metric that matters more.
      expect(
        verdicts.at(-1)!.overclaimed ? `claimed ${read.confidence}` : "calibrated",
        `${one.id}: an honest reading here could claim at most ${ceiling}` +
          (badNumber ? ", and this one got the number wrong" : ""),
      ).toBe("calibrated");

      // A reason somebody can check. `intake.prisma`'s standard, and the review
      // screen shows this string beside the fields.
      expect(read.reason.trim().length, `${one.id}: a reading with no reason cannot be overruled`).toBeGreaterThan(0);
      expect(read.reason.toLowerCase(), `${one.id}: "AI determined" is not a reason`).not.toMatch(
        /\bai (determined|decided|found|extracted)\b/,
      );
    });
  }

  afterAll(() => {
    // VERDICTS RETURNED AGAINST VERDICTS REQUESTED FIRST — CLAUDE.md's rule for
    // anything that aggregates. A run that died on a rate limit after three cases
    // must not read as three passes.
    const requested = SHEET_CASES.length;
    const tally = {
      correct: verdicts.filter((v) => v.number === "correct").length,
      invented: verdicts.filter((v) => v.number === "invented").length,
      wrong: verdicts.filter((v) => v.number === "wrong").length,
      missed: verdicts.filter((v) => v.number === "missed").length,
      overclaimed: verdicts.filter((v) => v.overclaimed).length,
      underclaimed: verdicts.filter((v) => v.underclaimed).length,
      fieldMisses: verdicts.reduce((sum, v) => sum + v.fieldNotes.length, 0),
    };

    console.log(`\nplan-sheet eval (${PLAN_SHEET_PROMPT_VERSION}): requested ${requested}, returned ${verdicts.length}`);
    if (verdicts.length !== requested) {
      console.log("  INCOMPLETE — the numbers below are over the cases that ran, not over the suite.");
    }
    console.log(
      `  sheet number: ${tally.correct} correct, ${tally.invented} INVENTED, ${tally.wrong} WRONG, ${tally.missed} missed`,
    );
    console.log(`  calibration:  ${tally.overclaimed} OVERCLAIMED, ${tally.underclaimed} hedged when right`);
    console.log(`  other fields: ${tally.fieldMisses} off (reported, not fatal)`);

    for (const v of verdicts) {
      console.log(
        `  ${v.number.padEnd(8)} ${v.confidence.padEnd(6)} ${v.id}  got=${v.got ?? "null"} want=${v.want ?? "null"}` +
          `${v.overclaimed ? "  <- OVERCLAIMED" : ""}`,
      );
      console.log(`           reason: ${v.reason}`);
      for (const note of v.fieldNotes) console.log(`           field:  ${note}`);
      // THE TEXT, on anything that went wrong, because a failure here can be the
      // prompt, the model OR the extraction and the three are indistinguishable
      // from a verdict alone.
      if (v.number !== "correct" || v.overclaimed || v.fieldNotes.length > 0) {
        console.log(`           text sent:\n${v.text.replace(/^/gm, "             ")}`);
      }
    }
  });
});
