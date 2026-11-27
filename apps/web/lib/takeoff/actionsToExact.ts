/**
 * ── ACTIONS TO EXACT (Walls v1.0 Finish Plan criterion 3; prereg-scoreboard-v3.md) ──
 *
 * The fewest moves an estimator needs to turn one sheet's draft into its answer
 * key, counted GREEDILY (so an upper bound on the true minimum, the same bound for
 * every arm):
 *
 *   ACTIONS = B + X + E + J + L + R + M + H
 *
 *   B  boxes (WORK_AREA, keep-inside — the product offers it on every sheet)
 *   X  erase boxes ("Erase walls in this area", W2; erase-area-tool.md P6), after the work area
 *   E  "Exclude like this" clicks (Diego, 2026-11-26: one action per click)
 *   J  posted junk runs still standing after boxes and clicks (one remove each)
 *   L  REAL runs a box, an erase box or a click set aside (one restore each — "charged as losses")
 *   R  runs the product HELD that are real (one restore each)
 *   M  key walls nothing posted or held covers (one add each)
 *   H  one answer per wall type whose height the KEY knows, when a posted real run
 *      of that type is off by more than 0.25 ft
 *
 * Pure: the caller supplies the geometry verdicts (junk, held, coverage) and the
 * product's own box and like-class functions, so this file decides only the
 * COUNTING, and its tests can pin every term. A move counts only once the product
 * ships it — a new move enters here in the same PR that ships it.
 */

export type ActionsInput = {
  /** One entry per offered run. */
  runs: readonly { lengthFeet: number; held: boolean; junk: boolean; heightFeet: number; keyIndex: number }[];
  /** One entry per key wall. */
  key: readonly { missed: boolean; type: string; knownFeet: number | null }[];
  /** Candidate box sets, fewest boxes first (k = 1..3); each maps run index -> inside feet. */
  boxOptions: readonly { boxes: number; insideFeet: ReadonlyMap<number, number> }[];
  /**
   * Candidate erase-box sets, fewest boxes first; each is the run indices the product's `eraseInBoxes` takes (whole runs).
   * Absent or empty: the move is OFF, and every count is v3's.
   */
  eraseOptions?: readonly { boxes: number; erased: ReadonlySet<number> }[];
  /** Like-classes: for each class, the run indices one click would set aside. */
  likeClasses: (standing: readonly boolean[]) => readonly (readonly number[])[];
};

export type ActionsResult = { actions: number; B: number; X: number; E: number; J: number; L: number; R: number; M: number; H: number; chosenBoxes: number };

const HEIGHT_TOLERANCE_FEET = 0.25;

export function actionsToExact(input: ActionsInput): ActionsResult {
  const { runs, key } = input;
  const postedJunk = runs.map((r) => !r.held && r.junk);
  const postedReal = runs.map((r) => !r.held && !r.junk);

  // R, M, H do not depend on boxes or clicks.
  const R = runs.filter((r) => r.held && !r.junk).length;
  const M = key.filter((k) => k.missed).length;
  const offTypes = new Set<string>();
  runs.forEach((r, i) => {
    if (!postedReal[i] || r.keyIndex < 0) return;
    const k = key[r.keyIndex];
    if (k === undefined || k.knownFeet === null) return;
    if (k.type === "" || k.type === "0" || k.type === "U") return;
    if (Math.abs(r.heightFeet - k.knownFeet) > HEIGHT_TOLERANCE_FEET) offTypes.add(k.type);
  });
  const H = offTypes.size;

  // BOXES: k = 0 is "remove every posted junk run by hand"; take the option with
  // the fewest box-stage actions; ties keep fewer boxes.
  let B = 0, boxJunkLeft = postedJunk.filter(Boolean).length, boxLost = 0;
  let kept: boolean[] = runs.map(() => true);
  for (const opt of input.boxOptions) {
    const keptAt = runs.map((r, i) => (opt.insideFeet.get(i) ?? 0) >= 0.5 * r.lengthFeet);
    const jLeft = runs.filter((_, i) => postedJunk[i] && keptAt[i]).length;
    const lost = runs.filter((_, i) => postedReal[i] && !keptAt[i]).length;
    if (opt.boxes + jLeft + lost < B + boxJunkLeft + boxLost) {
      B = opt.boxes; boxJunkLeft = jLeft; boxLost = lost; kept = keptAt;
    }
  }

  // ERASE BOXES: on what the work area kept (the product's order); the option with the fewest erase-stage actions,
  // a real run erased being a loss; ties keep fewer boxes (options come fewest first, and only a strict gain moves).
  let X = 0, eraseJunkLeft = boxJunkLeft, eraseLost = 0;
  let erased: ReadonlySet<number> = new Set<number>();
  for (const opt of input.eraseOptions ?? []) {
    const jLeft = runs.filter((_, i) => postedJunk[i] && kept[i] && !opt.erased.has(i)).length;
    const lost = runs.filter((_, i) => postedReal[i] && kept[i] && opt.erased.has(i)).length;
    if (opt.boxes + jLeft + lost < X + eraseJunkLeft + eraseLost) {
      X = opt.boxes; eraseJunkLeft = jLeft; eraseLost = lost; erased = opt.erased;
    }
  }

  // CLICKS: greedy over like-classes on what still stands after the boxes.
  const standing = runs.map((r, i) => !r.held && kept[i]! && !erased.has(i));
  const classes = input.likeClasses(standing);
  const gone = new Set<number>();
  let E = 0, junkGone = 0, realLost = 0;
  for (;;) {
    let best = -1, bestGain = 0, bestJ = 0, bestR = 0;
    classes.forEach((members, ci) => {
      const live = members.filter((i) => standing[i] && !gone.has(i));
      const j = live.filter((i) => runs[i]!.junk).length;
      const rl = live.length - j;
      const gain = j - rl - 1;
      if (gain > bestGain) { bestGain = gain; best = ci; bestJ = j; bestR = rl; }
    });
    if (best < 0) break;
    classes[best]!.forEach((i) => gone.add(i));
    E += 1; junkGone += bestJ; realLost += bestR;
  }

  const J = eraseJunkLeft - junkGone;
  const L = boxLost + eraseLost + realLost;
  return { actions: B + X + E + J + L + R + M + H, B, X, E, J, L, R, M, H, chosenBoxes: B };
}
