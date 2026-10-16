import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  wallsNotTheScaleBar,
  scaleBarLabels,
  LABEL_REACH_FEET,
  LABELS_FOR_A_RULER,
  type ScaleLabel,
} from "./scaleBar";
import type { WallCandidate } from "./wallVectors";
import type { PageTextItem } from "./wallTags";

/**
 * Built at 1/8" = 1'-0" on a 288 ft sheet in page-width units, so 1 ft of
 * building is 1/288 of the page — the same units the viewer works in, which is
 * where this filter runs.
 */
const FEET_PER_UNIT = 288;
const ft = (feet: number) => feet / FEET_PER_UNIT;

/** A horizontal run from (x, y), `feet` long. */
const run = (x: number, y: number, feet: number): WallCandidate => ({
  x1: ft(x),
  y1: ft(y),
  x2: ft(x + feet),
  y2: ft(y),
  thicknessFeet: 5.375 / 12,
  lengthFeet: feet,
});

/** A number printed at (x, y), in feet of building from the page's origin. */
const label = (x: number, y: number, value: number): ScaleLabel => ({
  value,
  x: ft(x),
  y: ft(y),
});

/** The School-01 bar: 0 · 4 · 8 · 16 · 32, printed a foot beneath it. */
const RULER = [
  label(100, 101, 0),
  label(104, 101, 4),
  label(108, 101, 8),
  label(116, 101, 16),
  label(132, 101, 32),
];

const BAR = run(100, 100, 32);

describe("a graphic scale bar is not a wall", () => {
  it("DROPS THE BAR", () => {
    // The defect as it shipped: a 5-3/8in group holding one 32 ft run, drawn
    // exactly on the bar marked 0 4 8 16 32 beneath the plan. Found by a
    // click-through, because no measurement of the lines can see it.
    expect(wallsNotTheScaleBar([BAR], RULER, FEET_PER_UNIT), "the scale bar was billed as wall").toEqual([]);
  });

  it("KEEPS A WALL OF THE SAME SHAPE IN THE SAME PLACE", () => {
    // The control, and the one that makes the test above mean anything: the
    // geometry is identical and only the numbers differ. Without this, a
    // filter that dropped everything would pass.
    expect(wallsNotTheScaleBar([BAR], [], FEET_PER_UNIT)).toHaveLength(1);
  });
});

describe("what must still be a wall", () => {
  it("keeps a wall with ROOM NUMBERS along it", () => {
    // Exam rooms 110-114 in a row. Ascending, three of them, parallel to the
    // wall — everything a ruler has except the zero, and they sit in the
    // middle of a 10 ft room rather than against the wall.
    const rooms = [label(105, 105, 110), label(115, 105, 111), label(125, 105, 112)];
    expect(
      wallsNotTheScaleBar([run(100, 100, 40)], rooms, FEET_PER_UNIT),
      "a wall was dropped because the rooms beside it are numbered",
    ).toHaveLength(1);
  });

  it("keeps a wall with numbers RIGHT AGAINST it that do not start at zero", () => {
    // ── THE ZERO IS THE WHOLE SAFETY ARGUMENT, SO IT IS TESTED ALONE ──
    //
    // Same distance, same count, same ascending order as a ruler. Only the
    // zero is missing, and that is what separates a drawing's numbering from a
    // measuring device.
    const near = [label(100, 101, 4), label(108, 101, 8), label(116, 101, 16)];
    expect(wallsNotTheScaleBar([BAR], near, FEET_PER_UNIT)).toHaveLength(1);
  });

  it("keeps a wall with a 0 and only TWO other numbers", () => {
    const thin = [label(100, 101, 0), label(116, 101, 16)];
    expect(wallsNotTheScaleBar([BAR], thin, FEET_PER_UNIT)).toHaveLength(1);
  });

  it("keeps a wall whose numbers are bunched at one end", () => {
    // A ruler is numbered end to end. Three numbers against one end of a long
    // wall is a schedule, a legend or a detail key.
    const bunched = [label(100, 101, 0), label(102, 101, 4), label(104, 101, 8)];
    expect(wallsNotTheScaleBar([run(100, 100, 60)], bunched, FEET_PER_UNIT)).toHaveLength(1);
  });

  it("keeps a wall whose numbers do not climb", () => {
    const jumbled = [label(100, 101, 0), label(116, 101, 32), label(132, 101, 8)];
    expect(wallsNotTheScaleBar([BAR], jumbled, FEET_PER_UNIT)).toHaveLength(1);
  });

  it("keeps a wall with the numbers a ROOM AWAY from it", () => {
    // Beyond `LABEL_REACH_FEET`. A scale bar's numbers are printed against it;
    // anything further off belongs to something else on the sheet.
    const away = RULER.map((one) => ({ ...one, y: ft(100 + LABEL_REACH_FEET + 2) }));
    expect(wallsNotTheScaleBar([BAR], away, FEET_PER_UNIT)).toHaveLength(1);
  });

  it("keeps a wall whose numbers run PAST its end", () => {
    // The bar's own ruler lies along the bar. A row of numbers that merely
    // continues in the same line, beyond the run, belongs to whatever is
    // drawn there.
    const past = [label(200, 101, 0), label(216, 101, 16), label(232, 101, 32)];
    expect(wallsNotTheScaleBar([BAR], past, FEET_PER_UNIT)).toHaveLength(1);
  });

  it("does nothing at all when the sheet has fewer than three bare numbers", () => {
    expect(wallsNotTheScaleBar([BAR], RULER.slice(0, LABELS_FOR_A_RULER - 1), FEET_PER_UNIT)).toHaveLength(1);
  });

  it("does nothing on a sheet with no scale", () => {
    // Degrades the safe way rather than refusing everything on a missing input.
    expect(wallsNotTheScaleBar([BAR], RULER, 0)).toHaveLength(1);
  });
});

describe("which text items count as a ruler's numbers", () => {
  const item = (str: string): PageTextItem => ({ str, x: 100, y: 100, width: 10, height: 10 });
  const values = (strings: string[]) =>
    scaleBarLabels(strings.map(item), 1000).map((one) => one.value);

  it("takes a bare number, with or without a foot mark", () => {
    expect(values(["0", "4", "16", "32", "8'"])).toEqual([0, 4, 16, 32, 8]);
  });

  it("REFUSES a dimension, which carries an inch mark", () => {
    // `30'-0"` is a dimension string and the number in it is not a ruler mark.
    expect(values(['30\'-0"', '7\'-0"', '28\'-9 15/16"'])).toEqual([]);
  });

  it("refuses a wall tag, a grid letter and a sheet number", () => {
    expect(values(["A1", "EXT-1", "B", "A-101", "1/A-501"])).toEqual([]);
  });

  it("refuses a number longer than three digits", () => {
    // A ruler counts in tens and hundreds, not thousands. Four digits is a
    // year, a project number or a product code.
    expect(values(["2026", "1234"])).toEqual([]);
  });

  it("returns nothing for a page width of zero rather than dividing by it", () => {
    expect(scaleBarLabels([item("0")], 0)).toEqual([]);
  });
});

describe("the call site, because no test here can open a PDF", () => {
  /**
   * ── FOUND BY MUTATION: EVERY CASE ABOVE PASSED WITH THE FILTER UNPLUGGED ──
   *
   * Deleting the one line that calls `wallsNotTheScaleBar` in the viewer left
   * all sixteen cases green, because they call the filter directly. That is the
   * "written, documented, and never called" shape this repo has a name for, and
   * it is how the ORIGINAL defect would have shipped a second time — with a
   * module, a test file and a changelog entry describing a fix nobody was
   * running.
   *
   * A census proves the code is THERE and never that a framework honours it
   * (CLAUDE.md, the expo-router entry). Here that limit is mild: this is a
   * function call in a function this repo's own tests already drive, not a
   * navigator option that can be silently discarded. The half it can see is the
   * half that was missing.
   */
  const viewer = readFileSync(resolve(process.cwd(), "lib/takeoff/findWallsOnSheet.ts"), "utf8");

  it("THE SHEET'S WALLS GO THROUGH IT", () => {
    expect(viewer, "the scale-bar filter is never called, so the bar is billed again").toContain(
      "wallsNotTheScaleBar(",
    );
    expect(viewer).toContain("scaleBarLabels(textItems, pageSize.widthPt)");
  });

  it("AND ITS RESULT IS WHAT GETS CLUSTERED", () => {
    // Calling it and discarding the answer is the same defect wearing a call.
    // `walls` is what `clusterByThickness` is handed, so this pins the filter's
    // output to that name rather than merely to an expression somewhere.
    // The scale bar filter now feeds the BUILDING step rather than being the
    // last thing before clustering — see `findWallsOnSheet`. What matters to
    // this file is unchanged: its result is what carries on down the chain.
    expect(viewer).toMatch(/const notScaleBar = wallsNotTheScaleBar\(/);
    expect(viewer).toMatch(/wallsInTheBuilding\(\s*notScaleBar\s*,/);
    expect(viewer).toContain("clusterByThickness(walls)");
  });

  it("reads the file it thinks it is reading", () => {
    // The size assertion this repo asks of anything that greps: a path that
    // stops resolving must fail loudly rather than match nothing and pass
    // everything downstream.
    // The needle moved with the call site: the filter now lives in the shared
    // pipeline rather than in the viewer, so the file this reads is the one
    // that can contain the answer.
    expect(viewer).toContain("export function findWallsOnSheet");
    expect(viewer.length).toBeGreaterThan(5000);
  });
});
