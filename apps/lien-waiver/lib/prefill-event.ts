import { sanitizeRef } from "./prefill";
import { HOUR, LIMITS, rateKey, underLimit, type RateStore } from "./rate-limit";
import { STATES } from "./statutes/types";

/**
 * POST /api/prefill-opened: one log line when a page is opened from a
 * pre-fill link that carries a `ref` -- the event Diego asked for,
 * "prefill_link_opened". It records the code and the state and NOTHING about
 * the person: no name, no company, no address, no IP (the rate limit keeps
 * only a salted hash, as everywhere else in this app).
 *
 * The line goes to the runtime log as JSON. On Vercel's Hobby plan runtime
 * logs are kept for an hour, so this is for watching a send go out; the
 * durable record of which link worked is the `ref` on the lead itself.
 */

export interface PrefillEventDeps {
  rate: { store: RateStore; salt: string } | null;
  ip: string;
  log?: (line: string) => void;
}

export async function handlePrefillEvent(body: { ref?: unknown; state?: unknown }, deps: PrefillEventDeps): Promise<number> {
  const ref = sanitizeRef(typeof body.ref === "string" ? body.ref : null);
  if (!ref) return 400;
  const state = STATES.find((code) => code === body.state) ?? null;
  if (deps.rate && !(await underLimit(deps.rate.store, rateKey("prefill", deps.ip, deps.rate.salt), LIMITS.prefillEventsPerIpPerHour, HOUR))) {
    return 429;
  }
  (deps.log ?? console.log)(JSON.stringify({ event: "prefill_link_opened", ref, state }));
  return 204;
}
