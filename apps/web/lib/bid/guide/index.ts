import { loadJobGuideFacts, loadOpenJobGuideFacts, type JobGuideFacts } from "./facts";
import { buildJobGuide, guideDueMs } from "./buildJobGuide";
import type { JobGuide } from "./types";

/**
 * THE GUIDE, LOADED AND BUILT — what the Bid screens call.
 *
 * `getJobGuide` is one job's guide, or null when the job is not this company's
 * (or has left the estimate stage), so the page can 404. `getOpenJobGuides` is
 * the home list, already in the order a person should read it.
 *
 * To offer a past price (`usePastPrice`), a caller sets
 * `facts.pastPriceSuggestions` between load and build; use
 * `buildGuidesFromFacts` for that. Nothing is stored: every call recomputes.
 */
export { buildJobGuide } from "./buildJobGuide";
export type { JobGuideFacts } from "./facts";
export * from "./types";

export async function getJobGuide(companyId: string, jobId: string, now: Date = new Date()): Promise<JobGuide | null> {
  const facts = await loadJobGuideFacts(companyId, jobId);
  return facts ? buildJobGuide(facts, now) : null;
}

export async function getOpenJobGuides(companyId: string, now: Date = new Date()): Promise<JobGuide[]> {
  return buildGuidesFromFacts(await loadOpenJobGuideFacts(companyId), now);
}

/**
 * Build and order a set of facts. Urgency order:
 *   1. an ask is present and it is not "ready" — soonest due first, no due date last;
 *   2. ready to send — soonest due first;
 *   3. no ask (sent, working) — soonest due first, then by name.
 * Ties fall back to the job's name so the order is stable between reads.
 */
export function buildGuidesFromFacts(factsList: JobGuideFacts[], now: Date): JobGuide[] {
  const rows = factsList.map((facts) => ({ guide: buildJobGuide(facts, now), due: guideDueMs(facts) }));
  const group = (guide: JobGuide): number => (guide.ask === null ? 2 : guide.tone === "ready" ? 1 : 0);
  rows.sort(
    (a, b) =>
      group(a.guide) - group(b.guide) ||
      (a.due ?? Infinity) - (b.due ?? Infinity) ||
      a.guide.name.localeCompare(b.guide.name),
  );
  return rows.map((row) => row.guide);
}
