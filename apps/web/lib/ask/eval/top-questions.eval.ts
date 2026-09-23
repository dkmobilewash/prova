import { describe, expect, it } from "vitest";
import { TOP_QUESTIONS, topQuestionCases } from "./top-questions";
import { firstRound, grade, reportVerdicts, requireApiKey, type Verdict } from "./harness";

/**
 * The hundred questions, against the real model.
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @prova/web ask:eval
 *
 * `top-questions.test.ts` answers "is there a capability behind each of
 * these", in CI, on every push. This answers the other half — "does the
 * model FIND it" — and it costs a hundred model calls, so it is run by
 * hand before a prompt or model change like every other eval here.
 *
 * WHAT A PASS MEANS HERE, since a hundred green ticks is exactly the kind
 * of number that gets quoted without its caveats:
 *
 *   - a `tool` or `command` question passes when the first round calls
 *     that one thing. The full grader in harness.ts;
 *   - a `several` question passes when the round calls AT LEAST ONE of its
 *     tools and no command. The composing loop may reach the rest on a
 *     later pass and this eval watches one round, so requiring all of them
 *     would fail correct behaviour;
 *   - a `gap` question passes when no CARD is produced. That is the whole
 *     of what is graded, and it is not the whole of what matters: whether
 *     the model says "I can't see that" or quietly answers off the nearest
 *     tool is the real risk in a gap, and reading that needs the answer
 *     text rather than the tool calls. Not measured. Not pretended.
 */
requireApiKey();

const CASES = topQuestionCases();
const SEVERAL = new Map(
  TOP_QUESTIONS.flatMap((q) => (q.route.kind === "several" ? [[q.id, q.route.names] as const] : [])),
);

const verdicts: Verdict[] = [];

describe("the hundred questions", () => {
  for (const c of CASES) {
    it(`${c.id}: ${c.question}`, async () => {
      const calls = await firstRound(c);
      const wanted = SEVERAL.get(c.id);
      const verdict = wanted
        ? {
            id: c.id,
            pass: calls.some((call) => wanted.includes(call.name as (typeof wanted)[number])),
            note: `round called [${calls.map((call) => call.name).join(", ") || "nothing"}]; wanted any of ${wanted.join(", ")}`,
          }
        : grade(c, calls);
      verdicts.push(verdict);
      expect(verdict.pass, verdict.note).toBe(true);
    });
  }

  it("returned one verdict per question", () => {
    // The count, not the failures. A question whose request died produces
    // no verdict at all, and a tally that only counts failures reports
    // that as clean — CLAUDE.md, the review that came back "0 confirmed,
    // 10 refuted" when every verifier had died before writing one.
    reportVerdicts("top-100 eval", verdicts, CASES.length);
    expect(verdicts).toHaveLength(CASES.length);
  });
});
