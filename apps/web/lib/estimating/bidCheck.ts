/**
 * ── THE BID CHECK: WHAT AN AUTOMATIC ESTIMATE STILL NEEDS A PERSON FOR, BEFORE IT IS SENT ──
 *
 * One panel on the Send step (`BidCheckPanel`). Seven checks, each OPEN or CLEAR, each saying
 * what it found and where to fix it. Sending stays allowed: the panel says "3 checks open", it
 * never blocks the button. A sub may know something the checks cannot.
 *
 * Pure: the facts come from `bidCheckQuery.ts`, read on every render. Derived state is never stored.
 *
 * A check that CANNOT be made is open, not clear: "no floor area to check against" is not a pass.
 * A check with nothing to look at (a bid with no walls has no wall heights to miss) is clear.
 */

export type BidCheckKey = "heights" | "prices" | "rates" | "review" | "spec" | "quantities" | "existing";

export type BidCheckFix = { label: string; href: string; newTab: boolean };
export type BidCheck = { key: BidCheckKey; title: string; open: boolean; lines: string[]; fix: BidCheckFix | null };

export type BidCheckFacts = {
  jobId: string;
  /** Wall groups in the review queue with no height, and wall-schedule runs whose type has none either. */
  heights: { queueGroups: number; runs: string[] };
  /** Estimate lines with neither a price nor a cost. */
  unpriced: string[];
  /** Production rates the job's labor needs and the company has not set (`laborPlanFor`). */
  laborMissing: string[];
  /** The review queue's other items: groups to type, walls held to confirm, sheets of windows, floor plans with no scale. */
  review: { type: number; wall: number; windows: number; scale: number };
  /** Legend wall types the spec disagrees with (`checkWallType`). */
  specConflicts: { code: string; what: string; legend: string; spec: string; sectionNumber: string }[];
  /** The building's floor area as typed on the job, the walls' footage and face, and the board on the estimate. */
  quantities: { grossAreaSqFt: number | null; wallLf: number; wallFaceSqFt: number; boardSqFt: number | null };
  /** Sheets that show existing work, carry walls, and were never compared with a demolition plan. */
  existing: { compareOn: boolean; sheets: { pageNumber: number; sheet: string; walls: number }[] };
};

/**
 * WHAT "LOOKS OFF" MEANS — rules of thumb for a check a person reads, never a number put on a bid.
 *
 * Wall footage per floor square foot: interior partitions on commercial and multi-family work
 * usually fall between 0.05 (an open warehouse or a shell) and 0.40 (dense rooms: apartments,
 * a clinic). Outside that, the usual causes are walls counted twice (both faces traced, a floor
 * taken off twice), walls the takeoff missed, or a floor area that is one floor of several.
 *
 * Board per square foot of wall face (length × height, one face): one layer on one face is 1.0
 * and two layers on both faces is 4.0, plus waste. Below 0.9 some walls have no board on the
 * estimate; above 4.5 board is counted twice, or a layer count or sheet size was read wrong.
 */
export const WALL_LF_PER_FLOOR_SF = { low: 0.05, high: 0.4 } as const;
export const BOARD_PER_WALL_SF = { low: 0.9, high: 4.5 } as const;

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstFew = (items: readonly string[], max = 5) => (items.length <= max ? [...items] : [...items.slice(0, max), `and ${items.length - max} more`]);

export function bidChecks(f: BidCheckFacts): BidCheck[] {
  const job = `/jobs/${f.jobId}`;
  const review: BidCheckFix = { label: "Open the review queue", href: `/takeoff/${f.jobId}?open=review`, newTab: true };
  const checks: BidCheck[] = [];

  const heightLines = [
    ...(f.heights.queueGroups > 0 ? [`${plural(f.heights.queueGroups, "wall group")} on the takeoff with no height`] : []),
    ...f.heights.runs.map((r) => `${r}: no height on the run or its type`),
  ];
  checks.push({
    key: "heights",
    title: "Wall heights",
    open: heightLines.length > 0,
    lines: heightLines.length > 0 ? firstFew(heightLines) : ["Every wall has a height."],
    fix: heightLines.length === 0 ? null : f.heights.queueGroups > 0 ? { ...review, label: "Set the heights" } : { label: "Set the heights on the wall schedule", href: `${job}/estimate#wall-schedule`, newTab: false },
  });

  checks.push({
    key: "prices",
    title: "Prices",
    open: f.unpriced.length > 0,
    lines: f.unpriced.length > 0 ? [`${plural(f.unpriced.length, "line")} with no price or cost:`, ...firstFew(f.unpriced)] : ["Every line has a price or a cost."],
    fix: f.unpriced.length > 0 ? { label: "Price them on the estimate", href: `${job}/estimate`, newTab: false } : null,
  });

  checks.push({
    key: "rates",
    title: "Production rates",
    open: f.laborMissing.length > 0,
    lines: f.laborMissing.length > 0 ? [`No labor for work whose rate isn't set: ${f.laborMissing.join(", ")}.`] : ["The labor has every rate it needs."],
    fix: f.laborMissing.length > 0 ? { label: "Set your production rates", href: "/wall-types#production-rates", newTab: false } : null,
  });

  const r = f.review;
  const reviewLines = [
    ...(r.type > 0 ? [`${plural(r.type, "wall group")} to type`] : []),
    ...(r.wall > 0 ? [`${plural(r.wall, "wall")} held off the estimate to confirm`] : []),
    ...(r.windows > 0 ? [`${plural(r.windows, "sheet")} of windows to confirm`] : []),
    ...(r.scale > 0 ? [`${plural(r.scale, "floor plan")} with no scale`] : []),
  ];
  checks.push({
    key: "review",
    title: "Review queue",
    open: reviewLines.length > 0,
    lines: reviewLines.length > 0 ? reviewLines : ["Nothing left to confirm."],
    fix: reviewLines.length > 0 ? review : null,
  });

  checks.push({
    key: "spec",
    title: "Spec conflicts",
    open: f.specConflicts.length > 0,
    lines:
      f.specConflicts.length > 0
        ? firstFew(f.specConflicts.map((c) => `${c.code}: ${c.what} — the legend says ${c.legend}, ${c.sectionNumber} says ${c.spec}`))
        : ["No wall type disagrees with the spec read."],
    fix: f.specConflicts.length > 0 ? { label: "Open the specs", href: `${job}/specs`, newTab: false } : null,
  });

  checks.push(quantityCheck(f, job));

  const ex = f.existing;
  checks.push({
    key: "existing",
    title: "Existing walls",
    open: ex.sheets.length > 0,
    lines:
      ex.sheets.length > 0
        ? [
            ...ex.sheets.map((s) => `${s.sheet}: shows existing work, ${plural(s.walls, "wall")} taken off, none compared with a demolition plan — existing walls to remain may be priced as new`),
            ...(ex.compareOn ? [] : ["Plan comparison is off, so nothing on these sheets was set aside as existing."]),
          ]
        : ["No sheet with existing work has walls left uncompared."],
    fix:
      ex.sheets.length === 0
        ? null
        : ex.compareOn
          ? { label: `Pair ${ex.sheets[0]!.sheet} with its demolition plan`, href: `/takeoff/${f.jobId}?page=${ex.sheets[0]!.pageNumber}`, newTab: true }
          : { label: "Turn on plan comparison (Settings, owner)", href: "/settings?tab=estimating#plan-compare", newTab: false },
  });

  return checks;
}

function quantityCheck(f: BidCheckFacts, job: string): BidCheck {
  const q = f.quantities;
  const base = { key: "quantities" as const, title: "Quantities for the building" };
  if (q.wallLf <= 0) return { ...base, open: false, lines: ["No walls on the estimate to check."], fix: null };
  const lines: string[] = [];
  let open = false;
  let fix: BidCheckFix | null = null;

  if (q.grossAreaSqFt === null || q.grossAreaSqFt <= 0) {
    open = true;
    lines.push(`${n0(q.wallLf)} LF of wall, and no floor area on the job to check it against.`);
    fix = { label: "Enter the building's floor area", href: `${job}#job-details`, newTab: false };
  } else {
    const ratio = q.wallLf / q.grossAreaSqFt;
    const said = `${ratio.toFixed(2)} LF of wall per SF of floor (${n0(q.wallLf)} LF over ${n0(q.grossAreaSqFt)} SF).`;
    if (ratio > WALL_LF_PER_FLOOR_SF.high) {
      open = true;
      lines.push(`${said} Interior walls usually run ${WALL_LF_PER_FLOOR_SF.low}–${WALL_LF_PER_FLOOR_SF.high}; more usually means walls counted twice, or a floor area that is one floor of several.`);
    } else if (ratio < WALL_LF_PER_FLOOR_SF.low) {
      open = true;
      lines.push(`${said} Interior walls usually run ${WALL_LF_PER_FLOOR_SF.low}–${WALL_LF_PER_FLOOR_SF.high}; less usually means walls the takeoff missed, or a floor area that counts floors not taken off.`);
    } else lines.push(`${said} Within the usual ${WALL_LF_PER_FLOOR_SF.low}–${WALL_LF_PER_FLOOR_SF.high}.`);
    if (open) fix = { label: "Check the takeoff", href: `/takeoff/${f.jobId}`, newTab: true };
  }

  if (q.boardSqFt !== null && q.wallFaceSqFt > 0) {
    const ratio = q.boardSqFt / q.wallFaceSqFt;
    const said = `${ratio.toFixed(2)} SF of board per SF of wall face (${n0(q.boardSqFt)} SF of board over ${n0(q.wallFaceSqFt)} SF of wall).`;
    if (ratio > BOARD_PER_WALL_SF.high) {
      open = true;
      lines.push(`${said} One layer on one face is 1.0 and two layers on both faces 4.0, plus waste; more means board counted twice, or a layer count or sheet size read wrong.`);
      fix ??= { label: "Check the board lines", href: `${job}/estimate`, newTab: false };
    } else if (ratio < BOARD_PER_WALL_SF.low) {
      open = true;
      lines.push(`${said} One layer on one face is 1.0; less means some walls have no board on the estimate.`);
      fix ??= { label: "Check the board lines", href: `${job}/estimate`, newTab: false };
    } else lines.push(`${said} Within the usual ${BOARD_PER_WALL_SF.low}–${BOARD_PER_WALL_SF.high}.`);
  }
  return { ...base, open, lines, fix };
}

/** "3 checks open", or "All 7 checks clear". */
export function bidCheckSummary(checks: readonly BidCheck[]): string {
  const open = checks.filter((c) => c.open).length;
  return open === 0 ? `All ${checks.length} checks clear` : `${plural(open, "check")} open`;
}

/** Square feet of board on an estimate line: sheets by their printed size (4x8 = 32 when none is printed), or square feet as they are. Null for any other unit. */
export function boardSqFtOf(line: { description: string; quantity: number; unit: string | null }): number | null {
  const unit = (line.unit ?? "").toLowerCase();
  if (/^(sq ?ft|sf)$/.test(unit)) return line.quantity;
  if (!/^(sht|sheets?|ea)$/.test(unit)) return null;
  const size = line.description.match(/\b(\d{1,2})\s*[x×]\s*(\d{1,2})\b/);
  return line.quantity * (size ? Number(size[1]) * Number(size[2]) : 32);
}
