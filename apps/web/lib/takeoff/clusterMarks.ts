/**
 * HOW A THICKNESS GROUP IS MARKED, in the panel and on the drawing.
 *
 * ── A PLAIN MODULE, BECAUSE A `"use client"` EXPORT IS NOT A VALUE ──
 *
 * This lived in `TakeoffPlanViewer.tsx` and was pulled out the moment a test
 * imported it: `lib/client-boundary.test.ts` fails the build when a non-component
 * value is imported from a `"use client"` module, because across the RSC
 * boundary that arrives as a client-reference PROXY rather than the number or
 * the function. The guard's own message says to move it into a plain module and
 * import it from both sides, so that is what this is. `ClusterMark` and
 * `FoundWalls` stay components in the viewer, which is the allowed shape.
 */

/**
 * One colour per group, so the panel and the drawing refer to each other.
 *
 * Six, because a real sheet returns 15-21 thickness clusters and the panel
 * shows the biggest few — a palette per cluster would be unreadable, and these
 * are distinguishable against both a white drawing and each other. They are
 * deliberately not `DESIGN.md` status colours: these mean "group 2", not
 * "warning".
 */
export const CLUSTER_COLOURS = ["#38bdf8", "#f472b6", "#a78bfa", "#34d399", "#fbbf24", "#fb923c"];

/**
 * The dash a group is drawn with, so a COLOUR is not the whole mark.
 *
 * ── SIX COLOURS WERE LABELLING NINETEEN GROUPS, AND FOUR OF THEM WERE BLUE ──
 *
 * A West Herr floor plan clicked on production 2026-10-13 returned 19 groups.
 * `index % 6` put groups 0, 6, 12 and 18 in the same `#38bdf8`, so a blue line
 * on the drawing stood for any of four different thicknesses — and the panel
 * listed only the first twelve, which is the other half of the same defect and
 * is fixed at the call site: nothing is drawn that has no row beside it.
 *
 * A mark is now a colour AND a dash, so six colours times three dashes gives
 * EIGHTEEN distinct marks. The first twelve — `SHOWN_AT_FIRST`, the panel's
 * default — are therefore all distinct, which is the number that had to be true
 * and was not.
 *
 * ── AND IT STILL RUNS OUT, WHICH THIS SAYS RATHER THAN HIDES ──
 *
 * Eighteen is not nineteen. A finite palette cannot label an arbitrary number of
 * groups, and claiming otherwise is the failure the template filter's own
 * message was corrected for on the same day: a nineteenth group repeats the
 * first, and the panel says so once the list is expanded past the marks. Hover
 * is the discriminator past that point — it thickens one group 2.5x and fades
 * the rest to a quarter, which no palette can compete with.
 *
 * The dashes are ordered coarse-to-fine so the biggest groups get the most
 * legible mark, since `wallGroups` orders by footage.
 */
export const CLUSTER_DASHES = [3, 7, 1] as const;

/**
 * How many groups get a mark of their own. Past this, marks repeat — and the
 * panel is required to say so, which `takeoffWallFinder.test.tsx` pins.
 */
export const DISTINCT_MARKS = CLUSTER_COLOURS.length * CLUSTER_DASHES.length;

/**
 * How many groups the panel opens with.
 *
 * ONE AND A HALF TIMES THE PALETTE, AND INSIDE `DISTINCT_MARKS`, which is the
 * relationship that matters: twelve is under eighteen, so every row the panel
 * shows by default has a mark of its own. It used to be twice a six-colour
 * palette, which meant rows 1 and 7 were the same blue on the first screen.
 *
 * Twelve is a starting point and not a ceiling: everything past it is one press
 * away, which is the part that matters. The version before that was a hard cut
 * at eight with a SENTENCE after it, and a real sheet put 488 ft behind that
 * sentence.
 */
export const SHOWN_AT_FIRST = 12;

/**
 * How one group is drawn, in the panel and on the drawing.
 *
 * PURE, because the alternative is a decision inside JSX, which is a decision
 * no test can reach — the same reason `FoundWalls` and `ClusterTag` are
 * components rather than inline markup. The collision this fixes is arithmetic,
 * and arithmetic is testable at every index rather than at the two a render
 * test can be bothered to set up.
 *
 * `strokePx` scales the dash: the overlay works in page-width units and the
 * panel's swatch is 16 CSS pixels, so the dash RATIOS must agree and the
 * absolute lengths cannot. A dash scaled for the drawing is one solid blob at
 * swatch size.
 */
export function markFor(index: number, strokePx: number): { stroke: string; dash: string } {
  const stroke = CLUSTER_COLOURS[index % CLUSTER_COLOURS.length];
  // The dash changes only once the palette has been all the way round, so the
  // first six groups keep the mark they have always had.
  const on = CLUSTER_DASHES[Math.floor(index / CLUSTER_COLOURS.length) % CLUSTER_DASHES.length];
  return { stroke, dash: `${strokePx * on} ${strokePx * 2}` };
}
