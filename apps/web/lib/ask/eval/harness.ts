import { streamToolConversation } from "@prova/integrations";
import { SYSTEM_PROMPT, offeredTools } from "../answer";
import { accessContext } from "../access";
import { isCommandName } from "../commands";
import type { EvalCase } from "./cases";

/**
 * The bit of the routing eval that is not the cases: send a question the
 * way the route sends it, record the first round of tool calls, grade it.
 *
 * Lifted out of `routing.eval.ts` unchanged when a SECOND eval needed it
 * (`top-questions.eval.ts`, the hundred). Two copies of a grader is how two
 * evals end up disagreeing about what a pass is, and the one that is wrong
 * is always the one nobody is looking at.
 *
 * NOT named `*.eval.ts`, so vitest's eval config does not try to run it as
 * a suite; it is a module both suites import.
 */

/** Every eval calls this FIRST, at module scope.
 *
 * A suite that needs a key it does not have must fail loudly rather than
 * skip, which is CLAUDE.md's "absence of a failure is not a pass" — a
 * green run of zero cases and a green run of forty look identical in a
 * terminal. `evalFilesDeclareTheirKey` in the unit suite checks that every
 * `.eval.ts` in this folder actually calls it, because the failure mode of
 * this guard is somebody writing a new eval without it. */
export function requireApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is not set: the eval did not run. It is not a pass.");
  }
}

export type Call = { name: string; input: Record<string, unknown> };
export type Verdict = { id: string; pass: boolean; note: string };

export async function firstRound(c: EvalCase): Promise<Call[]> {
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

/**
 * Like `firstRound`, offering Anthropic's server-side web search alongside
 * the app's own tools. A SEPARATE function rather than a flag on
 * `firstRound`: every other case in EVAL_CASES must keep costing exactly
 * what it costs today, so offering the search tool is opt-in per case
 * rather than something a shared default could quietly turn on everywhere.
 *
 * Nothing reaches `execute` for a server-side search — the model runs it
 * itself and the result comes back inside the SAME response — so what a
 * "web_search" case is graded on is `usage.webSearches`, read off the
 * `usage` event the loop yields once per question (packages/integrations/
 * src/ask.ts's `tally`, from `response.usage.server_tool_use.
 * web_search_requests`). A client tool call, if the model makes one
 * instead or as well, is still recorded in `calls` exactly as
 * `firstRound` records it.
 */
export async function firstRoundWebSearch(c: EvalCase): Promise<{ calls: Call[]; webSearches: number }> {
  const calls: Call[] = [];
  let webSearches = 0;
  const events = streamToolConversation<{ stop: true }>({
    system: SYSTEM_PROMPT,
    context: accessContext(c.principal),
    question: c.question,
    tools: offeredTools(c.principal),
    webSearch: true,
    execute: async (name, input) => {
      calls.push({ name, input: (input ?? {}) as Record<string, unknown> });
      return { content: "recorded by the eval", halt: { stop: true } };
    },
    maxPasses: 1,
  });
  for await (const event of events) {
    if (event.type === "error" && event.reason === "api") throw new Error(`Anthropic API error on case ${c.id}`);
    if (event.type === "usage") webSearches = event.usage.webSearches ?? 0;
  }
  return { calls, webSearches };
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

export function grade(c: EvalCase, calls: Call[], webSearches = 0): Verdict {
  const names = calls.map((call) => call.name);
  const commands = names.filter(isCommandName);
  const describe = `round called [${names.join(", ") || "nothing"}]`;
  const expected = c.expect;
  switch (expected.kind) {
    case "web_search":
      return webSearches > 0
        ? { id: c.id, pass: true, note: `${describe}; ${webSearches} web search(es)` }
        : { id: c.id, pass: false, note: `${describe}; expected a web search, none made` };
    case "no_web_search":
      return webSearches === 0
        ? { id: c.id, pass: true, note: describe }
        : { id: c.id, pass: false, note: `${describe}; expected no web search, made ${webSearches}` };
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

/**
 * Print the verdicts and require one per case.
 *
 * The count is the load-bearing half and it is here rather than written
 * out twice: a case whose agent died, or whose file threw before it ran,
 * produces NO verdict, and a tally that only counts failures reports that
 * as clean. CLAUDE.md, from a multi-agent review that came back "0
 * confirmed, 10 refuted" when every verifier had died.
 */
export function reportVerdicts(label: string, verdicts: Verdict[], expected: number): void {
  const passed = verdicts.filter((v) => v.pass).length;
  const missing = expected - verdicts.length;

  // THE SHORTFALL GOES FIRST, AND THIS LINE WAS WRITTEN AFTER IT BIT.
  //
  // A run that died on case 51 printed "50/50 passed of 100 cases", which
  // reads as a clean sweep and means half the suite never ran. The count
  // assertion below failed the run, so nothing was actually believed — but
  // the HEADLINE is what gets copied into a message, and that one said the
  // opposite of what happened. (The cause was an Anthropic credit balance
  // at zero: every case from 51 on returned 400 invalid_request_error, and
  // the eval cannot tell that apart from a rate limit or a bad schema,
  // because the ask loop deliberately never yields the API's message.)
  //
  // So a shortfall is announced before any ratio is printed, and the ratio
  // itself names the denominator it is out of. CLAUDE.md: absence of a
  // failure is not a pass, and a missing verdict is its own failure state.
  if (missing > 0) {
    console.log(
      `\n${label}: DID NOT RUN — ${missing} of ${expected} cases returned no verdict at all. ` +
        `The ${passed} that passed are ${passed} of ${verdicts.length} that ran, NOT of ${expected}. ` +
        `Read this as a broken run, not as a result.`,
    );
  } else {
    console.log(`\n${label}: ${passed}/${expected} passed`);
  }
  for (const v of verdicts) console.log(`${v.pass ? "PASS" : "FAIL"}  ${v.id}  ${v.note}`);
}
