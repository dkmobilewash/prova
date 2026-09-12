import { describe, expect, it } from "vitest";
import { streamToolConversation } from "@prova/integrations";
import { SYSTEM_PROMPT, offeredTools } from "../answer";
import { accessContext } from "../access";
import { isCommandName } from "../commands";
import { EVAL_CASES, type EvalCase } from "./cases";

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
 * Per-item verdicts, then a count: the last test requires exactly as many
 * verdicts as cases, because a case that never ran must fail rather than
 * vanish from the total (CLAUDE.md, "absence of a failure is not a pass").
 */
if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  throw new Error("ANTHROPIC_API_KEY is not set: the routing eval did not run. It is not a pass.");
}

type Call = { name: string; input: Record<string, unknown> };
type Verdict = { id: string; pass: boolean; note: string };

async function firstRound(c: EvalCase): Promise<Call[]> {
  const calls: Call[] = [];
  const events = streamToolConversation<{ stop: true }>({
    system: SYSTEM_PROMPT,
    context: accessContext(c.principal),
    question: c.question,
    tools: offeredTools(c.principal),
    execute: async (name, input) => {
      calls.push({ name, input: (input ?? {}) as Record<string, unknown> });
      return { content: "recorded by the eval", halt: { stop: true } };
    },
    maxPasses: 1,
  });
  for await (const event of events) {
    if (event.type === "error" && event.reason === "api") throw new Error(`Anthropic API error on case ${c.id}`);
  }
  return calls;
}

function inputMatches(expected: Record<string, string> | undefined, actual: Record<string, unknown>): string | null {
  for (const [key, wanted] of Object.entries(expected ?? {})) {
    const value = actual[key];
    if (typeof value !== "string" || !value.toLowerCase().includes(wanted.toLowerCase())) {
      return `${key}: wanted something containing "${wanted}", got ${JSON.stringify(value)}`;
    }
  }
  return null;
}

function grade(c: EvalCase, calls: Call[]): Verdict {
  const names = calls.map((call) => call.name);
  const commands = names.filter(isCommandName);
  const describe = `round called [${names.join(", ") || "nothing"}]`;
  const expected = c.expect;
  switch (expected.kind) {
    case "tool": {
      const wanted = expected.name;
      const hit = calls.find((call) => call.name === wanted);
      if (!hit) return { id: c.id, pass: false, note: `${describe}; expected tool ${wanted}` };
      if (commands.length) return { id: c.id, pass: false, note: `${describe}; a command was called on a read question` };
      const mismatch = inputMatches(expected.input, hit.input);
      return mismatch ? { id: c.id, pass: false, note: `${describe}; ${mismatch}` } : { id: c.id, pass: true, note: describe };
    }
    case "command": {
      const wanted = expected.name;
      if (commands.length !== 1 || commands[0] !== wanted) {
        return { id: c.id, pass: false, note: `${describe}; expected exactly one command, ${wanted}` };
      }
      const hit = calls.find((call) => call.name === wanted);
      const mismatch = hit ? inputMatches(expected.input, hit.input) : "the command was not called";
      return mismatch ? { id: c.id, pass: false, note: `${describe}; ${mismatch}` } : { id: c.id, pass: true, note: describe };
    }
    case "no_command":
      return commands.length
        ? { id: c.id, pass: false, note: `${describe}; a card would have been shown` }
        : { id: c.id, pass: true, note: describe };
  }
}

const verdicts: Verdict[] = [];

describe("routing", () => {
  for (const c of EVAL_CASES) {
    it(`${c.id}: ${c.question}`, async () => {
      const verdict = grade(c, await firstRound(c));
      verdicts.push(verdict);
      expect(verdict.pass, verdict.note).toBe(true);
    });
  }

  it("returned one verdict per case", () => {
    const passed = verdicts.filter((v) => v.pass).length;
    console.log(`\nrouting eval: ${passed}/${verdicts.length} passed of ${EVAL_CASES.length} cases`);
    for (const v of verdicts) console.log(`${v.pass ? "PASS" : "FAIL"}  ${v.id}  ${v.note}`);
    expect(verdicts).toHaveLength(EVAL_CASES.length);
  });
});
