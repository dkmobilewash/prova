/**
 * ── WHICH SHEET THE WORKSPACE OPENS ON ──
 *
 * It opened the first page of the set, which on a real bid is a cover sheet,
 * and the job stepper's Scale, Takeoff and Review all landed there (Diego,
 * Chrome's re-test). Now, from facts already loaded:
 *   - work:   the sheet last measured on, else the best-ranked sheet whose
 *             title is a plan, else the first sheet whose title does not say
 *             it is something else (cover, demolition, elevations…);
 *   - scale:  the first such sheet, in page order, with no scale yet;
 *   - review: the first sheet with a wall held "to confirm".
 * Each falls back to `work`, and `work` to the first page.
 */
export type StartFacts = {
  pageNumber: number;
  scaled: boolean;
  /** When this sheet was last measured on, ms, or null. */
  lastMeasuredAt: number | null;
  /** Walls held "to confirm" on it. */
  held: number;
  /** `takeoffRank(...).score` for its number and title: below 0 says it is something else. */
  score: number;
};

export function startPages(pages: readonly StartFacts[]): { work: number; scale: number; review: number } {
  const first = pages[0]?.pageNumber ?? 1;
  const worked = pages.filter((p) => p.lastMeasuredAt !== null).sort((a, b) => b.lastMeasuredAt! - a.lastMeasuredAt!)[0];
  const ok = pages.filter((p) => p.score >= 0);
  const plan = [...ok].sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber).find((p) => p.score > 0);
  const work = worked?.pageNumber ?? plan?.pageNumber ?? ok[0]?.pageNumber ?? first;
  const scale = ok.find((p) => !p.scaled)?.pageNumber ?? work;
  const review = pages.find((p) => p.held > 0)?.pageNumber ?? work;
  return { work, scale, review };
}
