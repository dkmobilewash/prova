import { levelFromTitle } from "../plan-ingest/sheetLevel";
import { areaOfTitle, isEnlargedPlanTitle } from "../plan-ingest/walls";
import { demoSheetTitle } from "./demoWalls";
import { alignViews, type Line } from "./viewAlign";

export { demoEvidence } from "./demoWalls";

export type SheetForPairing = {
  pageNumber: number;
  sheetNumber: string | null;
  title: string | null;
  /** What `demoEvidence` read off the sheet, for a demolition plan its title does not admit to. */
  demoCaption?: string | null;
};

export type DemoPair = {
  demoPage: number;
  /** The new plan, or null when the set cannot say which. A wrong pair is worse than none. */
  newPage: number | null;
  level: string | null;
  area: string | null;
  /** How it was decided. `grid` means the drawings' own lines chose among candidates. */
  basis: "sheet-number" | "title" | "grid" | "none";
  /** Other plans that also fit, for a screen or a caller to offer. */
  alternatives: number[];
  /**
   * The best new plan for this demolition plan. False on a row for another
   * plan the same demolition plan truly aligns with: Bunkie's AD101 lies on A100
   * and A101 alike, so asking for either sheet's demolition plan has an answer.
   */
  primary: boolean;
  /** Page-width units to move the demolition plan onto the new one, where lines were given. */
  shift: { dx: number; dy: number; votes: number } | null;
};

type Kind = "floor" | "ceiling" | "roof" | "site" | "other";

function kindOf(title: string | null): Kind {
  const text = (title ?? "").toUpperCase();
  if (/\b(SECTIONS?|ELEVATIONS?|DETAILS?|SCHEDULES?|NOTES|LEGEND|COVER|INDEX)\b/.test(text) && !/\bPLANS?\b/.test(text)) return "other";
  if (/\b(REFLECTED|CEILING|RCP)\b/.test(text)) return "ceiling";
  if (/\bROOF\b/.test(text)) return "roof";
  if (/\bSITE\b/.test(text)) return "site";
  return "floor";
}

/** The sheet's discipline, past the D a demolition sheet adds: AD101 and D100 are A, ED1.01 is E. */
function disciplineOf(number: string | null): string | null {
  const head = /^([A-Z]{1,3})/.exec((number ?? "").toUpperCase())?.[1] ?? null;
  if (head === null) return null;
  if (head === "D" || head === "DA" || head === "AD") return "A";
  if (head.length === 2 && head[1] === "D") return head[0];
  // Every series an architect numbers with an A is architectural: Bluetooth's interiors are AI101,
  // its finishes AF101, beside its demolition plan AD101 (2026-11-12: AI101 was never paired).
  return head.startsWith("A") ? "A" : head;
}

/** A demolition title that names another trade keeps that trade's letter. */
const TRADE_TITLE = /\b(ELECTRICAL|MECHANICAL|PLUMBING|FIRE\s+PROTECTION|SPRINKLER|LIGHTING|POWER|HVAC|STRUCTURAL)\b/i;

/**
 * The demolition sheet's discipline among the set's new sheets. ED1.01 is electrical in a set
 * with E sheets (Wendell's ED101 → E102). In a set with none, and under a title that names no
 * trade, the E is the architect's "existing": Falafel Fresh's ED2.20 "EXISTING / DEMO PLANS"
 * belongs to A2.20, and was never paired.
 */
function demoDiscipline(demo: SheetForPairing, fresh: readonly SheetForPairing[]): string | null {
  const discipline = disciplineOf(demo.sheetNumber);
  if (discipline === null || discipline === "A" || TRADE_TITLE.test(demo.title ?? "")) return discipline;
  return fresh.some((s) => disciplineOf(s.sheetNumber) === discipline) ? discipline : "A";
}

/** A sheet number past its letters: AD101 → 101, ED2.20 → 2.20, A-101 → 101. */
const numberPart = (number: string | null) => (number ?? "").toUpperCase().replace(/^[A-Z]+-?/, "").trim();

/** The new sheets a demolition number can twin with: AD101 to A101, ED1.01 to E1.01, D100 to A100, DA2.1 to AA2.1 (building A) or A2.1. */
function twinNumbers(number: string | null): string[] {
  const text = (number ?? "").toUpperCase().trim();
  const match = /^(?:([A-Z])D|D([A-Z])?)([-.\d].*)$/.exec(text);
  if (match === null) return [];
  const rest = match[3].replace(/-/g, "");
  return match[2] ? [`A${match[2]}${rest}`, `${match[2]}${rest}`] : [`${match[1] ?? "A"}${rest}`];
}

/**
 * Drawn on the same floor, so they align as well as the floor plan does, and
 * are not it. E Street's demolition plan out-voted to its slab plan; McAllen's
 * to its finish plan; Murray's to a furniture plan.
 */
const SAME_FLOOR_NOT_THE_PLAN = /\b(SLAB|FINISH(ES)?|FURNITURE|FF&E|FOUNDATION|FRAMING|ENCLOSURE|SIGNAGE|EGRESS|LIFE SAFETY|CODE|EXISTING CONDITIONS?)\b/i;
/** A title worth pairing on says what the sheet draws. "BUILDING A" and "BID DOCUMENTS" do not. */
const saysPlan = (title: string | null) => /\b(PLANS?|LEVEL|FLOOR)\b/i.test(title ?? "");

/** A twin number loses to a title that plainly says it is not a plan. Green Bay's A1.0 is the architectural information sheet. */
const NOT_A_PLAN_SHEET = /\b(INFORMATION|INDEX|GENERAL NOTES|ABBREVIATIONS|SYMBOLS)\b/i;

/** A second plan needs this many agreeing walls to be called the same floor: a shared frame or a stair gives fewer. */
export const SECOND_PLAN_MIN_VOTES = 8;
/** Past this share across the sheet is the title block. */
const TITLE_STRIP_FROM = 0.85;
/** A line this long, in page widths, is the sheet's border. */
const BORDER_SPAN = 0.55;

/**
 * Every sheet in a set shares its frame, at no shift, so the frame out-votes
 * any real agreement: Baker's A001 scored 175 against A100 and 175 against A101,
 * both at exactly zero. Votes must come from the drawing.
 */
export function drawingOnly(lines: readonly Line[]): Line[] {
  return lines.filter((l) => Math.max(l.x1, l.x2) < TITLE_STRIP_FROM && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) < BORDER_SPAN);
}

/** A new plan that could be this demolition plan's floor: same drawing kind, discipline, level and area, and a plan. */
function fitsDemo(demo: SheetForPairing, s: SheetForPairing, discipline: string | null = disciplineOf(demo.sheetNumber)): boolean {
  const level = levelFromTitle(demo.title, "PLAN")?.label ?? null;
  const area = areaOfTitle(demo.title);
  if (kindOf(s.title) !== kindOf(demo.title) || !saysPlan(s.title) || SAME_FLOOR_NOT_THE_PLAN.test(s.title ?? "")) return false;
  if (discipline !== null && disciplineOf(s.sheetNumber) !== discipline) return false;
  const otherLevel = levelFromTitle(s.title, "PLAN")?.label ?? null;
  if (level !== null && otherLevel !== null && level !== otherLevel) return false;
  return area === null || areaOfTitle(s.title) === null || areaOfTitle(s.title) === area;
}

/**
 * The demolition plans of the set that could be `newPage`'s floor by their
 * titles alone — the candidates for a suggestion, never a pairing: the
 * drawings still have to line up (`suggestPriorPlan`).
 */
export function demoPlansFor(sheets: readonly SheetForPairing[], newPage: number): number[] {
  const page = sheets.find((s) => s.pageNumber === newPage);
  if (page === undefined || isDemo(page)) return [];
  // A sheet that draws the site AND a demolition plan is a demolition plan too
  // (W8th's D201, "ARCHITECTURAL SITE PLAN & LEVEL 1 DEMOLITION PLAN"): its
  // site half is not what the offer is about.
  const demos = sheets.filter(isDemo).map((d) => {
    const title = d.demoCaption ?? d.title;
    return { ...d, title: title !== null && /\bDEMOLITION\s+PLAN\b/i.test(title) ? title.replace(/\bSITE\s+PLAN\b/gi, "") : title };
  });
  const kind = (d: SheetForPairing) => kindOf(d.title);
  const byTitle = demos.filter((d) => kind(d) !== "other" && kind(d) !== "site" && fitsDemo(d, page));
  if (byTitle.length > 0) return byTitle.map((d) => d.pageNumber);
  // ── THE TITLES SAY NOTHING: OFFER BY SHEET NUMBER, FOR THE DRAWINGS TO DECIDE ──
  // Bunkie's inventory reads every title as "BID DOCUMENTS", Green Bay's A3.1
  // none at all, so no title admits a candidate. Then the demolition sheets of
  // the same discipline (AD101 for A100, never MD1.1 or ED1.0) are candidates,
  // and `linedUpDemo` — the drawings lining up, never a title — chooses or not.
  const silent = (title: string | null) => !saysPlan(title) && kindOf(title) === "floor";
  if (!silent(page.title)) return [];
  const discipline = disciplineOf(page.sheetNumber);
  return demos.filter((d) => discipline !== null && disciplineOf(d.sheetNumber) === discipline && (silent(d.title) || kind(d) === "floor")).map((d) => d.pageNumber);
}

const flat = (number: string | null) => (number ?? "").toUpperCase().replace(/[-\s]/g, "");
const isDemo = (s: SheetForPairing) => !!s.demoCaption || demoSheetTitle(s.title) || /^(?:[A-Z]D|D[A-Z]?)[-.\d]/i.test(s.sheetNumber ?? "");

/** A plan of what is there now, not what is built: Macon-Bibb's A1-0 "FLOOR PLAN - EXISTING". */
const EXISTING_ONLY = (title: string | null) => /\bEXISTING\b/i.test(title ?? "") && !/\bNEW\b/i.test(title ?? "");

/**
 * ── OF THE PLANS THE TITLES ALLOW, THE NEW PLAN OF THE SAME EXTENT ──
 *
 * The title filters keep every plan of the right kind, level and discipline,
 * and a tie pairs nothing. Round 22 found three renovation sheets unpaired
 * that way:
 *   - UCCS's AD2.1 "DEMOLITION FLOOR PLAN - OVERALL" tied A2.1.1 OVERALL with
 *     its three AREA sheets, which are drawn at 1/8" against the overall's
 *     smaller scale. Comparison reads the demolition plan at the new sheet's
 *     scale, so only the whole floor is its pair.
 *   - Macon-Bibb's AD-1 tied A1-1 "FLOOR PLAN - NEW WORK" with A1-0 "FLOOR
 *     PLAN - EXISTING" and a canopy plan.
 * So a whole-floor demolition plan keeps the whole-floor plans, a plan only of
 * what EXISTS drops out, and a plan that says NEW wins. Each step only narrows,
 * and is skipped if it would empty the pool, so a tie it cannot break still
 * pairs nothing.
 */
function theNewFloor(pool: readonly SheetForPairing[], demo: SheetForPairing): readonly SheetForPairing[] {
  let kept = pool;
  const narrow = (keep: (s: SheetForPairing) => boolean) => {
    const k = kept.filter(keep);
    if (k.length > 0) kept = k;
  };
  if (areaOfTitle(demo.title) === null) narrow((s) => areaOfTitle(s.title) === null);
  narrow((s) => !EXISTING_ONLY(s.title));
  narrow((s) => /\bNEW\b/i.test(s.title ?? ""));
  return kept;
}

/**
 * Pairs each demolition plan in a set with the new plan of the same level.
 * This is the one pairer: demolition takeoff and plan comparison both use it.
 * Pass `demoCaption` from `demoEvidence` to find plans the titles hide.
 *
 * A twin sheet number decides first, then discipline, drawing kind, level and
 * area from the titles. Where several plans remain, the drawings' own lines
 * choose by `alignViews` votes when `lines` is given, an enlarged plan losing
 * to a whole floor. With nothing to choose by it returns no pair and names the
 * candidates: it never guesses.
 */
export function pairDemoWithNewPlan(
  sheets: readonly SheetForPairing[],
  options: { lines?: ReadonlyMap<number, readonly Line[]>; feetPerUnit?: number } = {},
): DemoPair[] {
  const fresh = sheets.filter((s) => !isDemo(s));
  const out: DemoPair[] = [];
  for (const sheet of sheets.filter(isDemo)) {
    // A caption says what the drawing is better than a title that says otherwise.
    const demo = { ...sheet, title: sheet.demoCaption ?? sheet.title };
    const kind = kindOf(demo.title);
    if (kind === "other" || kind === "site") continue;
    const level = levelFromTitle(demo.title, "PLAN")?.label ?? null;
    const area = areaOfTitle(demo.title);
    const fits = fresh.filter((s) => fitsDemo(demo, s, demoDiscipline(demo, fresh)));
    const align = (page: number) => {
      const a = options.lines?.get(demo.pageNumber), b = options.lines?.get(page);
      return a && b && options.feetPerUnit ? alignViews(drawingOnly(b), drawingOnly(a), options.feetPerUnit) : null;
    };
    const pair = (newPage: number | null, basis: DemoPair["basis"], alternatives: number[]): DemoPair => ({ demoPage: demo.pageNumber, newPage, level, area, basis, alternatives, primary: true, shift: newPage === null ? null : align(newPage) });
    /** One row for the best plan, and one for each other plan that aligns at least as well as the floor. */
    const withOthers = (best: DemoPair, pool: readonly SheetForPairing[]) => {
      out.push(best);
      for (const s of pool) {
        if (s.pageNumber === best.newPage) continue;
        const shift = align(s.pageNumber);
        if (shift !== null && shift.votes >= SECOND_PLAN_MIN_VOTES) out.push({ ...best, newPage: s.pageNumber, basis: "grid", alternatives: [], primary: false, shift });
      }
    };

    // The twin number first (AD101 → A101); else the same number in the demolition plan's own
    // series among the plans it fits (AD101 → AI101, ED2.20 → A2.20 where E is "existing").
    const digits = numberPart(demo.sheetNumber);
    const byNumber =
      twinNumbers(demo.sheetNumber).map((twin) => fresh.find((s) => flat(s.sheetNumber) === flat(twin) && !NOT_A_PLAN_SHEET.test(s.title ?? ""))).find((s) => s !== undefined) ??
      (digits === "" ? undefined : fits.find((s) => numberPart(s.sheetNumber) === digits));
    const sameFloor = fits.filter((s) => !isEnlargedPlanTitle(s.title));
    if (byNumber) { withOthers(pair(byNumber.pageNumber, "sheet-number", []), sameFloor); continue; }
    // Past a number, the title has to say something: never pair by elimination on noise.
    if (!saysPlan(demo.title)) { out.push(pair(null, "none", [])); continue; }
    const whole = fits.filter((s) => !isEnlargedPlanTitle(s.title));
    const pool = theNewFloor(whole.length > 0 ? whole : fits, demo);
    if (pool.length === 0) { out.push(pair(null, "none", [])); continue; }
    if (pool.length === 1) { out.push(pair(pool[0].pageNumber, "title", [])); continue; }
    const voted = pool.map((s) => ({ page: s.pageNumber, votes: align(s.pageNumber)?.votes ?? 0 })).sort((a, b) => b.votes - a.votes);
    if (voted[0].votes > 0 && voted[0].votes > (voted[1]?.votes ?? 0)) withOthers(pair(voted[0].page, "grid", voted.slice(1).map((v) => v.page)), pool);
    else out.push(pair(null, "none", pool.map((s) => s.pageNumber)));
  }
  return out;
}
