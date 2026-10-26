import { prisma } from "@prova/db";
import { loadJobGuideFacts, loadOpenJobGuideFacts, type JobGuideFacts, type PastPriceSuggestion } from "./facts";
import { loadPastPriceSuggestions } from "./pastPrice";
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
  if (!facts) return null;
  await attachPastPrices(companyId, [facts], now);
  return buildJobGuide(facts, now);
}

export async function getOpenJobGuides(companyId: string, now: Date = new Date()): Promise<JobGuide[]> {
  const factsList = await loadOpenJobGuideFacts(companyId);
  await attachPastPrices(companyId, factsList, now);
  return buildGuidesFromFacts(factsList, now);
}

/**
 * Offer "use the price from your last job" where it applies. Only jobs whose
 * one ask IS an unpriced wall type are looked up, so a home list of mostly
 * priced jobs costs no extra queries. The suggestion keeps the action's own
 * `actionArg` (with its staleness token), which the action re-derives and
 * compares server-side; nothing the client sends is trusted.
 */
async function attachPastPrices(companyId: string, factsList: JobGuideFacts[], now: Date): Promise<void> {
  const needing = factsList.filter((facts) => buildJobGuide(facts, now).ask?.id === "unpriced-wall-types");
  await Promise.all(
    needing.map(async (facts) => {
      const found = await loadPastPriceSuggestions(prisma, companyId, facts.jobId, now);
      facts.pastPriceSuggestions = found
        .filter((s) => s.wallTypeCode !== null)
        .map(
          (s): PastPriceSuggestion => ({
            wallTypeCode: s.wallTypeCode as string,
            label: s.label,
            fromJobName: s.fromJobName,
            whenLabel: `in ${s.whenLabel}`,
            actionArg: s.actionArg,
          }),
        );
    }),
  );
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
