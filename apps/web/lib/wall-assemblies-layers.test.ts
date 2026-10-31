import { describe, expect, it } from "vitest";
import {
  componentRunQuantity,
  layerMultiplier,
  MAX_BOARD_LAYERS,
  runGeometry,
  scheduleLines,
  wallTypeInputFromRow,
  type WallRunInput,
  type WallTypeInput,
} from "./wall-assemblies";
import { STARTER_TYPES } from "./wall-type-starters";

/**
 * BOARD LAYERS — the second wall-type fact the Bid guide asks (`boardLayers`
 * on the type, `perLayer` on a part). Three promises, each pinned here:
 *
 *   1. UNANSWERED IS UNCHANGED. A type with no answer prices every part
 *      exactly as its factor says — byte-identical to before the columns
 *      existed — over every starter and over a job's worth of runs.
 *   2. AN ANSWER MOVES ONLY THE PARTS THAT OPTED IN. Board doubles at two
 *      layers and so does hanging it; studs, track, insulation and tape and
 *      finish do not move.
 *   3. A PART THAT DID NOT OPT IN IS NEVER MULTIPLIED, which is what keeps a
 *      legend-made type (layer count already in its factor) from doubling.
 */

/** A starter as the library stores it, through the ONE mapper every caller uses. */
function starter(code: string, boardLayers: number | null, defaultHeightFt: number | null = null): WallTypeInput {
  const type = STARTER_TYPES.find((entry) => entry.code === code)!;
  return wallTypeInputFromRow({
    id: code,
    code,
    defaultHeightFt,
    sides: 2,
    studSpacingIn: 16,
    boardLayers,
    components: type.parts.map((part, index) => ({
      id: `${code}:${index}`,
      description: part.description,
      unit: part.unit,
      basis: part.basis,
      factor: part.factor,
      wastePercent: part.wastePercent ?? "0",
      roundUp: part.roundUp ?? false,
      perLayer: part.perLayer ?? false,
      productionRate: null,
    })),
  });
}

/** The same type as it was BEFORE `perLayer` existed: no part opted in. */
const withoutPerLayer = (type: WallTypeInput): WallTypeInput => ({
  ...type,
  components: type.components.map((component) => ({ ...component, perLayer: false })),
});

const run = (id: string, wallTypeId: string, lengthFt: number, heightFt: number | null, openings: WallRunInput["openings"] = []): WallRunInput => ({
  id,
  label: id,
  wallTypeId,
  lengthFt,
  heightFt,
  openings,
});

/**
 * An existing job's worth of runs: odd lengths, mixed heights, openings either
 * side of the 32 sq ft deduction threshold, a run on the type's default
 * height, and one with no height at all (reported, never priced).
 */
const JOB_RUNS: WallRunInput[] = [
  run("l1-corridor", "W1", 142, 10, [{ widthFt: 3, heightFt: 7 }, { widthFt: 6, heightFt: 8 }]),
  run("l1-office", "W1", 38.5, 9),
  run("l2-demising", "W2", 220.25, 12, [{ widthFt: 6, heightFt: 7 }]),
  run("l2-default", "W2", 64.75, null), // the type's default height
  run("stairs", "W3", 80, 8, [{ widthFt: 3, heightFt: 6.8 }]),
  run("exterior", "EW1", 120, 14, [{ widthFt: 4, heightFt: 5 }, { widthFt: 8, heightFt: 10 }]),
  run("lobby-skim", "FIN5", 60.3, 10),
  run("unsized", "W3", 12, null), // no height anywhere: reported, not priced
];

const WALL_STARTERS = ["W1", "W2", "W3", "EW1", "FIN5"];
const typesFor = (layers: number | null) => WALL_STARTERS.map((code) => starter(code, layers, code === "W2" ? 10 : null));

describe("1. unanswered is unchanged", () => {
  it("every starter, over a job's runs, prices byte-identically to the same types with no part per-layer", () => {
    const now = scheduleLines(JOB_RUNS, typesFor(null));
    const before = scheduleLines(JOB_RUNS, typesFor(null).map(withoutPerLayer));
    expect(now).toEqual(before);
    // Not vacuous: there are lines, a per-layer part among them, and the run
    // with no height is reported rather than dropped.
    expect(now.lines.length).toBe(5 + 6 + 5 + 7 + 2);
    expect(typesFor(null).flatMap((type) => type.components).filter((c) => c.perLayer).length).toBe(8);
    expect(now.unpricedRuns).toEqual([{ id: "unsized", label: "unsized" }]);
  });

  it("every starter, on its own, at the company's own opening threshold too", () => {
    for (const code of WALL_STARTERS) {
      const runs = [run("a", code, 100, 10, [{ widthFt: 3, heightFt: 7 }]), run("b", code, 17.5, 9.5)];
      for (const options of [{}, { openingThresholdSqFt: 0 }, { openingThresholdSqFt: 50 }]) {
        expect(scheduleLines(runs, [starter(code, null)], options), `${code} ${JSON.stringify(options)}`).toEqual(
          scheduleLines(runs, [withoutPerLayer(starter(code, null))], options),
        );
      }
    }
  });

  it("the starters that name board mark ONLY the board and its hanging per-layer — never studs, track, insulation or tape and finish", () => {
    const perLayer = STARTER_TYPES.flatMap((type) => type.parts.filter((part) => part.perLayer).map((part) => `${type.code}: ${part.description}`));
    expect(perLayer).toEqual([
      "W1: ⅝″ Type X board, 4x8 sheets",
      "W1: Hang ⅝″ board",
      "W2: ⅝″ Type X board, 4x8 sheets",
      "W2: Hang ⅝″ board",
      "W3: ½″ board, 4x8 sheets",
      "W3: Hang ½″ board",
      "EW1: ⅝″ Type X board, inside face only",
      "EW1: Hang inside face board",
    ]);
    // A combined "Hang, tape and finish" part can be neither per layer nor not.
    expect(STARTER_TYPES.flatMap((type) => type.parts).filter((part) => part.description.startsWith("Hang, tape"))).toEqual([]);
  });
});

describe("2. an answer moves only the parts that opted in — the W2 starter, before and after", () => {
  // 100 LF of W2 at 10 ft, no openings: 76 studs (75 bays + the closer),
  // 1,000 sq ft a face, 2,000 boarded.
  const runs = [run("a", "W2", 100, 10)];
  const quantities = (layers: number | null) =>
    Object.fromEntries(scheduleLines(runs, [starter("W2", layers)]).lines.map((line) => [line.description, line.quantity]));

  it("unanswered and one layer are the same as the starter has always priced", () => {
    const expected = {
      "W2 — 3⅝″ 20ga studs": 76,
      "W2 — 3⅝″ 20ga track, top and bottom": 200,
      // 2,000 / 32 × 1.10 = 68.75 → 69 sheets
      "W2 — ⅝″ Type X board, 4x8 sheets": 69,
      "W2 — Hang ⅝″ board": 2000,
      "W2 — Tape and finish ⅝″ board": 2000,
      "W2 — R-13 batt insulation": 1000,
    };
    expect(quantities(null)).toEqual(expected);
    expect(quantities(1)).toEqual(expected);
  });

  it("two layers each side doubles the board and its hanging, and nothing else", () => {
    expect(quantities(2)).toEqual({
      "W2 — 3⅝″ 20ga studs": 76,
      "W2 — 3⅝″ 20ga track, top and bottom": 200,
      // 2,000 / 32 × 2 × 1.10 = 137.5 → 138 sheets
      "W2 — ⅝″ Type X board, 4x8 sheets": 138,
      // Every layer is hung; only the face layer is taped and finished.
      "W2 — Hang ⅝″ board": 4000,
      "W2 — Tape and finish ⅝″ board": 2000,
      "W2 — R-13 batt insulation": 1000,
    });
  });

  it("three layers each side, from the library, triples it", () => {
    // 2,000 / 32 × 3 × 1.10 = 206.25 → 207
    expect(quantities(3)["W2 — ⅝″ Type X board, 4x8 sheets"]).toBe(207);
  });

  it("the multiplier applies before the round-up, on the job's total", () => {
    // Ten 4 ft runs: 80 sq ft boarded each, × 2 layers / 32 × 1.10 = 5.5
    // sheets each, 55 in all. Rounding per run first would be 60.
    const short = Array.from({ length: 10 }, (_, i) => run(`r${i}`, "W2", 4, 10));
    const sheets = scheduleLines(short, [starter("W2", 2)]).lines.find((line) => line.description.includes("board, 4x8"))!;
    expect(sheets.quantity).toBe(55);
  });
});

describe("3. layerMultiplier", () => {
  const part = (perLayer: boolean) => ({ perLayer });

  it("is one unless the part opted in AND the type has an answer", () => {
    expect(layerMultiplier(part(false), { boardLayers: 2 })).toBe(1);
    expect(layerMultiplier(part(true), { boardLayers: null })).toBe(1);
    expect(layerMultiplier(part(true), { boardLayers: 1 })).toBe(1);
    expect(layerMultiplier(part(true), { boardLayers: 2 })).toBe(2);
    expect(layerMultiplier(part(true), { boardLayers: MAX_BOARD_LAYERS })).toBe(MAX_BOARD_LAYERS);
  });

  it("treats an answer the action would refuse as no answer, rather than pricing zero board", () => {
    for (const bad of [0, -1, 1.5, MAX_BOARD_LAYERS + 1, Number.NaN]) {
      expect(layerMultiplier(part(true), { boardLayers: bad }), String(bad)).toBe(1);
    }
  });

  it("a legend-made board part (layers already in its factor, not per-layer) is never doubled again", () => {
    const legendBoard = { id: "b", description: "5/8in type X gypsum board, 2 layers per side", unit: "SF", basis: "BOARDED_SQFT" as const, factor: 2, wastePercent: 0, roundUp: false, perLayer: false, productionRate: null };
    const geometry = runGeometry(run("a", "L", 10, 10), { id: "L", code: "L", defaultHeightFt: null, sides: 2, studSpacingIn: 16, boardLayers: 2, components: [legendBoard] })!;
    expect(componentRunQuantity(legendBoard, geometry, { boardLayers: 2 })).toBe(400);
  });
});
