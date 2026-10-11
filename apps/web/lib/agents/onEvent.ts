import { after } from "next/server";
import "./all";
import type { StartRun } from "./core";
import { runAgent } from "./run";

/**
 * Runs an agent once the response has gone out — the on-event trigger
 * ("a bid was logged", "a bid was marked submitted"). `after()` keeps the
 * function alive for the work; a bare `void` would not (floatingPromiseCensus).
 *
 * Outside a request — a database test, a script — `after()` throws, and
 * there is nothing to outlive, so nothing runs: an event agent is a
 * courtesy to the person who just pressed a button, not a job queue.
 * runAgent applies the company switch, the per-agent switch and the cap.
 */
export function runAgentAfterResponse(input: Omit<StartRun, "trigger">): void {
  try {
    after(() =>
      runAgent({ ...input, trigger: "event" }).catch((error) => {
        console.error("[agents] event run failed", { agent: input.agent, companyId: input.companyId }, error);
      }),
    );
  } catch {
    // Not in a request scope. See above.
  }
}
