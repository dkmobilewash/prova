/**
 * ── THE DOOR SCHEDULE'S WIDTH, PUT ON THE DOOR IT BELONGS TO ──
 *
 * An opening is found geometrically — a gap in a wall, measured by
 * `openingsInWalls` — and that gap is not the door. The schedule states the
 * door.
 *
 * ── AND THE GAP IS NARROWER THAN THE DOOR, NOT WIDER ──
 *
 * This file first said the opposite: that the gap is the ROUGH opening, so a
 * 3'-0" door measures 3'-2" or more once frame and shims are drawn. Measured
 * on Camp Bow Wow A101, every matched door says otherwise —
 *
 *     mark 102   drawn 2.59 ft   scheduled 3.00 ft
 *     mark 103   drawn 2.23 ft   scheduled 3.00 ft
 *     mark 121   drawn 2.84 ft   scheduled 3.00 ft
 *
 * — a fifth to a quarter NARROW, consistently. Whatever `openingsInWalls`
 * measures between, it is inside the door's own width, so the drawn gap
 * UNDER-deducts. Taking the schedule's width therefore makes the deduction
 * bigger and the board quantity smaller, which is the direction that costs
 * money if it is wrong, and is the reason the schedule is the better witness
 * rather than merely the tidier one.
 *
 * So this joins the two: a mark beside an opening on the plan, the same mark
 * in the schedule, and the schedule's width used for the deduction.
 *
 * ── GEOMETRY DECIDES WHICH `102` IS THE DOOR ──
 *
 * The join cannot be done on text alone and the reason is measured. Camp Bow
 * Wow A101 carries `101A`, `101B`, `102`, `103`, `104` — and so does its door
 * schedule on p26. But a floor plan numbers its ROOMS in the same series: door
 * 102 is the door to room 102, and both strings are printed on the sheet. A
 * text-only join would attach the schedule's door width to a room label in the
 * middle of a room.
 *
 * What separates them is where the text sits. A door mark is beside the gap it
 * labels; a room number is in open floor. So a mark is only taken as a door's
 * when it is within `MARK_REACH_FEET` of an opening, and the nearest mark
 * wins. That is the same shape `wallTags.ts` uses to attach a wall-type tag to
 * its run, and for the same reason.
 *
 * ── NO MATCH IS NOT AN ERROR ──
 *
 * The drawn gap is a real measurement and stays the answer when no schedule
 * row claims it. An opening with no mark near it, or a mark with no row, keeps
 * its geometric width and is reported as such. The alternative — dropping
 * unmatched openings — would silently stop deducting for doors the schedule
 * happens not to list, which is every door on a sheet whose schedule is on a
 * page nobody read.
 */

/** How far from an opening a mark may sit and still be that opening's, in feet. */
export const MARK_REACH_FEET = 6;

/**
 * How much wider the drawn gap may be than the scheduled door before it is
 * worth a second look, as a share of the scheduled width.
 *
 * A rough opening is legitimately bigger than its door — frame, shims,
 * clearance — so a gap a little wider is the normal case and not a finding.
 * Half as wide again is not a frame allowance; it is a different opening, or
 * a mark that landed on the wrong one.
 */
export const GAP_TOLERANCE = 0.5;

export type PlacedMark = {
  /** As printed — `101A`. Compared case-insensitively, never normalised. */
  text: string;
  /** Centre of the text, in page-width units. */
  x: number;
  y: number;
};

export type DrawnOpening = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  widthFeet: number;
};

export type ScheduledOpening = {
  mark: string;
  /** The width the schedule states, in feet. Null where it could not be read. */
  widthFt: number | null;
  heightFt: number | null;
  /** The row's own words, for the screen. */
  description: string | null;
};

export type JoinedOpening = {
  opening: DrawnOpening;
  /** The schedule row this opening was matched to, or null. */
  matched: ScheduledOpening | null;
  /** The mark that made the match, as printed on the plan. */
  mark: string | null;
  /** The width to deduct with, in feet, and where it came from. */
  widthFt: number;
  widthFrom: "schedule" | "drawn";
  /**
   * Set where the drawn gap and the scheduled width disagree by more than a
   * frame allowance. The opening still uses the SCHEDULE's width — the
   * disagreement is reported, not resolved, because which one is wrong is a
   * question about the drawing.
   */
  mismatch: { drawnFeet: number; scheduledFeet: number; why: string } | null;
};

export type OpeningJoin = {
  openings: JoinedOpening[];
  /** How many drawn openings found a schedule row. */
  matched: number;
  /** Of the schedule's rows, how many were placed on this sheet. */
  rowsPlaced: number;
  rowsTotal: number;
  mismatches: number;
  /** Matched openings as a share of drawn ones, 0..1. */
  matchRate: number;
};

/** The midpoint of an opening, in page-width units. */
function middle(opening: DrawnOpening): { x: number; y: number } {
  return { x: (opening.x1 + opening.x2) / 2, y: (opening.y1 + opening.y2) / 2 };
}

/**
 * Attach schedule rows to drawn openings, by the marks printed beside them.
 *
 * `feetPerUnit` converts page-width units to feet, so `MARK_REACH_FEET` means
 * the same thing on a 1/8in sheet and a 1/4in one.
 */
export function joinOpeningsToSchedule(input: {
  openings: readonly DrawnOpening[];
  marks: readonly PlacedMark[];
  rows: readonly ScheduledOpening[];
  feetPerUnit: number;
}): OpeningJoin {
  const { openings, marks, rows, feetPerUnit } = input;
  const byMark = new Map<string, ScheduledOpening>();
  for (const row of rows) {
    const key = row.mark.trim().toUpperCase();
    if (key !== "" && !byMark.has(key)) byMark.set(key, row);
  }

  const reach = feetPerUnit > 0 ? MARK_REACH_FEET / feetPerUnit : 0;
  const placed = new Set<string>();
  const joined: JoinedOpening[] = [];
  /** A mark is one opening's, so it cannot label two. */
  const usedMark = new Set<PlacedMark>();

  for (const opening of openings) {
    const centre = middle(opening);
    let best: { mark: PlacedMark; distance: number } | null = null;
    for (const mark of marks) {
      if (usedMark.has(mark)) continue;
      const key = mark.text.trim().toUpperCase();
      // Only a mark the SCHEDULE knows is a candidate. A room number that
      // happens to sit near a doorway names no row and claims nothing.
      if (!byMark.has(key)) continue;
      const distance = Math.hypot(mark.x - centre.x, mark.y - centre.y);
      if (distance > reach) continue;
      if (best === null || distance < best.distance) best = { mark, distance };
    }

    if (best === null) {
      joined.push({
        opening,
        matched: null,
        mark: null,
        widthFt: opening.widthFeet,
        widthFrom: "drawn",
        mismatch: null,
      });
      continue;
    }

    usedMark.add(best.mark);
    const key = best.mark.text.trim().toUpperCase();
    const row = byMark.get(key) ?? null;
    placed.add(key);

    // A row with no readable width cannot improve on the drawn gap, so the
    // drawn gap stays — the match is still worth recording, because it names
    // the door.
    if (row === null || row.widthFt === null || !(row.widthFt > 0)) {
      joined.push({
        opening,
        matched: row,
        mark: best.mark.text,
        widthFt: opening.widthFeet,
        widthFrom: "drawn",
        mismatch: null,
      });
      continue;
    }

    const drawn = opening.widthFeet;
    const scheduled = row.widthFt;
    const off = Math.abs(drawn - scheduled) / scheduled;
    joined.push({
      opening,
      matched: row,
      mark: best.mark.text,
      widthFt: scheduled,
      widthFrom: "schedule",
      mismatch:
        off > GAP_TOLERANCE
          ? {
              drawnFeet: drawn,
              scheduledFeet: scheduled,
              why:
                drawn > scheduled
                  ? `the gap drawn is ${drawn.toFixed(1)} ft and the schedule says ${scheduled.toFixed(1)} ft — too wide to be frame and shims, so the mark may be on the wrong opening`
                  : `the gap drawn is ${drawn.toFixed(1)} ft against a ${scheduled.toFixed(1)} ft door — the drawn gap runs a fifth narrow on this set, but not by this much, so check the size cell was read from the right row`,
            }
          : null,
    });
  }

  const matched = joined.filter((one) => one.matched !== null).length;
  return {
    openings: joined,
    matched,
    rowsPlaced: placed.size,
    rowsTotal: byMark.size,
    mismatches: joined.filter((one) => one.mismatch !== null).length,
    matchRate: openings.length > 0 ? matched / openings.length : 0,
  };
}

/** `3'-0"`, `3' - 0"`, `36"`, `3-0` → feet. Null where it is not a size. */
export function sizeToFeet(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return null;
  // Feet and inches: 3'-0", 3' 0", 3'-6 1/2"
  const both = clean.match(/(\d+)\s*'\s*-?\s*(\d+)?(?:\s+(\d+)\s*\/\s*(\d+))?\s*"?/);
  if (both !== null && both[1] !== undefined) {
    const feet = Number(both[1]);
    const inches = both[2] === undefined ? 0 : Number(both[2]);
    const fraction =
      both[3] === undefined || both[4] === undefined || Number(both[4]) === 0
        ? 0
        : Number(both[3]) / Number(both[4]);
    return feet + (inches + fraction) / 12;
  }
  // Inches only: 36"
  const inchesOnly = clean.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (inchesOnly !== null) return Number(inchesOnly[1]) / 12;
  return null;
}

/**
 * The width part of a schedule's size cell — `3'-0" x 7'-0"` → 3 ft.
 *
 * Width first, height second, which is the universal convention on a door
 * schedule. Where there is no separator there is no height, and a lone size is
 * the width.
 */
export function widthAndHeight(size: string | null | undefined): {
  widthFt: number | null;
  heightFt: number | null;
} {
  if (size === null || size === undefined) return { widthFt: null, heightFt: null };
  const parts = size.split(/\s*[xX×]\s*/);
  return {
    widthFt: sizeToFeet(parts[0] ?? null),
    heightFt: parts.length > 1 ? sizeToFeet(parts[1]) : null,
  };
}
