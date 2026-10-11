import type { SheetSpec, WallSpec } from "./syntheticSheet";

/**
 * THE HAND COUNT, AS A FIXTURE.
 *
 * On 2026-10-10 a region of a real school plan was counted off the drawing by
 * hand — five exam rooms between two grid lines, with the corridor in front of
 * them — and compared against what the finder returned. That count found three
 * defects in one afternoon that **every test in this directory had passed
 * through**: the sheet border billed as wall, a doorway ending a wall, and then
 * a wall drawn straight through a 5'-7" corridor.
 *
 * None of those needed a real drawing to catch. They needed a scene with a
 * KNOWN ANSWER and an assertion about the answer rather than about the code. So
 * the scene is here.
 *
 * ── IT IS A RECONSTRUCTION, NOT THE DRAWING, AND THAT IS DELIBERATE ──
 *
 * The customer's plan set is confidential and never enters this repo. What is
 * here is the GEOMETRY as counted — nine walls, 233 feet, five doors in the
 * corridor wall, three in the back wall, a column on the grid line, a 5'-7"
 * corridor with a matching block of rooms on the far side of it. Every number
 * below came off the count, and the arithmetic agrees with it exactly:
 *
 *     7 verticals × 17 ft  = 119 ft   (grid B, grid D, five acoustic partitions)
 *     2 horizontals × 57 ft = 114 ft  (corridor wall, back wall)
 *                             ------
 *                             233 ft  across 9 walls
 *
 * ── SO IT IS A FLOOR, THE SAME WAY `wallCases.ts` SAYS IT IS ──
 *
 * A reconstruction has no drafting noise, no line-weight variation, no
 * dimension strings crossing the walls, no xrefs. **A pass here is not a pass
 * on the drawing it came from.** What it does catch is the class of defect that
 * cost today: a wrong ANSWER on geometry anyone can read, which is exactly what
 * the unit tests either side of it could not see.
 */

/** 4-7/8": a 3-5/8" stud with 5/8" board each side, as the drawing's acoustic
 *  partitions and corridor walls are. */
const PARTITION_FT = 0.40625;

/** Clear corridor width, measured on the drawing. NARROWER than a double door,
 *  which is the whole reason a width bound cannot tell them apart. */
export const CORRIDOR_FT = 5.583;

/** The room block: five rooms between seven verticals. */
export const BLOCK_WIDE_FT = 57;
export const ROOM_DEEP_FT = 17;
const VERTICALS = 7;

/** A door, as the corridor and back walls carry. 21 sq ft at 7ft tall, under
 *  `DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT`, so it is NOT deducted and the
 *  gross length is the correct take-off across it. */
const DOOR_FT = 3;

/** The column on the grid line, which interrupts a wall without opening it. */
const COLUMN_FT = 1.5;

/** The walls the hand count found, and their total. Asserted against, not
 *  derived from the detector — a fixture that computes its own answer from the
 *  thing it is testing proves nothing. */
export const COUNTED_WALLS = 9;
export const COUNTED_FEET = VERTICALS * ROOM_DEEP_FT + 2 * BLOCK_WIDE_FT;

/**
 * One wall with gaps cut out of it at given positions.
 *
 * ── WHERE THE DOORS GO IS NOT A DETAIL, AND THE FIRST VERSION GOT IT WRONG ──
 *
 * This spaced the openings evenly along the wall, which put five of the seven
 * partitions' ends EXACTLY IN A DOORWAY — a layout no building has, since a
 * partition lands on solid wall and the door goes beside it. The fixture then
 * reported six runs crossing the corridor against code that refuses exactly
 * that, and the bug was in the scene rather than the detector.
 *
 * Worth keeping as a finding rather than just fixing: `gapIsCrossing` looks for
 * a perpendicular wall at each end of a gap, and **a door at that exact point
 * means there is no wall there to find**. A partition meeting a corridor wall
 * precisely at an opening would still join across. Rare enough that nothing
 * guards it; recorded so the next person meets it as a known edge rather than
 * as a mystery.
 */
function wallWithGaps(
  fromFeet: { x: number; y: number },
  direction: "horizontal" | "vertical",
  lengthFeet: number,
  gaps: readonly { atFeet: number; wideFeet: number }[],
): WallSpec[] {
  const pieces: WallSpec[] = [];
  let cursor = 0;
  for (const gap of [...gaps].sort((a, b) => a.atFeet - b.atFeet)) {
    const solid = gap.atFeet - cursor;
    if (solid > 0.01) {
      pieces.push({
        fromFeet:
          direction === "horizontal"
            ? { x: fromFeet.x + cursor, y: fromFeet.y }
            : { x: fromFeet.x, y: fromFeet.y + cursor },
        direction,
        lengthFeet: solid,
        thicknessFeet: PARTITION_FT,
      });
    }
    cursor = gap.atFeet + gap.wideFeet;
  }
  const tail = lengthFeet - cursor;
  if (tail > 0.01) {
    pieces.push({
      fromFeet:
        direction === "horizontal"
          ? { x: fromFeet.x + cursor, y: fromFeet.y }
          : { x: fromFeet.x, y: fromFeet.y + cursor },
      direction,
      lengthFeet: tail,
      thicknessFeet: PARTITION_FT,
    });
  }
  return pieces;
}

/** Doors in the middle of the first `count` bays, which is where a drawing
 *  puts them: on the room's frontage, clear of the partitions either side. */
function doorsAtBayCentres(count: number, bays: number): { atFeet: number; wideFeet: number }[] {
  const spacing = BLOCK_WIDE_FT / bays;
  return Array.from({ length: count }, (_, i) => ({
    atFeet: i * spacing + (spacing - DOOR_FT) / 2,
    wideFeet: DOOR_FT,
  }));
}

/** One block of rooms: seven verticals, a wall across the front with doors in
 *  it, and a wall across the back. */
function roomBlock(baseY: number, frontDoors: number, backDoors: number, columnOnFirst: boolean): WallSpec[] {
  const walls: WallSpec[] = [];
  const bays = VERTICALS - 1;
  const spacing = BLOCK_WIDE_FT / bays;
  for (let i = 0; i < VERTICALS; i += 1) {
    const x = i * spacing;
    // The column sits on the first grid line, interrupting it without being a
    // doorway: nothing perpendicular crosses there, so it must still join.
    const breaks =
      columnOnFirst && i === 0
        ? [{ atFeet: (ROOM_DEEP_FT - COLUMN_FT) / 2, wideFeet: COLUMN_FT }]
        : [];
    walls.push(...wallWithGaps({ x, y: baseY }, "vertical", ROOM_DEEP_FT, breaks));
  }
  walls.push(
    ...wallWithGaps({ x: 0, y: baseY }, "horizontal", BLOCK_WIDE_FT, doorsAtBayCentres(frontDoors, bays)),
  );
  walls.push(
    ...wallWithGaps(
      { x: 0, y: baseY + ROOM_DEEP_FT },
      "horizontal",
      BLOCK_WIDE_FT,
      doorsAtBayCentres(backDoors, bays),
    ),
  );
  return walls;
}

/**
 * The counted region, plus the block on the far side of the corridor.
 *
 * THE SOUTH BLOCK IS NOT DECORATION. Without it there is nothing for a
 * partition to be joined INTO across the corridor, and the defect that shipped
 * on 2026-10-10 — seven runs through open floor — could not occur in this
 * scene at all. A fixture that cannot reproduce the bug it was written for is
 * the vacuous green this directory keeps finding.
 */
export const EXAM_ROOMS: SheetSpec = {
  id: "exam-rooms",
  sheetSize: "ARCH_D",
  sheetNumber: "A-101",
  symbols: [],
  feetPerInch: 8,
  walls: [
    // BOTH BLOCKS IN POSITIVE FEET, which is not a style choice: the
    // synthesiser places the drawing origin 80 points in from the sheet's
    // corner, so a block at a negative y is drawn OFF THE PAGE. The first
    // version put the south block at -17 ft, it was clipped, and the fixture
    // then reported six runs crossing the corridor against code that refuses
    // exactly that — the scene was broken, not the detector.
    //
    // South block first, then the corridor, then the counted block.
    ...roomBlock(0, 4, 2, false),
    ...roomBlock(ROOM_DEEP_FT + CORRIDOR_FT, 5, 3, true),
  ],
};

/** The corridor, between the south block's back wall and the north block's
 *  front wall. Exported so a test can assert that nothing spans it. */
export const CORRIDOR_FROM_FT = ROOM_DEEP_FT;
export const CORRIDOR_TO_FT = ROOM_DEEP_FT + CORRIDOR_FT;
