import type { StrokeSegment } from "./wallVectors";

/**
 * ── WHAT THE DRAFTER CALLED THIS LINE ──
 *
 * Every other filter in the wall finder measures the GEOMETRY of a stroke. This
 * one reads its NAME, and that is the whole reason it exists: the failures left
 * on a real plan set are not geometry failures.
 *
 * Reported from a dealership bid set, 2026-10-14, with pictures: the letters of
 * the architect's logo in the title block came back as walls, and so did the
 * cars on the parking plan. Both are the pairer answering correctly. An "S" IS
 * two parallel strokes a wall-thickness apart. A car body IS two parallel lines
 * eight inches apart. No amount of better measurement separates them from a
 * partition, because the difference is not in the measurement.
 *
 * It is in the file already. A CAD export made with layer information wraps
 * every stroke in an optional-content group named after the layer: `A-WALL`,
 * `S-GRID`, `A-FURN`, `G-ANNO-TTLB`. The logo is on the title-block layer and
 * the cars are on a furniture layer, and they have been all along.
 *
 * ── THE NAMES ARE A STANDARD, WHICH IS WHY THIS IS NOT GUESSWORK ──
 *
 * The US National CAD Standard / AIA layer format is
 * `<discipline>-<major>-<minor>-<status>` — `A-WALL-FULL-NEWW`,
 * `A-ANNO-DIMS`, `M-DUCT`. The MAJOR group is a controlled four-letter
 * vocabulary, and it is the part worth reading. Everything here matches on
 * TOKENS rather than on whole names, so `A-WALL`, `A-WALL-FULL` and
 * `ARCH-WALL-NEW` all land the same way and a house style with extra segments
 * does not defeat it.
 *
 * ── THREE RULES MAKE THIS SAFE INSTEAD OF CLEVER ──
 *
 * 1. **UNKNOWN IS KEPT.** `sheetTemplate.ts` states the doctrine for this
 *    whole directory — *"cannot tell" must not mean "drop it"* — and the
 *    asymmetry is the reason: a phantom wall is visible on screen and a person
 *    rejects it in a second, while a missing wall is invisible and reaches a
 *    bid. So a layer called `0`, `Layer1` or `MYSTERY` keeps everything it
 *    carries.
 * 2. **A SHEET WITH NO LAYERS IS UNTOUCHED.** A flattened plot gives every
 *    segment `layer: undefined`, which is `unknown`, which is kept. The output
 *    is byte-identical to the day before this file existed.
 * 3. **NOTHING IS DROPPED SILENTLY.** `withoutNonWallLayers` returns what it
 *    removed and from where, and the panel says it in the estimator's own
 *    words. A filter that quietly shrinks a number is how somebody stops
 *    trusting the number.
 */

/**
 * What a layer name says about whether its strokes can be walls.
 *
 * `out-of-scope` is SEPARATE from `not-wall` on purpose. A demolition layer
 * holds real walls that are really there and really must not be priced — the
 * estimator needs to be told a different sentence about it, and lumping it in
 * with furniture would hide the one of the two they might want to argue with.
 */
export type LayerVerdict = "wall" | "not-wall" | "out-of-scope" | "unknown";

/**
 * NCS major groups that are never a wall face.
 *
 * Each of these is on this list because something on a real or bench sheet was
 * measured as a wall and should not have been. Grouped by what they cost:
 *
 *   annotation      the title-block logo, room tags, dimension strings, the
 *                   revision cloud. `G-ANNO-TTLB` is the logo from the report
 *                   that started this.
 *   grids           a column gridline parallel to a wall is the single most
 *                   common cause of MISSED footage in the holdout — it trips
 *                   `inAHatchSeries`, which vetoes the real pair beside it.
 *   services        ducts, diffusers, pipe, light fittings. Two parallel lines
 *                   at a plausible thickness, on every mechanical sheet.
 *   furnishing      the cars, the casework, the plumbing fixtures.
 *   site            parking, roads, planting, the vicinity map.
 *   non-printing    `DEFPOINTS` and `*-NPLT` are not drawn on paper at all.
 */
const NOT_WALL = new Set([
  // annotation
  "ANNO", "DIMS", "DIM", "TEXT", "TXT", "NOTE", "NOTES", "KEYN", "IDEN", "SYMB",
  "TTLB", "TITLE", "TITLEBLOCK", "BORDER", "LOGO", "REVS", "REVC", "LEGN", "NPLT",
  "DEFPOINTS", "TAGS", "HATCH",
  // grids and reference
  "GRID", "GRDS", "CLNG",
  // services
  "DUCT", "DIFF", "HVAC", "PIPE", "PLUM", "FIXT", "LITE", "POWR", "ELEC", "EQPM",
  "SPKL", "FIRE", "COMM", "DATA",
  // furnishing
  "FURN", "CASE", "APPL", "SPEC",
  // site
  "PKNG", "ROAD", "SITE", "TREE", "PLNT", "TOPO", "VEHC", "MAP", "CARS",
]);

/**
 * Status tokens meaning "drawn, and not in this contract".
 *
 * This is the half that answers the third thing the dealership report asked
 * for — *"it says existing space so those would not need to be accounted
 * for"*. The drawing says it in words on the sheet AND in the layer name, and
 * the layer name is the one that needs no reading comprehension.
 */
const OUT_OF_SCOPE = new Set([
  "EXST", "EXIST", "EXISTING", "EXG", "DEMO", "DEMD", "DEMOLITION", "NIC", "NICN",
]);

/**
 * Majors that positively name a wall.
 *
 * NARROW ON PURPOSE. This set does not gate anything — `unknown` is kept, so a
 * wall layer this fails to recognise loses nothing. Its only job is to let the
 * panel say "the drawing names these as walls", so a wrong entry here would be
 * a false claim rather than a lost wall, which is the opposite trade from the
 * list above.
 */
const WALL = new Set(["WALL", "WALLS", "PRTN", "PARTITION", "STUD", "CMU"]);

/**
 * Tokens deliberately in NONE of the three sets, with the reason.
 *
 * Each of these is a judgement somebody will be tempted to make, and each one
 * is a separate measurement rather than a guess made now:
 *
 *   PATT   a wall's own hatch (`A-WALL-PATT`). Dropping it would help the
 *          series test — hatch strokes beside a wall are exactly what trips it
 *          — but in a fill-only Revit export the pattern can be the ONLY
 *          geometry a wall has, and dropping it would delete the wall.
 *   GLAZ   a storefront is a wall to some subs and not to others. The company's
 *          own wall types answer this, not a layer name.
 *   DOOR   a door is an opening IN a wall, and `openings.ts` already has an
 *          opinion about those.
 *   COLS   a column is real and structural and not a run of wall. It is already
 *          handled geometrically.
 *   SLAB / JOIS / BEAM  structure under or over the plan. Mostly filtered by
 *          the building test already; needs measuring before being asserted.
 */
const DELIBERATELY_UNDECIDED = ["PATT", "GLAZ", "DOOR", "COLS", "SLAB", "JOIS", "BEAM"];

/** Exported so a test can assert the list is REASONED rather than just absent —
 *  the difference between "we decided not to" and "nobody thought of it". */
export const UNDECIDED_TOKENS: readonly string[] = DELIBERATELY_UNDECIDED;

/**
 * Splits a layer name into comparable tokens.
 *
 * Real names arrive as `A-WALL-FULL`, `A_WALL_FULL`, `A-Wall`, `ARCH|WALL`, and
 * Revit writes `A-WALL [Walls]`. Anything that is not a letter or a digit is a
 * separator, and digits are stripped from the end of a token so `WALL2` and
 * `GRID01` are not strangers.
 */
export function layerTokens(name: string): string[] {
  return name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((part) => part.replace(/[0-9]+$/, ""))
    .filter((part) => part.length > 0);
}

/**
 * What a layer name says, or `unknown` when it says nothing this understands.
 *
 * OUT-OF-SCOPE BEATS EVERYTHING, including `wall`: `A-WALL-DEMO` is a wall, and
 * it is a wall somebody is paying to remove rather than to build. Reading it as
 * a wall because `WALL` appears first would price the demolition as new work,
 * which is the single most expensive mistake available on this screen.
 */
export function layerVerdict(name: string | undefined): LayerVerdict {
  if (!name) return "unknown";
  const tokens = layerTokens(name);
  if (tokens.length === 0) return "unknown";
  if (tokens.some((t) => OUT_OF_SCOPE.has(t))) return "out-of-scope";
  if (tokens.some((t) => NOT_WALL.has(t))) return "not-wall";
  if (tokens.some((t) => WALL.has(t))) return "wall";
  return "unknown";
}

/** What was removed, so a panel can say it instead of a number quietly shrinking. */
export type LayerDrop = { layer: string; verdict: LayerVerdict; segments: number };

export type WithoutNonWallLayers = {
  kept: StrokeSegment[];
  /** Biggest first, so the sentence names the layer that mattered. */
  dropped: LayerDrop[];
};

/**
 * Drops the strokes on layers that are confidently not walls.
 *
 * ── IT CANNOT REMOVE A SHEET'S LAST WALL, AND THAT IS CHECKED HERE ──
 *
 * A guard rather than a belief. If a name list ever matched a layer that is in
 * fact carrying the building — a house style calling its partitions
 * `A-SITE-WALL`, a mis-tagged export — this would silently delete the whole
 * takeoff, and "no walls on this sheet" is a sentence the viewer already says
 * honestly for scans. Nobody would look at the layer names.
 *
 * So when the filter would drop EVERYTHING, it drops nothing and says so. The
 * fail-safe direction is the one `sheetTemplate.ts` states: the cost of not
 * filtering is a panel with some rubbish in it, which a person can see; the
 * cost of over-filtering is an empty screen that looks like an answer.
 */
export function withoutNonWallLayers(segments: readonly StrokeSegment[]): WithoutNonWallLayers {
  const counts = new Map<string, { verdict: LayerVerdict; n: number }>();
  const kept: StrokeSegment[] = [];

  for (const segment of segments) {
    const verdict = layerVerdict(segment.layer);
    if (verdict === "wall" || verdict === "unknown") {
      kept.push(segment);
      continue;
    }
    const name = segment.layer ?? "";
    const at = counts.get(name) ?? { verdict, n: 0 };
    at.n += 1;
    counts.set(name, at);
  }

  if (kept.length === 0 && segments.length > 0) {
    return { kept: [...segments], dropped: [] };
  }

  return {
    kept,
    dropped: [...counts.entries()]
      .map(([layer, v]) => ({ layer, verdict: v.verdict, segments: v.n }))
      .sort((a, b) => b.segments - a.segments),
  };
}

/**
 * The sentence the panel shows, or null when nothing was dropped.
 *
 * ── TWO KINDS OF DROP, TWO SENTENCES, BECAUSE ONE OF THEM IS ARGUABLE ──
 *
 * "Furniture and annotation" is a filter nobody will want to overturn.
 * "Existing and demolition" is a judgement about SCOPE, and a sub doing a
 * remodel may well be pricing exactly those walls. Reporting them together
 * would bury the one worth questioning inside the one that is obvious.
 *
 * No feet, only line counts. Feet would imply these were measured as walls and
 * then subtracted, which is not what happened — they never reached the pairer.
 */
export function droppedLayersSentence(dropped: readonly LayerDrop[]): string | null {
  if (dropped.length === 0) return null;
  const scope = dropped.filter((d) => d.verdict === "out-of-scope");
  const other = dropped.filter((d) => d.verdict !== "out-of-scope");
  const lines = (list: readonly LayerDrop[]) => list.reduce((sum, d) => sum + d.segments, 0);
  const names = (list: readonly LayerDrop[]) =>
    list
      .slice(0, 3)
      .map((d) => d.layer)
      .join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");

  const parts: string[] = [];
  if (other.length > 0) {
    parts.push(`${lines(other)} lines the drawing puts on other layers (${names(other)})`);
  }
  if (scope.length > 0) {
    parts.push(`${lines(scope)} on existing or demolition layers (${names(scope)})`);
  }
  return `Left out: ${parts.join("; and ")}.`;
}
