import { materialKey } from "./materialKey";
import { doorLabor, windowLabor, type DoorScope } from "./doorLines";

/**
 * ── A COMPANY'S PRODUCTION RATES: how fast ITS crews frame, hang and finish ──
 *
 * Every rate starts BLANK. A rate is a fact about one company's crews, and a seeded number would be a
 * guess wearing that company's name on its bid — the same rule that keeps prices out of the catalog.
 * A task whose rate is blank produces no labor line at all, and the estimate says which rates are
 * missing ("Set your production rates"), the way it asks for a markup.
 *
 * Hours = quantity ÷ rate × the height multiplier for the wall's band. Finish rates are per level, so
 * a Level 5 wall takes the Level 5 rate. Cost = hours × the crew rate, priced through the labor markup.
 * Stored on `CompanyBidDefaults.productionRates`.
 */
export type ProductionRates = {
  /** Lineal feet of wall framed per crew hour, studs and track together. */
  framingLfPerHr: number | null;
  /** Square feet of board hung per crew hour, by board type. */
  boardSfPerHr: { regular: number | null; typeX: number | null; special: number | null };
  /** Square feet taped and finished per crew hour, by finish level. */
  finishSfPerHr: { level3: number | null; level4: number | null; level5: number | null };
  /** The finish level a wall gets when the spec does not say Level 5. */
  defaultFinishLevel: 3 | 4 | 5;
  /** Square feet of ceiling installed per crew hour. */
  ceilingSfPerHr: number | null;
  /** Hollow-metal door frames set per crew hour (Company.doorScope FRAMES or DOORS_AND_FRAMES). */
  doorFramesPerHr: number | null;
  /** Doors hung per crew hour, hardware included (Company.doorScope DOORS_AND_FRAMES). */
  doorsPerHr: number | null;
  /** Window frames set per crew hour (Company.doorScope FRAMES or DOORS_AND_FRAMES). */
  windowFramesPerHr: number | null;
  /** Hours multiplied by this for a wall over 10 ft, and by the second for one over 14 ft. */
  over10Multiplier: number | null;
  over14Multiplier: number | null;
  /** The crew's cost per hour — what an hour of this labor costs the company. */
  crewRatePerHr: number | null;
};

export const BLANK_RATES: ProductionRates = {
  framingLfPerHr: null,
  boardSfPerHr: { regular: null, typeX: null, special: null },
  finishSfPerHr: { level3: null, level4: null, level5: null },
  defaultFinishLevel: 4,
  ceilingSfPerHr: null,
  doorFramesPerHr: null,
  doorsPerHr: null,
  windowFramesPerHr: null,
  over10Multiplier: null,
  over14Multiplier: null,
  crewRatePerHr: null,
};

const rate = (value: unknown, max: number): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : null);

/** A stored JSON value back into rates. Anything missing, zero or out of range is BLANK — never a default. */
export function ratesFromJson(value: unknown): ProductionRates {
  const raw = (value ?? {}) as Record<string, unknown>;
  const board = (raw.boardSfPerHr ?? {}) as Record<string, unknown>;
  const finish = (raw.finishSfPerHr ?? {}) as Record<string, unknown>;
  return {
    framingLfPerHr: rate(raw.framingLfPerHr, 1000),
    boardSfPerHr: { regular: rate(board.regular, 2000), typeX: rate(board.typeX, 2000), special: rate(board.special, 2000) },
    finishSfPerHr: { level3: rate(finish.level3, 2000), level4: rate(finish.level4, 2000), level5: rate(finish.level5, 2000) },
    defaultFinishLevel: raw.defaultFinishLevel === 3 || raw.defaultFinishLevel === 5 ? raw.defaultFinishLevel : 4,
    ceilingSfPerHr: rate(raw.ceilingSfPerHr, 2000),
    doorFramesPerHr: rate(raw.doorFramesPerHr, 100),
    doorsPerHr: rate(raw.doorsPerHr, 100),
    windowFramesPerHr: rate(raw.windowFramesPerHr, 100),
    over10Multiplier: rate(raw.over10Multiplier, 5),
    over14Multiplier: rate(raw.over14Multiplier, 5),
    crewRatePerHr: rate(raw.crewRatePerHr, 1000),
  };
}

/** What a wall type is, for labor: does it have framing, which board, how many layers, which finish level. */
export type LaborAssembly = { framed: boolean; board: "regular" | "typeX" | "special" | null; layers: number; finishLevel: 3 | 4 | 5 | null };

/** Read a type's parts (as #1091 writes them, or as a person typed them) into what labor needs. */
export function laborAssembly(parts: readonly { description: string; unit: string | null; basis: string; factor: number }[], defaultFinishLevel: 3 | 4 | 5): LaborAssembly {
  const framed = parts.some((p) => p.basis === "STUDS" || materialKey(p.description)?.startsWith("stud|"));
  const boardPart = parts.find((p) => materialKey(p.description)?.startsWith("board|"));
  const key = boardPart ? materialKey(boardPart.description)! : null;
  const board = key === null ? null : key.endsWith("|regular") ? "regular" : key.endsWith("|x") ? "typeX" : "special";
  // Layers per side: a sheet part's factor is layers/32 (#1091), a square-foot part's is the layers.
  const layers = boardPart ? (/^(sht|sheet|sheets)$/i.test(boardPart.unit ?? "") ? boardPart.factor * 32 : boardPart.factor) : 0;
  const level5 = parts.some((p) => /level 5/i.test(p.description));
  return { framed, board, layers: Math.round(layers * 1000) / 1000, finishLevel: board === null ? null : level5 ? 5 : defaultFinishLevel };
}

/** The multiplier for a wall's height: over 14 ft takes the second, over 10 ft the first, otherwise 1. A blank multiplier is 1 and is reported missing. */
export function heightBand(heightFt: number, rates: ProductionRates): { band: "" | "over 10 ft" | "over 14 ft"; multiplier: number; missing: string | null } {
  if (heightFt > 14) return { band: "over 14 ft", multiplier: rates.over14Multiplier ?? 1, missing: rates.over14Multiplier === null ? "the over-14 ft multiplier" : null };
  if (heightFt > 10) return { band: "over 10 ft", multiplier: rates.over10Multiplier ?? 1, missing: rates.over10Multiplier === null ? "the over-10 ft multiplier" : null };
  return { band: "", multiplier: 1, missing: null };
}

/** One wall's share of the labor: a wall type's run or traced item at one height. */
export type WallForLabor = { code: string; assembly: LaborAssembly; heightFt: number; linearFt: number; boardedSqFt: number };

/** An HR line by default; a door task is an EA line, `quantity` doors taking `hours`. */
export type LaborLine = { description: string; hours: number; unit?: "EA"; quantity?: number; perHr?: number };
export type LaborPlan = { lines: LaborLine[]; missing: string[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The labor lines a job's walls and ceilings come to: framing, hanging and finishing per wall type and
 * height band, ceilings per ceiling line. Walls of one type in one band are summed BEFORE dividing, so
 * forty short runs are one line, not forty roundings. A task with a blank rate writes nothing and its
 * rate is named in `missing`.
 */
export function laborPlan(walls: readonly WallForLabor[], ceilings: readonly { description: string; squareFeet: number }[], rates: ProductionRates, doors: { count: number; scope: DoorScope; windows?: number } = { count: 0, scope: "BY_OTHERS" }): LaborPlan {
  const missing = new Set<string>();
  const sums = new Map<string, { hours: number }>();
  const add = (description: string, hours: number) => sums.set(description, { hours: (sums.get(description)?.hours ?? 0) + hours });
  for (const wall of walls) {
    const band = heightBand(wall.heightFt, rates);
    if (band.missing) missing.add(band.missing);
    const at = band.band === "" ? "" : `, ${band.band}`;
    const a = wall.assembly;
    if (a.framed) {
      if (rates.framingLfPerHr === null) missing.add("framing (lin ft per hour)");
      else add(`Labor — ${wall.code} — framing, studs and track${at}`, (wall.linearFt / rates.framingLfPerHr) * band.multiplier);
    }
    if (a.board !== null && a.layers > 0) {
      const boardRate = rates.boardSfPerHr[a.board];
      const name = a.board === "typeX" ? "type X" : a.board;
      if (boardRate === null) missing.add(`hanging ${name} board (sq ft per hour)`);
      else add(`Labor — ${wall.code} — hang ${name} board${a.layers > 1 ? `, ${a.layers} layers` : ""}${at}`, ((wall.boardedSqFt * a.layers) / boardRate) * band.multiplier);
      const level = a.finishLevel ?? rates.defaultFinishLevel;
      const finishRate = rates.finishSfPerHr[`level${level}` as const];
      // Only the face layer is taped: finish follows the boarded face, not the layer count.
      if (finishRate === null) missing.add(`taping and finishing, Level ${level} (sq ft per hour)`);
      else add(`Labor — ${wall.code} — tape and finish, Level ${level}${at}`, (wall.boardedSqFt / finishRate) * band.multiplier);
    }
  }
  for (const c of ceilings) {
    if (rates.ceilingSfPerHr === null) missing.add("ceilings (sq ft per hour)");
    else add(`Labor — ${c.description} — install`, c.squareFeet / rates.ceilingSfPerHr);
  }
  const door = doorLabor(doors.count, doors.scope, rates);
  const window = windowLabor(doors.windows ?? 0, doors.scope, rates);
  door.lines.push(...window.lines);
  door.missing.push(...window.missing);
  for (const m of door.missing) missing.add(m);
  if ((sums.size > 0 || door.lines.length > 0) && rates.crewRatePerHr === null) missing.add("the crew rate ($ per hour)");
  const lines: LaborLine[] = [...sums].map(([description, s]) => ({ description, hours: round2(s.hours) })).filter((l) => l.hours > 0);
  return { lines: [...lines, ...door.lines.map((l) => ({ description: l.description, hours: l.hours, unit: l.unit, quantity: l.quantity, perHr: l.perHr }))], missing: [...missing] };
}
