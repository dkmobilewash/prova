/**
 * ── POSTED DOORS ON THE BID: WHO INSTALLS THEM, AND WHAT EACH ONE ADDS ──
 *
 * A trade setting (Company.doorScope, and the same choice at the trade pick) decides whether a
 * posted door reaches the estimate at all:
 *
 *   - BY_OTHERS (the default): no line. Another trade does the doors, and the count stays on the sheet.
 *   - FRAMES: each door's hollow-metal frame is set by this company (the frame supplied by others).
 *   - DOORS_AND_FRAMES: the frame set and the door hung, hardware included.
 *
 * When it is on, each door adds:
 *
 *   - LABOR, at the company's production rates (`doorFramesPerHr`, `doorsPerHr`) and crew rate: one
 *     EA line per task, "Labor — Doors — set hollow-metal frames". A blank rate writes nothing and is
 *     named, as every production rate is.
 *   - For a framing trade, THE OPENING'S FRAMING, from the company's own partition assembly: its stud
 *     part as king and jack studs and its track part as the header. Those parts are already linked to
 *     the company's price book and supplier list, so these lines are priced, and show where the price
 *     came from, exactly as a wall's studs and track are.
 *
 * Pure: `takeoff-item-lines.ts` writes the framing lines, `laborLines.ts` the labor.
 */
import type { TradeScope } from "@prova/db";

export const DOOR_SCOPES = ["BY_OTHERS", "FRAMES", "DOORS_AND_FRAMES"] as const;
export type DoorScope = (typeof DOOR_SCOPES)[number];

export const DOOR_SCOPE_LABELS: Record<DoorScope, string> = {
  BY_OTHERS: "By others: a door adds nothing to the bid",
  FRAMES: "We install the frames (hollow-metal, supplied by others)",
  DOORS_AND_FRAMES: "We install the doors and the frames",
};

export function doorScopeFrom(value: unknown): DoorScope | null {
  return DOOR_SCOPES.includes(value as DoorScope) ? (value as DoorScope) : null;
}

// ponytail: conventional counts for a single 3'-0" opening, not a setting; a quantity standard on
// Wall types when a shop frames its openings differently.
/** Two king studs and two jack studs, one of each either side of the opening. */
export const STUDS_PER_OPENING = 4;
/** Header track over a 3'-0" door, with 6" of bearing either side. */
export const HEADER_LF_PER_OPENING = 4;

/** Steel framing is the trade that frames the opening; the other trades only set what they install. */
export function framesOpenings(scopes: readonly TradeScope[]): boolean {
  return scopes.includes("METAL_FRAMING_DRYWALL");
}

type Part = { id: string; description: string; unit: string | null; basis: string };

/**
 * What one door opening takes from a partition assembly: its stud part (bought by the piece) as the
 * king and jack studs, and its track part (by the foot) as the header. A part in another unit is not
 * guessed at, and an assembly with neither frames nothing.
 */
export function openingFraming<P extends Part>(parts: readonly P[]): { part: P; perDoor: number; what: string }[] {
  const each = (unit: string | null) => /^(ea|each|pc|pcs|piece|pieces)$/i.test((unit ?? "").trim());
  const feet = (unit: string | null) => /^(lin ?ft|lf|ft|linear feet)$/i.test((unit ?? "").trim());
  const stud = parts.find((p) => p.basis === "STUDS" && each(p.unit));
  const track = parts.find((p) => p.basis === "LINEAR_FT" && feet(p.unit) && /\btrack\b|\brunner\b/i.test(p.description) && !/deflection|slotted/i.test(p.description));
  return [
    ...(stud ? [{ part: stud, perDoor: STUDS_PER_OPENING, what: `king and jack studs, ${STUDS_PER_OPENING} per door` }] : []),
    ...(track ? [{ part: track, perDoor: HEADER_LF_PER_OPENING, what: `header, ${HEADER_LF_PER_OPENING} lin ft per door` }] : []),
  ];
}

/** The framing assembly a job's openings take their parts from: the default partition, else the first one this job's walls use that frames with studs. */
export function framingAssembly<A extends { id: string; components: readonly Part[] }>(assemblies: readonly A[], preferIds: readonly (string | null)[]): A | null {
  const framed = (a: A) => a.components.some((c) => c.basis === "STUDS");
  for (const id of preferIds) {
    const a = id === null ? undefined : assemblies.find((x) => x.id === id);
    if (a && framed(a)) return a;
  }
  return null;
}

export const DOORS_LABOR_PREFIX = "Labor — Doors — ";
export const WINDOWS_LABOR = "Labor — Windows — set window frames";

/**
 * ── WINDOWS, THE SAME WAY, BEHIND THE SAME SETTING ──
 *
 * A confirmed window count ("Windows — A", from the review queue) reaches the bid only when the
 * company installs frames (FRAMES or DOORS_AND_FRAMES): its frame set at `windowFramesPerHr`, and for a
 * framing trade the rough opening from the partition's own parts — king and jack studs either side, and
 * track for the header and the sill, each the window's width, the header with 6" of bearing each end.
 */
export const WINDOW_ITEM_PREFIX = "Windows — ";
// ponytail: the width a window is taken to be when its stored frame cannot be found again; a
// schedule's widths when windows carry their mark.
export const WINDOW_FALLBACK_WIDTH_FT = 4;

/** The track a window's rough opening takes: header (width + 1 ft of bearing) and sill (width). */
export function windowOpeningTrackFt(widthFt: number): number {
  return 2 * widthFt + 1;
}

/** The EA labor line a job's windows come to; a blank rate writes nothing and is named. */
export function windowLabor(windows: number, scope: DoorScope, rates: { windowFramesPerHr: number | null }): { lines: { description: string; unit: "EA"; quantity: number; hours: number; perHr: number }[]; missing: string[] } {
  if (scope === "BY_OTHERS" || windows <= 0) return { lines: [], missing: [] };
  if (rates.windowFramesPerHr === null) return { lines: [], missing: ["setting window frames (frames per hour)"] };
  return { lines: [{ description: WINDOWS_LABOR, unit: "EA", quantity: windows, hours: Math.round((windows / rates.windowFramesPerHr) * 100) / 100, perHr: rates.windowFramesPerHr }], missing: [] };
}

/** The EA labor lines a job's doors come to at the company's rates; a blank rate writes nothing and is named. */
export function doorLabor(doors: number, scope: DoorScope, rates: { doorFramesPerHr: number | null; doorsPerHr: number | null }): { lines: { description: string; unit: "EA"; quantity: number; hours: number; perHr: number }[]; missing: string[] } {
  if (scope === "BY_OTHERS" || doors <= 0) return { lines: [], missing: [] };
  const lines: { description: string; unit: "EA"; quantity: number; hours: number; perHr: number }[] = [];
  const missing: string[] = [];
  const add = (description: string, perHr: number | null, name: string) => {
    if (perHr === null) missing.push(name);
    else lines.push({ description: `${DOORS_LABOR_PREFIX}${description}`, unit: "EA", quantity: doors, hours: Math.round((doors / perHr) * 100) / 100, perHr });
  };
  add("set hollow-metal frames", rates.doorFramesPerHr, "setting door frames (frames per hour)");
  if (scope === "DOORS_AND_FRAMES") add("hang doors, with hardware", rates.doorsPerHr, "hanging doors (doors per hour)");
  return { lines, missing };
}

/**
 * Where a production-rate labor line's price came from, while its cost is still that rate's: a door
 * task names its own rate, an hour line the crew rate. A cost somebody typed over it is theirs, and
 * the source line goes.
 */
export function laborSource(
  line: { description: string; costCategory: string | null; budgetedUnitCost: { toString(): string } | null },
  rates: { crewRatePerHr: number | null; doorFramesPerHr: number | null; doorsPerHr: number | null; windowFramesPerHr?: number | null },
): string | null {
  if (line.costCategory !== "LABOR" || line.budgetedUnitCost === null || rates.crewRatePerHr === null || !line.description.startsWith("Labor — ")) return null;
  const cost = Number(line.budgetedUnitCost.toString());
  const crew = `at your crew rate of $${rates.crewRatePerHr.toFixed(2)}/hr`;
  const each = (perHr: number | null, what: string) =>
    perHr !== null && Math.abs(cost - Math.round((rates.crewRatePerHr! / perHr) * 100) / 100) < 0.005 ? `Your production rate: ${perHr} ${what} per hour, ${crew}` : null;
  if (line.description === `${DOORS_LABOR_PREFIX}set hollow-metal frames`) return each(rates.doorFramesPerHr, "frames");
  if (line.description === `${DOORS_LABOR_PREFIX}hang doors, with hardware`) return each(rates.doorsPerHr, "doors");
  if (line.description === WINDOWS_LABOR) return each(rates.windowFramesPerHr ?? null, "window frames");
  return Math.abs(cost - rates.crewRatePerHr) < 0.005 ? `Your production rates, ${crew}` : null;
}
