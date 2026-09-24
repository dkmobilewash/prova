/**
 * A wall run × its wall type → the estimate's quantities.
 *
 * This is the join no takeoff product on the market makes: a plan-view run of
 * wall (a length) meets the TYPE from the partition schedule and the HEIGHT
 * from the sections, and only then becomes studs, track, board and insulation.
 * The run is what was measured; the type is the company's own assembly; this
 * file is the arithmetic between them.
 *
 * Pure and argument-taking, like lib/takeoff.ts, whose functions it reuses so
 * the wall arithmetic still lives in exactly one place — a stud counted here is
 * counted by `studsRequired`, openings are deducted by `boardedArea`'s rule.
 *
 * NOTHING IS GUESSED. A run with no height of its own, on a type with no
 * default height, produces no quantities at all and is reported as such — a
 * guessed ten feet is a number that looks right and gets bid.
 */

import { boardedArea, studsRequired, type Opening } from "./takeoff";

export type WallComponentBasis = "LINEAR_FT" | "FACE_SQFT" | "BOARDED_SQFT" | "STUDS" | "PER_RUN";

export const WALL_COMPONENT_BASES: readonly WallComponentBasis[] = [
  "LINEAR_FT",
  "FACE_SQFT",
  "BOARDED_SQFT",
  "STUDS",
  "PER_RUN",
];

export const WALL_BASIS_LABELS: Record<WallComponentBasis, string> = {
  LINEAR_FT: "per foot of wall",
  FACE_SQFT: "per sq ft of one face",
  BOARDED_SQFT: "per sq ft boarded",
  STUDS: "per stud",
  PER_RUN: "per run",
};

export type WallTypeInput = {
  id: string;
  code: string;
  defaultHeightFt: number | null;
  sides: number;
  studSpacingIn: number;
  components: WallComponentInput[];
};

export type WallComponentInput = {
  id: string;
  description: string;
  unit: string | null;
  basis: WallComponentBasis;
  factor: number;
  wastePercent: number;
  roundUp: boolean;
  /** Units per hour; null means the component carries no labor. */
  productionRate: number | null;
};

export type WallRunInput = {
  id: string;
  label: string;
  wallTypeId: string;
  lengthFt: number;
  heightFt: number | null;
  openings: Opening[];
};

export type RunGeometry = {
  linearFt: number;
  heightFt: number;
  /** One face, openings deducted. */
  faceSqFt: number;
  /** Face area × boarded sides, openings deducted on every side. */
  boardedSqFt: number;
  studs: number;
};

/** The height a run is priced at: its own, else its type's default, else none. */
export function runHeight(run: Pick<WallRunInput, "heightFt">, type: Pick<WallTypeInput, "defaultHeightFt">): number | null {
  if (run.heightFt != null && run.heightFt > 0) return run.heightFt;
  if (type.defaultHeightFt != null && type.defaultHeightFt > 0) return type.defaultHeightFt;
  return null;
}

/** A run's measurements, or null when it has no height to price at. */
export function runGeometry(run: WallRunInput, type: WallTypeInput): RunGeometry | null {
  const heightFt = runHeight(run, type);
  if (heightFt == null || run.lengthFt <= 0) return null;
  const sides = type.sides === 1 ? 1 : 2;
  const faceSqFt = boardedArea({ lengthFt: run.lengthFt, heightFt, sides: 1, openings: run.openings });
  const boardedSqFt = boardedArea({ lengthFt: run.lengthFt, heightFt, sides, openings: run.openings });
  const studs = studsRequired(run.lengthFt, { spacingFt: type.studSpacingIn > 0 ? type.studSpacingIn / 12 : undefined });
  return { linearFt: run.lengthFt, heightFt, faceSqFt, boardedSqFt, studs };
}

function basisAmount(basis: WallComponentBasis, geometry: RunGeometry): number {
  switch (basis) {
    case "LINEAR_FT":
      return geometry.linearFt;
    case "FACE_SQFT":
      return geometry.faceSqFt;
    case "BOARDED_SQFT":
      return geometry.boardedSqFt;
    case "STUDS":
      return geometry.studs;
    case "PER_RUN":
      return 1;
  }
}

/** The un-rounded quantity of one component on one run: basis × factor × (1 + waste). */
export function componentRunQuantity(component: WallComponentInput, geometry: RunGeometry): number {
  return basisAmount(component.basis, geometry) * component.factor * (1 + component.wastePercent / 100);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type ScheduleLine = {
  componentId: string;
  wallTypeId: string;
  /** "W2 — ⅝″ Type X board" — the type's tag names which wall it is for. */
  description: string;
  unit: string | null;
  quantity: number;
  /** quantity ÷ productionRate, or null when the component carries no labor. */
  laborHours: number | null;
};

export type WallSchedule = {
  lines: ScheduleLine[];
  /** Runs that produced nothing because neither they nor their type have a height. */
  unpricedRuns: { id: string; label: string }[];
  /** Runs whose wall type is not in the list given — deleted, or another company's. */
  orphanRuns: { id: string; label: string }[];
};

/**
 * The whole schedule: one line per wall-type component, SUMMED across every run
 * of that type — "W2 — ⅝″ Type X board: 4,260 sq ft", which is how an estimate
 * reads, rather than one line per run per component.
 *
 * Summed BEFORE rounding up, and waste applied before rounding, for the reason
 * `sheetsRequired` gives: rounding each run then summing compounds the round-up,
 * and on a job with forty short runs that is forty extra sheets.
 *
 * A type with no runs produces no lines. Line order follows the type order, then
 * the component order, so the estimate reads like the partition schedule.
 */
export function scheduleLines(runs: readonly WallRunInput[], types: readonly WallTypeInput[]): WallSchedule {
  const typeById = new Map(types.map((type) => [type.id, type]));
  const totals = new Map<string, number>();
  const unpricedRuns: WallSchedule["unpricedRuns"] = [];
  const orphanRuns: WallSchedule["orphanRuns"] = [];

  for (const run of runs) {
    const type = typeById.get(run.wallTypeId);
    if (!type) {
      orphanRuns.push({ id: run.id, label: run.label });
      continue;
    }
    const geometry = runGeometry(run, type);
    if (!geometry) {
      unpricedRuns.push({ id: run.id, label: run.label });
      continue;
    }
    for (const component of type.components) {
      totals.set(component.id, (totals.get(component.id) ?? 0) + componentRunQuantity(component, geometry));
    }
  }

  const lines: ScheduleLine[] = [];
  for (const type of types) {
    for (const component of type.components) {
      const raw = totals.get(component.id);
      if (raw == null || raw <= 0) continue;
      const quantity = component.roundUp ? Math.ceil(Number(raw.toFixed(9))) : round2(raw);
      lines.push({
        componentId: component.id,
        wallTypeId: type.id,
        description: `${type.code} — ${component.description}`,
        unit: component.unit,
        quantity,
        laborHours:
          component.productionRate != null && component.productionRate > 0
            ? round2(quantity / component.productionRate)
            : null,
      });
    }
  }

  return { lines, unpricedRuns, orphanRuns };
}

/** Openings as stored on a run (JSON), validated into numbers. A malformed entry
 * is dropped rather than deducted as zero — see addTakeoffLines for why. */
export function openingsFromJson(value: unknown): Opening[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = entry as { widthFt?: unknown; heightFt?: unknown } | null;
      return { widthFt: Number(record?.widthFt), heightFt: Number(record?.heightFt) };
    })
    .filter((o) => Number.isFinite(o.widthFt) && Number.isFinite(o.heightFt) && o.widthFt > 0 && o.heightFt > 0);
}
