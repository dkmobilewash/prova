import { describe, expect, it } from "vitest";
import {
  componentRunQuantity,
  openingsFromJson,
  runGeometry,
  runHeight,
  scheduleLines,
  type WallComponentInput,
  type WallRunInput,
  type WallTypeInput,
} from "./wall-assemblies";

const component = (over: Partial<WallComponentInput> & Pick<WallComponentInput, "id" | "basis">): WallComponentInput => ({
  description: over.id,
  unit: null,
  factor: 1,
  wastePercent: 0,
  roundUp: false,
  productionRate: null,
  ...over,
});

/** W1: 3⅝″ studs at 16″, one layer of ⅝″ each side, 10 ft default. */
const W1: WallTypeInput = {
  id: "w1",
  code: "W1",
  defaultHeightFt: 10,
  sides: 2,
  studSpacingIn: 16,
  components: [
    component({ id: "studs", description: "3⅝″ 20ga studs", unit: "ea", basis: "STUDS" }),
    component({ id: "track", description: "3⅝″ track", unit: "lin ft", basis: "LINEAR_FT", factor: 2 }),
    component({ id: "board", description: "⅝″ Type X", unit: "sq ft", basis: "BOARDED_SQFT", productionRate: 50 }),
    component({ id: "sheets", description: "⅝″ Type X 4x8", unit: "sheets", basis: "BOARDED_SQFT", factor: 1 / 32, wastePercent: 10, roundUp: true }),
    component({ id: "batt", description: "R-13 batt", unit: "sq ft", basis: "FACE_SQFT" }),
  ],
};

const run = (over: Partial<WallRunInput> & Pick<WallRunInput, "id">): WallRunInput => ({
  label: over.id,
  wallTypeId: "w1",
  lengthFt: 100,
  heightFt: null,
  openings: [],
  ...over,
});

const byId = (lines: { componentId: string; quantity: number; laborHours: number | null }[]) =>
  Object.fromEntries(lines.map((line) => [line.componentId, line]));

describe("a run's height", () => {
  it("is the run's own, else the type's default, else nothing — never a guess", () => {
    expect(runHeight({ heightFt: 12 }, { defaultHeightFt: 10 })).toBe(12);
    expect(runHeight({ heightFt: null }, { defaultHeightFt: 10 })).toBe(10);
    expect(runHeight({ heightFt: null }, { defaultHeightFt: null })).toBeNull();
  });
});

describe("a run's geometry", () => {
  it("counts studs, one face and both boarded sides for 100 ft at 10 ft", () => {
    // 100 ft at 16″ o.c. = 75 bays + the closing stud = 76 (lib/takeoff.ts).
    expect(runGeometry(run({ id: "r" }), W1)).toEqual({
      linearFt: 100,
      heightFt: 10,
      faceSqFt: 1000,
      boardedSqFt: 2000,
      studs: 76,
    });
  });

  it("deducts a large opening from every boarded side, per the existing threshold rule", () => {
    const g = runGeometry(run({ id: "r", openings: [{ widthFt: 6, heightFt: 7 }] }), W1)!;
    expect(g.faceSqFt).toBe(1000 - 42);
    expect(g.boardedSqFt).toBe((1000 - 42) * 2);
  });

  it("has no geometry at all when there is no height anywhere", () => {
    expect(runGeometry(run({ id: "r" }), { ...W1, defaultHeightFt: null })).toBeNull();
  });
});

describe("a component on a run", () => {
  it("is basis × factor × (1 + waste)", () => {
    const g = runGeometry(run({ id: "r" }), W1)!;
    // 2000 sq ft boarded / 32 × 1.10 = 68.75 sheets (rounded later, on the total).
    expect(componentRunQuantity(W1.components[3], g)).toBeCloseTo(68.75);
  });
});

describe("the job's wall schedule", () => {
  it("sums each component across every run of the type, then rounds up once", () => {
    const schedule = scheduleLines([run({ id: "a", lengthFt: 100 }), run({ id: "b", lengthFt: 20 })], [W1]);
    const lines = byId(schedule.lines);
    // Studs: 76 (100 ft) + 16 (20 ft = 15 bays + 1).
    expect(lines.studs.quantity).toBe(92);
    // Track: 120 ft × 2.
    expect(lines.track.quantity).toBe(240);
    // Board: 2400 sq ft both sides.
    expect(lines.board.quantity).toBe(2400);
    // Sheets: 2400 / 32 × 1.10 = 82.5 → 83. Rounding each run first would be 69 + 14 = 83
    // here too, so the next test pins the case where it differs.
    expect(lines.sheets.quantity).toBe(83);
    expect(lines.batt.quantity).toBe(1200);
  });

  it("rounds the TOTAL up, not each run — forty short runs do not buy forty extra sheets", () => {
    // Each 4 ft run at 10 ft: 80 sq ft boarded / 32 × 1.10 = 2.75 sheets.
    // Ten runs: 27.5 → 28. Rounding per run would be 3 × 10 = 30.
    const runs = Array.from({ length: 10 }, (_, i) => run({ id: `r${i}`, lengthFt: 4 }));
    expect(byId(scheduleLines(runs, [W1]).lines).sheets.quantity).toBe(28);
  });

  it("names each line by the wall type it is for", () => {
    const line = scheduleLines([run({ id: "a" })], [W1]).lines.find((l) => l.componentId === "board")!;
    expect(line.description).toBe("W1 — ⅝″ Type X");
    expect(line.unit).toBe("sq ft");
  });

  it("derives labor hours from the component's production rate, and none where it has no rate", () => {
    const lines = byId(scheduleLines([run({ id: "a" })], [W1]).lines);
    // 2000 sq ft at 50 sq ft/hr.
    expect(lines.board.laborHours).toBe(40);
    expect(lines.studs.laborHours).toBeNull();
  });

  it("reports a run with no height rather than pricing it", () => {
    const noDefault = { ...W1, defaultHeightFt: null };
    const schedule = scheduleLines([run({ id: "a", label: "L2 corridor" }), run({ id: "b", heightFt: 9 })], [noDefault]);
    expect(schedule.unpricedRuns).toEqual([{ id: "a", label: "L2 corridor" }]);
    // Only run b (100 ft × 9 ft) counts: one face 900.
    expect(byId(schedule.lines).batt.quantity).toBe(900);
  });

  it("reports a run whose type is missing, and never borrows another type's assembly", () => {
    const schedule = scheduleLines([run({ id: "a", label: "Ghost", wallTypeId: "gone" })], [W1]);
    expect(schedule.orphanRuns).toEqual([{ id: "a", label: "Ghost" }]);
    expect(schedule.lines).toEqual([]);
  });

  it("produces nothing for a type with no runs", () => {
    expect(scheduleLines([], [W1]).lines).toEqual([]);
  });

  it("keeps two types' components apart even when they share a description", () => {
    const W2: WallTypeInput = {
      ...W1,
      id: "w2",
      code: "W2",
      components: [component({ id: "w2-board", description: "⅝″ Type X", unit: "sq ft", basis: "BOARDED_SQFT" })],
    };
    const schedule = scheduleLines([run({ id: "a" }), run({ id: "b", wallTypeId: "w2", lengthFt: 10 })], [W1, W2]);
    const lines = byId(schedule.lines);
    expect(lines.board.quantity).toBe(2000);
    expect(lines["w2-board"].quantity).toBe(200);
  });
});

describe("openings read back from JSON", () => {
  it("keeps well-formed pairs and drops anything else rather than deducting zero", () => {
    expect(
      openingsFromJson([{ widthFt: 3, heightFt: 7 }, { widthFt: "x", heightFt: 7 }, null, { widthFt: 0, heightFt: 7 }]),
    ).toEqual([{ widthFt: 3, heightFt: 7 }]);
    expect(openingsFromJson("nope")).toEqual([]);
  });
});
