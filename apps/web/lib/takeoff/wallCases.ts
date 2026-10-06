import type { SheetSpec, WallSpec } from "./syntheticSheet";

/**
 * SYNTHETIC SHEETS WITH WALLS ON THEM, and the truth of what is there.
 *
 * Never a real plan set: *"never use real customer files in tests or fixtures"*,
 * and a project's drawings are somebody's confidential bid documents.
 *
 * ── WHAT EACH CASE IS FOR ──
 *
 * The cases are chosen so a failure on each means something different. Two are
 * about finding what is there, and four are about NOT finding what is not —
 * which is the harder half, because every one of those four is real geometry
 * that a wall-finder could plausibly claim: a hatch pair, a dimension string, a
 * corridor read as one wall, and a door swing.
 *
 * ── THE BOUND, WHICH IS THE SAME ONE `symbolCases.ts` RECORDS ──
 *
 * These strokes are drawn by our own generator. Finding them proves the
 * PIPELINE — that `getOperatorList` reaches the lines, that the viewport
 * transform puts them in the right space, that the pair-finder works end to end
 * — and it does NOT prove that a Revit or AutoCAD export looks the same. A pass
 * here is a FLOOR. The honest next step is one sheet exported by real CAD, which
 * Diego can produce without touching a customer's drawing.
 */

/** A 4-7/8" partition: 3-5/8" stud, 5/8" board each side. */
export const PARTITION = 0.40625;
/** An 8" shaft wall. */
export const SHAFT = 0.667;

/** A rectangular room, as four walls. Walls meet at corners the way a plan
 *  draws them — faces crossing rather than mitred, which is what CAD emits. */
function room(x: number, y: number, w: number, h: number, thickness = PARTITION): WallSpec[] {
  return [
    { fromFeet: { x, y }, direction: "horizontal", lengthFeet: w, thicknessFeet: thickness },
    { fromFeet: { x, y: y + h }, direction: "horizontal", lengthFeet: w, thicknessFeet: thickness },
    { fromFeet: { x, y }, direction: "vertical", lengthFeet: h, thicknessFeet: thickness },
    { fromFeet: { x: x + w, y }, direction: "vertical", lengthFeet: h, thicknessFeet: thickness },
  ];
}

export type WallCase = {
  id: string;
  /** Why this case is here, printed in the report so a failure reads as a cost. */
  why: string;
  spec: SheetSpec;
  /** How many walls a correct reading finds. */
  expectWalls: number;
  /**
   * Whether this case's sheet carries geometry designed to be MISTAKEN for a
   * wall. Reported separately in the run, because a phantom on a clean sheet
   * and a phantom on a cluttered one mean different things.
   */
  cluttered: boolean;
};

export const WALL_CASES: WallCase[] = [
  {
    id: "single-room-clean",
    why: "four walls and nothing else. The floor: if this fails, the pipeline is broken rather than the judgement",
    expectWalls: 4,
    cluttered: false,
    spec: {
      id: "single-room-clean",
      sheetSize: "ARCH_D",
      sheetNumber: "A-101",
      feetPerInch: 8,
      symbols: [],
      walls: room(10, 10, 30, 20),
    },
  },
  {
    id: "two-rooms-shared-wall",
    why: "two rooms sharing a wall — the case where one face belongs to two rooms, and a finder that uses a face twice reports a wall that is not there",
    expectWalls: 7,
    cluttered: false,
    spec: {
      id: "two-rooms-shared-wall",
      sheetSize: "ARCH_D",
      sheetNumber: "A-102",
      feetPerInch: 8,
      symbols: [],
      // SPELLED OUT RATHER THAN `room()` TWICE, and the first version of this
      // case got it wrong: two `room()` calls sharing an x each draw their own
      // vertical there, so the sheet carried EIGHT walls with two of them
      // coincident — and the case asserting seven was testing its own
      // arithmetic rather than the finder. The shared wall is drawn once here,
      // which is what a plan does and what makes the `why` above true.
      walls: [
        { fromFeet: { x: 10, y: 10 }, direction: "horizontal", lengthFeet: 30, thicknessFeet: PARTITION },
        { fromFeet: { x: 10, y: 30 }, direction: "horizontal", lengthFeet: 30, thicknessFeet: PARTITION },
        { fromFeet: { x: 40, y: 10 }, direction: "horizontal", lengthFeet: 25, thicknessFeet: PARTITION },
        { fromFeet: { x: 40, y: 30 }, direction: "horizontal", lengthFeet: 25, thicknessFeet: PARTITION },
        { fromFeet: { x: 10, y: 10 }, direction: "vertical", lengthFeet: 20, thicknessFeet: PARTITION },
        // The shared one, between the two rooms.
        { fromFeet: { x: 40, y: 10 }, direction: "vertical", lengthFeet: 20, thicknessFeet: PARTITION },
        { fromFeet: { x: 65, y: 10 }, direction: "vertical", lengthFeet: 20, thicknessFeet: PARTITION },
      ],
    },
  },
  {
    id: "mixed-thickness",
    why: "a shaft wall beside partitions. A finder with one hardcoded thickness finds some of a plan and silently drops the rest, which is the shape of error that loses footage rather than adding it",
    expectWalls: 6,
    cluttered: false,
    spec: {
      id: "mixed-thickness",
      sheetSize: "ARCH_D",
      sheetNumber: "A-103",
      feetPerInch: 8,
      symbols: [],
      walls: [
        ...room(10, 10, 30, 20),
        { fromFeet: { x: 45, y: 10 }, direction: "vertical", lengthFeet: 20, thicknessFeet: SHAFT },
        { fromFeet: { x: 45, y: 10 }, direction: "horizontal", lengthFeet: 18, thicknessFeet: SHAFT },
      ],
    },
  },
  {
    id: "walls-with-hatching",
    why: "poché over the plan. At any scale a hatch stroke and a wall face are both thin lines, and a hatch pair is parallel — so this is the first real discrimination test",
    expectWalls: 4,
    cluttered: true,
    spec: {
      id: "walls-with-hatching",
      sheetSize: "ARCH_D",
      sheetNumber: "A-104",
      feetPerInch: 8,
      symbols: [],
      clutter: ["hatching"],
      walls: room(10, 10, 30, 20),
    },
  },
  {
    id: "walls-with-dimensions",
    why: "THE CASE THE OVERLAP TEST EXISTS FOR. A dimension string runs parallel to the wall it measures and sits a plausible thickness from it — the only thing separating them is that it is offset ALONG the wall rather than beside it",
    expectWalls: 4,
    cluttered: true,
    spec: {
      id: "walls-with-dimensions",
      sheetSize: "ARCH_D",
      sheetNumber: "A-105",
      feetPerInch: 8,
      symbols: [],
      clutter: ["dimensions"],
      walls: room(10, 10, 30, 20),
    },
  },
  {
    id: "walls-with-doors-and-notes",
    why: "door swings and keynote text over the plan. A swing is an ARC and must be dropped rather than chorded into a phantom wall; the notes put words where a finder might read strokes",
    expectWalls: 4,
    cluttered: true,
    spec: {
      id: "walls-with-doors-and-notes",
      sheetSize: "ARCH_D",
      sheetNumber: "A-106",
      feetPerInch: 8,
      symbols: [{ kind: "door", count: 4 }],
      clutter: ["notes"],
      walls: room(10, 10, 30, 20),
    },
  },
  {
    id: "no-walls-at-all",
    why: "a sheet of symbols and clutter and NO walls. A finder that reports anything here reports phantoms on every detail sheet in a set, and this is the cheapest case to get wrong",
    expectWalls: 0,
    cluttered: true,
    spec: {
      id: "no-walls-at-all",
      sheetSize: "ARCH_D",
      sheetNumber: "A-501",
      feetPerInch: 8,
      symbols: [{ kind: "door", count: 6 }, { kind: "wallTag", count: 4 }],
      clutter: ["hatching", "dimensions", "notes"],
      walls: [],
    },
  },
];
