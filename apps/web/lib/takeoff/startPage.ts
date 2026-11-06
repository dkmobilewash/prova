/**
 * ── WHICH SHEET THE WORKSPACE OPENS ON ──
 *
 * It opened the first page of the set, which on a real bid is a cover sheet,
 * and the job stepper's Scale, Takeoff and Review all landed there (Diego,
 * Chrome's re-test). Now, from facts already loaded:
 *   - work:   the sheet a person last measured on, else the first sheet the
 *             whole-set run counts as the floor plan of the work (`wallsPlan`:
 *             A101 over Baker's A100 OVERALL, never a ceiling plan), else the
 *             best-ranked sheet whose title is a plan, else the first sheet
 *             whose title does not say it is something else (cover,
 *             demolition, elevations…). New-customer run v2, M2: "Run the
 *             takeoff" opened A100, and before the scales A111 (the RCP);
 *   - scale:  the best of those floor plans with no scale yet, else the first
 *             such sheet, in page order, with no scale yet;
 *   - review: the first sheet with a wall held "to confirm".
 * Each falls back to `work`, and `work` to the first page.
 *
 * THE FLOOR PLANS ARE TAKEN BEST-RANKED FIRST, not in page order. E Street's
 * whole-set list includes A0.4 (a paving detail) ahead of A2.1 FLOOR PLAN, and
 * page order opened both work and Scale on the paving (Chrome's re-test). The
 * same `takeoffRank` score says A2.1 (95) over A0.4 (5).
 */
export type StartFacts = {
  pageNumber: number;
  scaled: boolean;
  /** When a PERSON last measured on this sheet, ms, or null. The walls the
   *  takeoff posts by itself land on every counted sheet, so they say nothing
   *  about where somebody was working. */
  lastMeasuredAt: number | null;
  /** Walls held "to confirm" on it. */
  held: number;
  /** `takeoffRank(...).score` for its number and title: below 0 says it is something else. */
  score: number;
};

export function startPages(pages: readonly StartFacts[], counted: readonly number[] = []): { work: number; scale: number; review: number } {
  const first = pages[0]?.pageNumber ?? 1;
  const worked = pages.filter((p) => p.lastMeasuredAt !== null).sort((a, b) => b.lastMeasuredAt! - a.lastMeasuredAt!)[0];
  const ok = pages.filter((p) => p.score >= 0);
  const plan = [...ok].sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber).find((p) => p.score > 0);
  const byPage = new Map(pages.map((p) => [p.pageNumber, p]));
  const floors = counted.map((n) => byPage.get(n) ?? { pageNumber: n, scaled: false, score: 0 }).sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber);
  const work = worked?.pageNumber ?? floors[0]?.pageNumber ?? plan?.pageNumber ?? ok[0]?.pageNumber ?? first;
  const scale = floors.find((p) => !p.scaled)?.pageNumber ?? ok.find((p) => !p.scaled)?.pageNumber ?? work;
  const review = pages.find((p) => p.held > 0)?.pageNumber ?? work;
  return { work, scale, review };
}
