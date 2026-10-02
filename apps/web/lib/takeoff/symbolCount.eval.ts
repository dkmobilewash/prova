import { afterAll, describe as group, expect, it } from "vitest";
import { countSymbols, SYMBOL_COUNT_PROMPT_VERSION, type SymbolCount } from "@prova/integrations";
import { SYMBOL_CASES } from "./symbolCases";
import { effectiveDpi, synthesiseSheet } from "./syntheticSheet";
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
  arm: "ARCH_D" | "DETAIL";
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
      const arm = one.sheet.sheetSize;
      let result: SymbolCount | null = null;
      let graded: { grade: Verdict["grade"]; off: number | null } = { grade: "ERROR", off: null };

      try {
        result = await countSymbols({
          fileBase64: synthesiseSheet(one.sheet).toString("base64"),
          symbol: one.ask,
          looksLike: one.looksLike,
          model,
        });
        graded = grade(one.count, result);
      } catch (error) {
        // Recorded as ERROR and NOT as a decline. A call that never happened
        // tells you nothing about the model's judgement, and letting it read as
        // caution is the exact defect the verdict-count rule exists for.
        verdicts.push({
          id: one.id,
          arm,
          why: one.why,
          truth: one.count,
          result: null,
          grade: "ERROR",
          off: null,
        });
        throw error;
      }

      verdicts.push({ id: one.id, arm, why: one.why, truth: one.count, result, grade: graded.grade, off: graded.off });

      // THE ONLY FATAL ASSERTION. Everything else is measured and reported; a
      // confident wrong count is the thing that must never ship.
      expect(
        graded.grade,
        `${one.id}: reported ${result.count} with confidence ${result.confidence} when the truth is ${one.count}. ` +
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

    for (const arm of ["ARCH_D", "DETAIL"] as const) {
      const inArm = verdicts.filter((v) => v.arm === arm);
      const correct = inArm.filter((v) => v.grade === "CORRECT").length;
      const declined = inArm.filter((v) => v.grade === "DECLINED").length;
      const over = inArm.filter((v) => v.grade === "OVERCLAIMED").length;
      const errored = inArm.filter((v) => v.grade === "ERROR").length;
      lines.push(
        "",
        `${arm} (~${Math.round(effectiveDpi(arm))} DPI): ${inArm.length} cases`,
        `  correct     ${correct}`,
        `  declined    ${declined}   (honest, not a failure)`,
        `  OVERCLAIMED ${over}   <- the one that matters`,
        `  errored     ${errored}`,
      );
      for (const v of inArm) {
        const said = v.result
          ? v.result.countable
            ? `said ${v.result.count} (${v.result.confidence})`
            : `declined (${v.result.confidence})`
          : "no result";
        lines.push(`    ${v.grade.padEnd(11)} ${v.id.padEnd(22)} truth ${String(v.truth).padEnd(3)} ${said}`);
      }
    }

    // The interpretation, stated by the eval rather than left to a reader — the
    // whole reason the arms are paired.
    const archCorrect = verdicts.filter((v) => v.arm === "ARCH_D" && v.grade === "CORRECT").length;
    const detailCorrect = verdicts.filter((v) => v.arm === "DETAIL" && v.grade === "CORRECT").length;
    const archCases = verdicts.filter((v) => v.arm === "ARCH_D").length;
    const detailCases = verdicts.filter((v) => v.arm === "DETAIL").length;
    lines.push("", "WHAT THIS MEANS:");
    if (detailCases > 0 && detailCorrect === 0) {
      lines.push(
        "  The model could not count even at ~143 DPI on clean synthetic geometry.",
        "  That is the strong negative: it is not a resolution problem, and building a",
        "  rasteriser or a tiler would not fix it. The open question answers NO.",
      );
    } else if (archCases > 0 && archCorrect === 0 && detailCorrect > 0) {
      lines.push(
        "  The capability is there at ~143 DPI and absent at ~44 DPI. So drawing takeoff",
        "  is possible and REQUIRES TILING — cropping a sheet into regions, which needs a",
        "  rasterisation or CropBox path this app does not have (planPdf.ts: page.render()",
        "  fails server-side without a canvas). That is a project, not a feature.",
      );
    } else if (archCorrect === archCases && archCases > 0) {
      lines.push(
        "  Counted correctly even on a full ARCH D sheet. Surprising given the DPI, so",
        "  treat it as a floor on CLEAN SYNTHETIC geometry and re-ask with hatching,",
        "  dimension strings and overlapping notes before believing it of a real sheet.",
      );
    } else {
      lines.push(
        `  Mixed: ${archCorrect}/${archCases} on ARCH_D, ${detailCorrect}/${detailCases} on DETAIL.`,
        "  Read the per-case lines above — which SYMBOL failed matters more than the ratio,",
        "  and a symbol whose meaning is carried by text will never survive 44 DPI.",
      );
    }
    lines.push(
      "",
      "BOUNDED: clean, digitally generated geometry on an otherwise empty sheet. A pass",
      "is a FLOOR, not a forecast. A failure is much stronger evidence, because it is a",
      "failure in the easiest world that could be built for it.",
      "",
    );
    console.log(lines.join("\n"));
  });
});
