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
  return head.length === 2 && head[1] === "D" ? head[0] : head;
}

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

/** Past this share across the sheet is the title block. */
const TITLE_STRIP_FROM = 0.85;
/** A line this long, in page widths, is the sheet's border. */
const BORDER_SPAN = 0.55;

/**
 * Every sheet in a set shares its frame, at no shift, so the frame out-votes
 * any real agreement: Baker's A001 scored 175 against A100 and 175 against A101,
 * both at exactly zero. Votes must come from the drawing.
 */
function drawingOnly(lines: readonly Line[]): Line[] {
  return lines.filter((l) => Math.max(l.x1, l.x2) < TITLE_STRIP_FROM && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) < BORDER_SPAN);
}

const flat = (number: string | null) => (number ?? "").toUpperCase().replace(/[-\s]/g, "");
const isDemo = (s: SheetForPairing) => !!s.demoCaption || demoSheetTitle(s.title) || /^(?:[A-Z]D|D[A-Z]?)[-.\d]/i.test(s.sheetNumber ?? "");

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
    const discipline = disciplineOf(demo.sheetNumber);
    const fits = fresh.filter((s) => {
      if (kindOf(s.title) !== kind || !saysPlan(s.title) || SAME_FLOOR_NOT_THE_PLAN.test(s.title ?? "")) return false;
      if (discipline !== null && disciplineOf(s.sheetNumber) !== discipline) return false;
      const otherLevel = levelFromTitle(s.title, "PLAN")?.label ?? null;
      if (level !== null && otherLevel !== null && level !== otherLevel) return false;
      return area === null || areaOfTitle(s.title) === null || areaOfTitle(s.title) === area;
    });
    const align = (page: number) => {
      const a = options.lines?.get(demo.pageNumber), b = options.lines?.get(page);
      return a && b && options.feetPerUnit ? alignViews(drawingOnly(b), drawingOnly(a), options.feetPerUnit) : null;
    };
    const pair = (newPage: number | null, basis: DemoPair["basis"], alternatives: number[]): DemoPair => ({ demoPage: demo.pageNumber, newPage, level, area, basis, alternatives, shift: newPage === null ? null : align(newPage) });

    const byNumber = twinNumbers(demo.sheetNumber).map((twin) => fresh.find((s) => flat(s.sheetNumber) === flat(twin) && !NOT_A_PLAN_SHEET.test(s.title ?? ""))).find((s) => s !== undefined);
    if (byNumber) { out.push(pair(byNumber.pageNumber, "sheet-number", [])); continue; }
    // Past a number, the title has to say something: never pair by elimination on noise.
    if (!saysPlan(demo.title)) { out.push(pair(null, "none", [])); continue; }
    const whole = fits.filter((s) => !isEnlargedPlanTitle(s.title));
    const pool = whole.length > 0 ? whole : fits;
    if (pool.length === 0) { out.push(pair(null, "none", [])); continue; }
    if (pool.length === 1) { out.push(pair(pool[0].pageNumber, "title", [])); continue; }
    const voted = pool.map((s) => ({ page: s.pageNumber, votes: align(s.pageNumber)?.votes ?? 0 })).sort((a, b) => b.votes - a.votes);
    if (voted[0].votes > 0 && voted[0].votes > (voted[1]?.votes ?? 0)) out.push(pair(voted[0].page, "grid", voted.slice(1).map((v) => v.page)));
    else out.push(pair(null, "none", pool.map((s) => s.pageNumber)));
  }
  return out;
}
