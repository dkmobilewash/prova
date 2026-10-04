import { afterAll, describe as group, expect, it } from "vitest";
import { countSymbols, SYMBOL_COUNT_PROMPT_VERSION, type SymbolCount } from "@prova/integrations";
import { SYMBOL_CASES } from "./symbolCases";
import { effectiveDpi, synthesiseSheet, trueCount } from "./syntheticSheet";
import { requireEvalApiKey } from "@/lib/ai/evalApiKey";

// At MODULE SCOPE, before any case runs. A suite that needs a key it does not
// have must fail loudly rather than skip: a green run of zero cases and a green
// run of eight look identical in a terminal, and the first reads as a clean bill.
//
// `requireEvalApiKey` and NOT `harness.ts`'s `requireApiKey`: the shared one also
// rejects the "…" PLACEHOLDER from an eval's own run instructions, which satisfies
// "is the variable set" perfectly and then dies at the API looking like a broken
// eval rather than an unedited command. `evalApiKey.ts` records why there is one
// of these instead of four copies.
requireEvalApiKey("symbol-count eval");

/**
 * CAN SYMBOL-COUNTING REACH A PRECISION AN ESTIMATOR WOULD ACCEPT?
 *
 * `docs/ai/DECISIONS.md` has carried that as an open question with **zero code
 * behind it**, and `FEATURE-AUDIT.md:469` carries drawing takeoff via computer
 * vision as Missing. This is the instrument, not the feature: nothing in the app
 * calls `countSymbols`, it is not in `AI_FEATURES`, and it is not metered.
 *
 * Run it deliberately, never in CI:
 *
 *     pnpm --filter @prova/web exec vitest run lib/takeoff/symbolCount.eval.ts
 *
 * ── THE METRIC IS FALSE CONFIDENCE, NOT ACCURACY ──
 *
 * `DECISIONS.md` in its own words: *"a count that is 85% accurate and says so is
 * useful; a count that is 85% accurate and reads as certain is a wrong bid."* So
 * the grading is ASYMMETRIC, the same way the title-block eval's was:
 *
 *   OVERCLAIMED — a wrong count reported as countable. **FATAL.** This is the
 *                 only outcome that puts a wrong number into a bid, and one of
 *                 them is worse than every honest decline combined.
 *   DECLINED    — countable false, count null. **NOT A FAILURE.** It is the
 *                 correct answer whenever the sheet cannot be read, and at 44
 *                 DPI it very often is.
 *   CORRECT     — exact count, countable true.
 *   SILENT      — declined on a sheet the other arm proves is countable.
 *                 Reported, not fatal: over-caution costs a click, not a bid.
 *
 * ── AND THE PAIRING IS WHAT MAKES A FAILURE INTERPRETABLE ──
 *
 * Every case runs on an ARCH D sheet (~44 DPI) and a letter sheet (~143 DPI)
 * with identical symbols. `planPdf.ts` measured that constraint. Without the
 * pair, "symbol counting does not work" cannot be told apart from "a 36-inch
 * sheet cannot be seen", and those two findings point opposite ways — one says
 * build a tiler, the other says abandon the feature.
 *
 * ── THE VERDICT COUNT IS PRINTED FIRST, AND IT IS NOT DECORATION ──
 *
 * This repo's scar: a multi-agent review reported "0 confirmed, 10 refuted" when
 * every verify agent had died before writing a verdict, because the aggregator
 * counted "no verdict" as "refuted". **Absence of a failure is not a pass.** So
 * this prints `requested N, returned N` before any score, and the suite FAILS if
 * those disagree — a case that threw is its own failure state, never folded into
 * a decline.
 */

type Verdict = {
  id: string;
  size: "ARCH_D" | "DETAIL";
  /** CLEAN is the control that was measured on 2026-10-02; CLUTTERED is the
   *  question `DECISIONS.md` said had to be asked before building anything. */
  arm: "CLEAN" | "CLUTTERED";
  why: string;
  truth: number;
  result: SymbolCount | null;
  grade: "CORRECT" | "DECLINED" | "OVERCLAIMED" | "ERROR";
  /** How far off, when it answered at all. */
  off: number | null;
};

const verdicts: Verdict[] = [];

/**
 * OPUS BY DEFAULT, AND THE FIRST RUN IS WHY THIS IS NOT `modelFor("PLAN_INGESTION")`.
 *
 * That is what this eval asked on 2026-10-02, because symbol counting has no
 * feature of its own to resolve a model from and plan ingestion was the closest
 * thing. It was the wrong stand-in, and the measurement is the argument:
 * PLAN_INGESTION is Haiku 4.5 for a VOLUME reason (hundreds of sheets per set),
 * and `models.ts`'s actual rule is that every feature is Opus unless Diego asked
 * otherwise — he asked for one thing, high-volume page work. Counting symbols on
 * a sheet an estimator chose is not that.
 *
 * Override to re-measure any model:
 *
 *     ANTHROPIC_MODEL_SYMBOL_COUNT=claude-haiku-4-5 pnpm eval:symbols
 */
const model = process.env.ANTHROPIC_MODEL_SYMBOL_COUNT?.trim() || "claude-opus-5";

function grade(truth: number, result: SymbolCount): { grade: Verdict["grade"]; off: number | null } {
  if (!result.countable || result.count === null) return { grade: "DECLINED", off: null };
  const off = result.count - truth;
  // An exact count is the only thing that counts as correct. A takeoff is not
  // graded on a curve: 41 doors priced as 42 is a wrong bid by one door.
  return { grade: off === 0 ? "CORRECT" : "OVERCLAIMED", off };
}

group("symbol counting, on synthetic sheets", () => {
  for (const one of SYMBOL_CASES) {
    it(`${one.id} — ${one.why}`, async () => {
      const size = one.sheet.sheetSize;
      const arm = one.arm;
      // THE TRUTH COMES FROM THE SHEET, per kind, never from the case's own
      // `count` — a cluttered sheet carries a competing kind, and grading
      // against the case number would be grading against the wrong total the
      // moment a fixture grew a second entry.
      const truth = trueCount(one.sheet, one.kind);
      let result: SymbolCount | null = null;
      let graded: { grade: Verdict["grade"]; off: number | null } = { grade: "ERROR", off: null };

      try {
        result = await countSymbols({
          fileBase64: synthesiseSheet(one.sheet).toString("base64"),
          symbol: one.ask,
          looksLike: one.looksLike,
          model,
        });
        graded = grade(truth, result);
      } catch (error) {
        // Recorded as ERROR and NOT as a decline. A call that never happened
        // tells you nothing about the model's judgement, and letting it read as
        // caution is the exact defect the verdict-count rule exists for.
        verdicts.push({
          id: one.id,
          size,
          arm,
          why: one.why,
          truth,
          result: null,
          grade: "ERROR",
          off: null,
        });
        throw error;
      }

      verdicts.push({ id: one.id, size, arm, why: one.why, truth, result, grade: graded.grade, off: graded.off });

      // THE ONLY FATAL ASSERTION. Everything else is measured and reported; a
      // confident wrong count is the thing that must never ship.
      expect(
        graded.grade,
        `${one.id}: reported ${result.count} with confidence ${result.confidence} when the truth is ${truth}. ` +
          `A wrong count presented as countable is the failure this eval exists to find. ` +
          `It said: "${result.uncertainty}"`,
      ).not.toBe("OVERCLAIMED");

      // And an answer must carry a checkable doubt either way — the rule
      // `intake.prisma` states as "a reason nobody can check is a reason nobody
      // can overrule".
      expect(result.uncertainty.trim().length, `${one.id}: no uncertainty given`).toBeGreaterThan(0);
      expect(result.uncertainty.trim().toLowerCase(), `${one.id}: "none" is not an uncertainty`).not.toBe("none");
    });
  }

  afterAll(() => {
    // THE COUNT FIRST, before any score, so a partial run cannot read as a result.
    const requested = SYMBOL_CASES.length;
    const lines: string[] = [
      "",
      `symbol-count eval — ${SYMBOL_COUNT_PROMPT_VERSION} on ${model}`,
      `verdicts: requested ${requested}, returned ${verdicts.length}`,
    ];
    if (verdicts.length !== requested) {
      lines.push(
        `  *** ${requested - verdicts.length} CASE(S) RETURNED NO VERDICT. Every number below is over a ` +
          `SUBSET and must not be read as a result. ***`,
      );
    }

    for (const arm of ["CLEAN", "CLUTTERED"] as const) {
      for (const size of ["ARCH_D", "DETAIL"] as const) {
        const cell = verdicts.filter((v) => v.arm === arm && v.size === size);
        if (cell.length === 0) continue;
        const n = (g: Verdict["grade"]) => cell.filter((v) => v.grade === g).length;
        lines.push(
          "",
          `${arm} / ${size} (~${Math.round(effectiveDpi(size))} DPI): ${cell.length} cases`,
          `  correct     ${n("CORRECT")}`,
          `  declined    ${n("DECLINED")}   (honest, not a failure)`,
          `  OVERCLAIMED ${n("OVERCLAIMED")}   <- the one that matters`,
          `  errored     ${n("ERROR")}`,
        );
        for (const v of cell) {
          const said = v.result
            ? v.result.countable
              ? `said ${v.result.count} (${v.result.confidence})`
              : `declined (${v.result.confidence})`
            : "no result";
          lines.push(`    ${v.grade.padEnd(11)} ${v.id.padEnd(30)} truth ${String(v.truth).padEnd(3)} ${said}`);
        }
      }
    }

    // THE INTERPRETATION, stated by the eval rather than left to a reader.
    //
    // THE CLEAN ARM IS THE CONTROL AND IS READ FIRST. A drop on the cluttered
    // sheets only means "the clutter did it" if the clean arm still scores what
    // it scored on 2026-10-02 in the SAME run. If the control has moved, the
    // difference is about the prompt, the model, the PDF writer or the grader —
    // and reading it as a finding about clutter would be this repo's own
    // failed-control scar wearing a new coat of paint.
    const tally = (arm: Verdict["arm"]) => {
      const cell = verdicts.filter((v) => v.arm === arm);
      return {
        cases: cell.length,
        correct: cell.filter((v) => v.grade === "CORRECT").length,
        over: cell.filter((v) => v.grade === "OVERCLAIMED").length,
        declined: cell.filter((v) => v.grade === "DECLINED").length,
      };
    };
    const clean = tally("CLEAN");
    const dirty = tally("CLUTTERED");

    lines.push("", "WHAT THIS MEANS:");
    if (clean.cases === 0 || dirty.cases === 0) {
      lines.push("  One arm did not run. Nothing below is comparable; fix the harness first.");
    } else if (clean.correct !== clean.cases) {
      lines.push(
        `  *** THE CONTROL MOVED: ${clean.correct}/${clean.cases} on CLEAN sheets, which scored`,
        "  8/8 on 2026-10-02. Read NOTHING about clutter from this run — something changed in",
        "  the prompt, the model, the PDF writer or the grader. A control that fails is the",
        "  instruction to fix the harness, not a result to read. ***",
      );
    } else if (dirty.over > 0) {
      lines.push(
        `  CONTROL HELD (${clean.correct}/${clean.cases} clean) AND COMPETING GEOMETRY BREAKS IT:`,
        `  ${dirty.over} of ${dirty.cases} cluttered sheets were OVERCLAIMED — a confident wrong count.`,
        "  This is the answer DECISIONS.md asked for, and for a feature as designed it is NO:",
        "  a real drawing has poché, dimension strings and more than one symbol kind on it, and",
        "  the model does not know when those have beaten it. Do not build phase 1 on the clean",
        "  result. The per-case lines say which symbol and which size failed.",
      );
    } else if (dirty.correct === dirty.cases) {
      lines.push(
        `  CONTROL HELD (${clean.correct}/${clean.cases}) AND THE CLUTTERED ARM IS CLEAN TOO`,
        `  (${dirty.correct}/${dirty.cases}, 0 overclaimed). Poché, dimension strings, keynotes and a`,
        "  second symbol kind did not break it. That is the measurement DECISIONS.md said had to",
        "  exist before building anything, and it passed. Still synthetic: no scanner noise, no",
        "  xrefs, no overlapping symbols, one sheet at a time.",
      );
    } else {
      lines.push(
        `  CONTROL HELD (${clean.correct}/${clean.cases}). Cluttered: ${dirty.correct} correct,`,
        `  ${dirty.declined} DECLINED, 0 overclaimed. The model got more CAUTIOUS rather than wrong —`,
        "  it stopped answering instead of answering badly, which is the behaviour this schema was",
        "  shaped to make easy and the one outcome a feature can live with. But a decline is a",
        "  sheet an estimator counts by hand, so the per-case lines decide whether it is useful",
        "  often enough to be worth building.",
      );
    }
    lines.push(
      "",
      "BOUNDED EVEN ON THE CLUTTERED ARM: digitally generated geometry, one sheet at a time,",
      "no scanner noise, no xrefs, no overlapping symbols. A pass is a FLOOR. A failure is",
      "much stronger evidence, because it is a failure in a world built to be easier than a",
      "real drawing set.",
      "",
    );
    console.log(lines.join("\n"));
  });
});
