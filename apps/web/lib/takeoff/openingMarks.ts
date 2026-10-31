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
 * ── A MARK WITH NO GAP UNDER IT IS STILL A DOOR ──
 *
 * Measured on Camp Bow Wow A101 against its schedule on p26 (2026-10-20):
 * every one of the 30 scheduled marks is printed on the plan inside a pill,
 * and for 17 of them the nearest opening `openingsInWalls` found is 8 to 37
 * feet away — the gap detector did not see those doorways at all. The join
 * can only match what the detector hands it, so 13 of 30 was its ceiling
 * however the marks were read.
 *
 * The schedule says the door exists and the mark says where, and both are
 * better evidence than the absence of a detected gap. So where a scheduled
 * mark sits within reach of a RUN but of no opening, the door is placed on
 * that run at the mark, with the schedule's width — and reported as placed by
 * its mark rather than by a gap, so a reviewer can see which deductions rest
 * on the drawing's geometry and which on its lettering. Nothing is invented:
 * the mark is printed, the row is printed, and the run was found.
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
 * How far from a RUN a mark may sit and still place a door there when no gap
 * was detected, in feet.
 *
 * Tighter than `MARK_REACH_FEET` on purpose. A door mark is drawn against the
 * door it names; a ROOM number is drawn in the room, in the same series, and
 * on Camp Bow Wow A101 both are axis-aligned boxes. With six feet of reach
 * the first version of this placed room numbers as doors — `109` twice, once
 * at its door and once at its room. Two and a half feet is a mark beside a
 * jamb and is not the middle of any room with a door in it.
 */
export const MARK_ON_WALL_FEET = 2.5;

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
  /**
   * True when the mark is drawn inside a closed symbol — a door tag — rather
   * than being loose text. A tag is placed by the drafter beside its door,
   * often outside the swing, and may sit `MARK_SYMBOL_REACH_FEET` from the
   * wall; loose text keeps the tighter `MARK_ON_WALL_FEET`.
   */
  inSymbol?: boolean;
};

/**
 * How far a door TAG — a scheduled mark in its own symbol — may sit from the
 * run it names, when that run is clearly the nearest.
 *
 * Measured on NG Green Bay A3.1 (2026-10-21): twelve scheduled marks sit in
 * circles 2.9 to 7.2 ft from the wall their door is in, beside the swing,
 * and `MARK_ON_WALL_FEET` placed seven of nineteen rows. The tag is the
 * drafter's own placement and it is not ambiguous when the next run is twice
 * as far, which is `TAG_CLEAR_MARGIN`'s rule for wall tags applied here.
 */
export const MARK_SYMBOL_REACH_FEET = 4.5;
export const MARK_CLEAR_MARGIN = 2;

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
  /**
   * How this door was located: by a detected gap in the line work, or by its
   * mark alone, placed on the nearest run because no gap was detected there.
   */
  placedBy: "opening" | "mark";
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
  /** Scheduled doors placed on a run by their mark, with no detected gap. */
  placedByMark: number;
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
  /**
   * The sheet's wall runs, in the same page-width units. With them, a
   * scheduled mark that no detected gap claims is placed on the nearest run
   * within reach; without them the join is exactly what it was.
   */
  walls?: readonly { x1: number; y1: number; x2: number; y2: number }[];
}): OpeningJoin {
  const { openings, marks, rows, feetPerUnit, walls = [] } = input;
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
        placedBy: "opening",
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
        placedBy: "opening",
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
      placedBy: "opening",
    });
  }

  // ── THE DOORS THE GAP DETECTOR MISSED, PLACED BY THEIR MARKS ──
  //
  // A mark the schedule knows, that no opening claimed, within reach of a run.
  // The nearest run takes it, at the point on the run nearest the mark, and
  // the schedule's width is the opening. A row with no readable width cannot
  // be placed this way — there is no gap to fall back on — and is left for
  // the rows-not-placed count.
  let placedByMark = 0;
  const onWall = feetPerUnit > 0 ? MARK_ON_WALL_FEET / feetPerUnit : 0;
  const symbolReach = feetPerUnit > 0 ? MARK_SYMBOL_REACH_FEET / feetPerUnit : 0;
  if (walls.length > 0 && onWall > 0) {
    // ── ONE DOOR PER MARK, AND THE INSTANCE NEAREST A WALL IS THE DOOR ──
    //
    // `102` is printed twice: in the pill at the door and in the box under
    // the room name. A mark the gap join already used, or already placed
    // here, is spent. Among the rest, the printing nearest a run is the door
    // mark — the room's copy sits in open floor.
    const byKey = new Map<string, { row: ScheduledOpening & { widthFt: number }; instances: PlacedMark[] }>();
    for (const mark of marks) {
      if (usedMark.has(mark)) continue;
      const key = mark.text.trim().toUpperCase();
      if (placed.has(key)) continue;
      const row = byMark.get(key);
      // A row with no readable width cannot be placed this way — there is no
      // gap to fall back on — and stays in the rows-not-placed count.
      if (row === undefined || row.widthFt === null || !(row.widthFt > 0)) continue;
      const entry = byKey.get(key) ?? { row: { ...row, widthFt: row.widthFt }, instances: [] };
      entry.instances.push(mark);
      byKey.set(key, entry);
    }
    for (const [key, { row, instances }] of byKey) {
      let best: { mark: PlacedMark; wall: (typeof walls)[number]; t: number; distance: number; gap: boolean } | null = null;
      for (const mark of instances) {
        // Nearest run and the next, so a symbol's longer reach only counts
        // when the nearest run is clearly the one.
        let first: { wall: (typeof walls)[number]; t: number; raw: number; distance: number } | null = null;
        let second: { wall: (typeof walls)[number]; t: number; distance: number } | null = null;
        for (const wall of walls) {
          const dx = wall.x2 - wall.x1;
          const dy = wall.y2 - wall.y1;
          const len2 = dx * dx + dy * dy;
          if (len2 === 0) continue;
          const raw = ((mark.x - wall.x1) * dx + (mark.y - wall.y1) * dy) / len2;
          const t = Math.max(0, Math.min(1, raw));
          const distance = Math.hypot(mark.x - (wall.x1 + t * dx), mark.y - (wall.y1 + t * dy));
          if (first === null || distance < first.distance) {
            second = first === null ? null : { wall: first.wall, t: first.t, distance: first.distance };
            first = { wall, t, raw, distance };
          } else if (second === null || distance < second.distance) second = { wall, t, distance };
        }
        if (first === null) continue;
        const secondDistance = second?.distance ?? Infinity;
        const within =
          first.distance <= onWall ||
          (mark.inSymbol === true && first.distance <= symbolReach && secondDistance >= first.distance * MARK_CLEAR_MARGIN);
        if (within) {
          if (best === null || best.gap || first.distance < best.distance) best = { mark, wall: first.wall, t: first.t, distance: first.distance, gap: false };
          continue;
        }
        // ── A WIDE DOOR IN THE GAP BETWEEN TWO RUNS ──
        // SW Grand Junction's 10 ft sliding storefront door (101): no swing,
        // and no run where it sits — the finder's runs are the brick piers 5
        // ft either side, so the tag under the door's middle is half a door
        // from both and clearly nearest to neither. A symbol mark past the
        // END of two collinear runs, each within half the scheduled width of
        // it, is the door between them, centred where the mark projects onto
        // their line. A room number never sits in line with two wall ends.
        if (mark.inSymbol !== true || second === null) continue;
        const gapReach = (row.widthFt / 2) / feetPerUnit + onWall;
        if (first.distance > gapReach || second.distance > gapReach) continue;
        const offEnd = (t: number) => t <= 0 || t >= 1;
        if (!offEnd(first.raw) || !offEnd(second.t)) continue;
        const a = first.wall, b = second.wall;
        const al = Math.hypot(a.x2 - a.x1, a.y2 - a.y1), bl = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
        const cos = Math.abs(((a.x2 - a.x1) * (b.x2 - b.x1) + (a.y2 - a.y1) * (b.y2 - b.y1)) / (al * bl));
        if (cos < Math.cos((5 * Math.PI) / 180)) continue;
        if (best === null || (best.gap && first.distance < best.distance)) best = { mark, wall: a, t: first.raw, distance: first.distance, gap: true };
      }
      if (best === null) continue;
      usedMark.add(best.mark);
      placed.add(key);
      placedByMark += 1;
      const { mark, wall, t } = best;
      const dx = wall.x2 - wall.x1;
      const dy = wall.y2 - wall.y1;
      const len = Math.hypot(dx, dy);
      const half = row.widthFt / feetPerUnit / 2;
      // On the run at the mark's foot; or, in the gap case, on the run's line
      // past its end, where the mark projects.
      const cx = wall.x1 + t * dx;
      const cy = wall.y1 + t * dy;
      joined.push({
        opening: {
          x1: cx - (dx / len) * half,
          y1: cy - (dy / len) * half,
          x2: cx + (dx / len) * half,
          y2: cy + (dy / len) * half,
          widthFeet: row.widthFt,
        },
        matched: row,
        mark: mark.text,
        widthFt: row.widthFt,
        widthFrom: "schedule",
        mismatch: null,
        placedBy: "mark",
      });
    }
  }

  const matched = joined.filter((one) => one.matched !== null).length;
  return {
    openings: joined,
    matched,
    rowsPlaced: placed.size,
    rowsTotal: byMark.size,
    mismatches: joined.filter((one) => one.mismatch !== null).length,
    // Over the DRAWN openings, as before: a door placed by its mark is not a
    // drawn opening that was matched, so it moves `rowsPlaced` and
    // `placedByMark` and leaves this rate honest about the gap detector.
    matchRate: openings.length > 0 ? joined.filter((one) => one.matched !== null && one.placedBy === "opening").length / openings.length : 0,
    placedByMark,
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
