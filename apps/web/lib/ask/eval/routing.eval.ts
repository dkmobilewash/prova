import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "./cases";
import { firstRound, firstRoundWebSearch, grade, reportVerdicts, requireApiKey, type Verdict } from "./harness";

/**
 * The routing eval, against the real model. `pnpm ask:eval` from
 * apps/web with ANTHROPIC_API_KEY set; never part of CI.
 *
 * Each case sends the model exactly what the route sends — the same
 * system prompt, the same access context, the same offered tools for that
 * principal — and records the FIRST round of tool calls. Every executor
 * call answers with a halt, so no second pass runs and no database is
 * touched: one model call per case, cached prompt, which is what makes
 * this cheap enough to run before every prompt or model change.
 *
 * The harness moved to `harness.ts` when the hundred questions
 * (`top-questions.eval.ts`) needed the same grader. Two copies of a grader
 * is how two evals end up disagreeing about what a pass is.
 *
 * Per-item verdicts, then a count: the last test requires exactly as many
 * verdicts as cases, because a case that never ran must fail rather than
 * vanish from the total (CLAUDE.md, "absence of a failure is not a pass").
 */
requireApiKey();

const verdicts: Verdict[] = [];

describe("routing", () => {
  for (const c of EVAL_CASES) {
    it(`${c.id}: ${c.question}`, async () => {
      // The two web-search kinds need the tool OFFERED, which the ordinary
      // round does not do — every other case must keep costing exactly
      // what it costs today, so this is opt-in per case rather than a
      // shared default. See firstRoundWebSearch's own comment.
      const usesWebSearch = c.expect.kind === "web_search" || c.expect.kind === "no_web_search";
      let verdict: Verdict;
      if (usesWebSearch) {
        const { calls, webSearches } = await firstRoundWebSearch(c);
        verdict = grade(c, calls, webSearches);
      } else {
        verdict = grade(c, await firstRound(c));
      }
      verdicts.push(verdict);
      expect(verdict.pass, verdict.note).toBe(true);
    });
  }

  it("returned one verdict per case", () => {
    reportVerdicts("routing eval", verdicts, EVAL_CASES.length);
    expect(verdicts).toHaveLength(EVAL_CASES.length);
  });
});
