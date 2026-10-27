import type { SheetRow } from "@/lib/plan-ingest/sheetIndex";

/**
 * ── THE SHEET TREE: WHICH SHEETS THERE ARE, AND WHICH ONE YOU WANT ──
 *
 * A real set is 55 to 175 sheets and an estimator wants four of them. The flat
 * list this replaces made that a scrolling problem, measured at TWENTY presses
 * of Next to reach `A-101` on a 52-sheet set.
 *
 * Pure functions, no React and no DOM, because every decision here is a rule
 * somebody will disagree with — which letter means what, when a scale counts
 * as set — and a rule you can disagree with is a rule worth testing.
 *
 * ── NOTHING HERE IS STORED ──
 *
 * The discipline, the group, the status and the counts are all derived on
 * every read, from rows that already exist. `takeoff.prisma` states the reason
 * at length for its own columns and it holds here too: a stored grouping is a
 * grouping that was true against a sheet number somebody has since corrected,
 * and correcting one is the entire point of the sheet index.
 */

/**
 * What a discipline letter is called.
 *
 * FROM THE SHEET NUMBER'S OWN PREFIX, which is a drafting convention rather
 * than anything we invented — the US National CAD Standard's discipline
 * designators. The list is deliberately short: a letter nobody uses costs a
 * reader nothing, and a letter we guess wrong at costs them trust in the
 * grouping. Anything unrecognised keeps its own letter as the heading, which
 * is honest, rather than being swept into "Other" where it cannot be found.
 */
const DISCIPLINE_NAMES: Record<string, string> = {
  G: "General",
  H: "Hazardous materials",
  V: "Survey and mapping",
  B: "Geotechnical",
  C: "Civil",
  L: "Landscape",
  S: "Structural",
  A: "Architectural",
  I: "Interiors",
  Q: "Equipment",
  F: "Fire protection",
  P: "Plumbing",
  D: "Process",
  M: "Mechanical",
  E: "Electrical",
  W: "Distributed energy",
  T: "Telecommunications",
  R: "Resources",
  X: "Other disciplines",
  Z: "Contractor/shop drawings",
};

/**
 * The order the groups appear in, which is the National CAD Standard's own
 * order rather than alphabetical — it runs roughly outside-in and then by
 * trade, which is the order a set is printed in and therefore the order an
 * estimator expects to scroll past. Anything not on this list sorts after it,
 * alphabetically.
 *
 * **STRUCTURAL COMES BEFORE ARCHITECTURAL**, which looks like a typo and is
 * not. The test asserting this order was written expecting G-A-S from habit
 * and FAILED against the standard; the code was right and the expectation was
 * wrong. Do not "fix" it back.
 *
 * `H` is on the list because a real set in this repo's own fixtures uses it —
 * Camp Bow Wow ships `H-96037`.
 */
const DISCIPLINE_ORDER = [
  "G", "H", "V", "B", "C", "L", "S", "A", "I", "Q",
  "F", "P", "D", "M", "E", "W", "T", "R", "X", "Z",
];

/** Where a sheet with no readable number ends up. */
export const UNFILED = "—";

export type SheetScaleStatus = "set" | "confirm" | "missing";

export type TreeSheet = {
  pageNumber: number;
  /** `A-101`, or null when nothing has been read and nobody has typed one. */
  sheetNumber: string | null;
  title: string | null;
  discipline: string;
  scaleStatus: SheetScaleStatus;
  /** The printed scale, when one was read — shown beside a `confirm`. */
  printedScale: string | null;
  /** How many measurements sit on this sheet. */
  itemCount: number;
  isScan: boolean;
  bookmarked: boolean;
  /** True when the sheet's number and title say it is a plan an estimator measures — ranked first while it still needs a scale. */
  isPlan: boolean;
};

/**
 * ── WHICH SHEETS ARE THE ONES TO SCALE ──
 *
 * "65 need a scale" was true and useless: two of Baker's 65 are floor plans.
 * A sheet counts as a plan when it is an A-sheet whose title says plan and no
 * title word says it is a plan of something else (the ceiling, the roof, the
 * site, the framing), or an A-1xx sheet with no title read yet.
 * `sheetSuitability` knows the disciplines that repeat the architectural plan;
 * this is the title's half of the same question.
 */
const PLAN_TITLE = /\b(?:PLANS?|LEVEL\s+\d|(?:FIRST|SECOND|THIRD|GROUND|MAIN|UPPER|LOWER)\s+FLOOR)\b/i;
const NOT_A_FLOOR_PLAN =
  /REFLECTED|CEILING|\bRCP\b|ROOF|SITE|KEY\s*PLAN|DEMO|FRAMING|FOUNDATION|ELECTRICAL|MECHANICAL|PLUMBING|LIGHTING|POWER|HVAC|FIRE|LANDSCAP|GRADING|CIVIL|STRUCTURAL|FINISH\s+PLAN|FURNITURE|ENLARGED|CODE\s+PLAN|LIFE\s+SAFETY/i;
export function looksLikeFloorPlan(sheetNumber: string | null, title: string | null, discipline: string): boolean {
  if (discipline !== "A") return false;
  const name = (title ?? "").trim();
  if (name !== "") return PLAN_TITLE.test(name) && !NOT_A_FLOOR_PLAN.test(name);
  return /^A-?1\d\d/i.test((sheetNumber ?? "").trim());
}

export type TreeGroup = {
  /** The discipline letter, or UNFILED. */
  key: string;
  /** "Architectural", or the letter itself when we do not recognise it. */
  name: string;
  sheets: TreeSheet[];
};

/**
 * The discipline letter for a row.
 *
 * INGEST'S OWN ANSWER FIRST. `PlanSheetProposal.proposedDiscipline` is filled
 * by the title-block pass, which has read the sheet rather than its number,
 * so it knows that `H-96037` is a hospital-standard detail sheet when the
 * prefix alone would only say "H".
 *
 * THEN THE NUMBER'S PREFIX, which is the letters before the first digit or
 * separator: `A-101` and `A4.B.1` are both `A`, `SP-1` is `SP`. Taking only
 * the FIRST letter would merge `S` (structural) and `SP` (site plan) and
 * taking the whole run before a dash would split `A-101` from `A4.B.1`.
 */
export function disciplineOf(row: SheetRow): string {
  const fromIngest = row.proposal?.discipline?.trim();
  if (fromIngest) return fromIngest.toUpperCase();

  const number = (row.proposal?.acceptedSheetNumber ?? row.proposal?.sheetNumber ?? "").trim();
  const prefix = /^([A-Za-z]+)/.exec(number);
  if (!prefix) return UNFILED;
  return prefix[1].toUpperCase();
}

/** The heading for a discipline key — its name, or the key itself. */
export function disciplineName(key: string): string {
  if (key === UNFILED) return "Not filed";
  return DISCIPLINE_NAMES[key] ?? key;
}

/**
 * Whether a sheet can be measured on, in three states rather than two.
 *
 * The middle one is the point. A sheet whose PRINTED scale has been read but
 * which nobody has calibrated is not the same as a sheet with no scale at all:
 * one is a click away from usable and the other needs somebody to find a
 * dimension on the drawing. Collapsing them into "no scale" is what made an
 * estimator open eleven sheets to find the two that needed real work.
 *
 * `set` means a CALIBRATION exists, which is a person's answer and the only
 * thing any measurement is computed against. A printed scale is never promoted
 * to a calibration automatically — `takeoff.prisma` keeps measurements on a
 * calibration precisely so a re-scale cannot silently restate old numbers.
 */
export function scaleStatusOf(
  pageNumber: number,
  calibratedPages: ReadonlySet<number>,
  printedScaleByPage: Readonly<Record<number, string | null | undefined>>,
): SheetScaleStatus {
  if (calibratedPages.has(pageNumber)) return "set";
  if (printedScaleByPage[pageNumber]) return "confirm";
  return "missing";
}

export type TreeInput = {
  rows: readonly SheetRow[];
  calibratedPages: ReadonlySet<number>;
  printedScaleByPage: Readonly<Record<number, string | null | undefined>>;
  measurementCountByPage: Readonly<Record<number, number>>;
  bookmarks: ReadonlySet<number>;
  /** Free text from the search box; matched against number and title. */
  search?: string;
  /** When true, only sheets that are bookmarked or carry measurements. */
  onlyMine?: boolean;
  /** Rank the floor plans still needing a scale first in their group (the plan-text opt-in). */
  rankPlans?: boolean;
};

/**
 * Does this sheet match what was typed?
 *
 * NUMBER AND TITLE, case-insensitively, and the PAGE NUMBER as a whole word.
 * The last one matters more than it looks: on a set whose title blocks did not
 * read, the page number is the only handle a person has, and typing `23`
 * should not also return sheets 123 and 230 — which a substring match on
 * `String(pageNumber)` would.
 */
function matches(sheet: TreeSheet, needle: string): boolean {
  if (!needle) return true;
  const hay = `${sheet.sheetNumber ?? ""} ${sheet.title ?? ""}`.toLowerCase();
  if (hay.includes(needle)) return true;
  return String(sheet.pageNumber) === needle;
}

/**
 * The grouped, filtered tree.
 *
 * EMPTY GROUPS ARE DROPPED, so a search narrows the headings too — a list of
 * sixteen disciplines with one sheet under one of them is a worse answer than
 * one heading. The group ORDER is the standard's, not the match count's: a
 * result list that reorders itself as you type cannot be aimed at.
 */
/** The sheets the rail exists to surface: a plan with no scale set yet. */
export function toScale(sheet: TreeSheet): boolean {
  return sheet.isPlan && sheet.scaleStatus !== "set";
}

export function buildSheetTree(input: TreeInput): TreeGroup[] {
  const needle = (input.search ?? "").trim().toLowerCase();

  const sheets: TreeSheet[] = input.rows.map((row) => {
    const accepted = row.proposal?.acceptedSheetNumber ?? null;
    const proposed = row.proposal?.sheetNumber ?? null;
    const acceptedTitle = row.proposal?.acceptedTitle ?? null;
    return {
      pageNumber: row.pageNumber,
      sheetNumber: accepted ?? proposed,
      title: acceptedTitle ?? row.proposal?.title ?? null,
      discipline: disciplineOf(row),
      scaleStatus: scaleStatusOf(row.pageNumber, input.calibratedPages, input.printedScaleByPage),
      printedScale: input.printedScaleByPage[row.pageNumber] ?? null,
      itemCount: input.measurementCountByPage[row.pageNumber] ?? 0,
      isScan: !row.hasTextLayer,
      bookmarked: input.bookmarks.has(row.pageNumber),
      isPlan: looksLikeFloorPlan(accepted ?? proposed, acceptedTitle ?? row.proposal?.title ?? null, disciplineOf(row)),
    };
  });

  const kept = sheets.filter((sheet) => {
    if (input.onlyMine && !sheet.bookmarked && sheet.itemCount === 0) return false;
    return matches(sheet, needle);
  });

  const byKey = new Map<string, TreeSheet[]>();
  for (const sheet of kept) {
    const list = byKey.get(sheet.discipline);
    if (list) list.push(sheet);
    else byKey.set(sheet.discipline, [sheet]);
  }

  const rank = (key: string) => {
    const at = DISCIPLINE_ORDER.indexOf(key);
    // Unrecognised letters after the standard's list, UNFILED last of all.
    return at === -1 ? (key === UNFILED ? 1_000_000 : 1_000 + key.charCodeAt(0)) : at;
  };

  // With the ranking on, a GROUP holding a plan to scale rises above the
  // groups that hold none — otherwise "listed first" means first inside
  // ARCHITECTURAL, two groups below the top of the rail on any real set.
  const holdsPlanToScale = (list: TreeSheet[]) => (input.rankPlans ? Number(!list.some(toScale)) : 0);
  return [...byKey.entries()]
    .sort(([a, la], [b, lb]) => holdsPlanToScale(la) - holdsPlanToScale(lb) || rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, list]) => ({
      key,
      name: disciplineName(key),
      // A plan that still needs its scale comes first — it is the sheet the
      // estimator opened the list to find — then the page order of the file,
      // which is the order the set was issued in and the only order both
      // numbered and unnumbered sheets share.
      sheets: list.sort(
        (a, b) => (input.rankPlans ? Number(!toScale(a)) - Number(!toScale(b)) : 0) || a.pageNumber - b.pageNumber,
      ),
    }));
}

/**
 * How far through the set somebody is, for the workspace's home view.
 *
 * "Done" is a sheet WITH MEASUREMENTS, not a sheet with a scale. A calibrated
 * sheet nobody has traced is work set up, not work finished, and a progress
 * bar that counts it is a progress bar that reads 100% before anything has
 * been taken off.
 */
/**
 * The printed scales the rail can apply in one press: every sheet that prints
 * a scale and has none set yet, grouped by what it prints, most sheets first.
 */
export function printedScaleOffers(groups: readonly TreeGroup[]): { scale: string; pages: number[] }[] {
  const byScale = new Map<string, number[]>();
  for (const sheet of groups.flatMap((group) => group.sheets)) {
    if (sheet.scaleStatus !== "confirm" || !sheet.printedScale) continue;
    const list = byScale.get(sheet.printedScale);
    if (list) list.push(sheet.pageNumber);
    else byScale.set(sheet.printedScale, [sheet.pageNumber]);
  }
  return [...byScale.entries()]
    .map(([scale, pages]) => ({ scale, pages: pages.sort((a, b) => a - b) }))
    .sort((a, b) => b.pages.length - a.pages.length || a.scale.localeCompare(b.scale));
}

export function takeoffProgress(groups: readonly TreeGroup[]): {
  sheets: number;
  started: number;
  scaled: number;
  needScale: number;
  /** Floor plans (by number and title) still without a scale — the sheets the rail ranks first. */
  plansToScale: number;
} {
  const all = groups.flatMap((group) => group.sheets);
  return {
    sheets: all.length,
    started: all.filter((sheet) => sheet.itemCount > 0).length,
    scaled: all.filter((sheet) => sheet.scaleStatus === "set").length,
    needScale: all.filter((sheet) => sheet.scaleStatus !== "set").length,
    plansToScale: all.filter(toScale).length,
  };
}
