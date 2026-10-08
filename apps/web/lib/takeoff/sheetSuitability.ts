/**
 * ── WHICH SHEETS A WALL TAKEOFF BELONGS ON ──
 *
 * Measured against a 60-page answer key on 2026-10-08: recall on the floor
 * plans was 72.6%, and **a third of everything the pipeline reported was not a
 * wall**. Every one of the ten phantom pages was a MECHANICAL plan, a REFLECTED
 * CEILING plan or an ELEVATION — 13,767 feet invented across them.
 *
 * It was not finding the wrong lines. An M-101 carries the architectural walls
 * repeated in grey as background, and an A-111 does the same under its ceiling
 * grid; the finder reads them correctly and they are REAL walls. They are also
 * the same walls as the A-101, so counting them bids the job twice.
 *
 * That is not a geometry problem and no amount of better geometry fixes it.
 * Nothing in the wall finder knows WHAT KIND OF DRAWING it is looking at.
 *
 * ── THE ANSWER WAS ALREADY IN THE DATABASE ──
 *
 * `PlanSheetProposal.proposedPageType` has held COVER / PLAN / ELEVATION /
 * SECTION / DETAIL / SCHEDULE / OTHER since the ingest was built, and its own
 * schema comment says why it exists: *"'which pages are the schedules?' is the
 * question the takeoff side needs answered"*. The takeoff side never asked.
 * This file is that question being asked.
 *
 * ── IT WARNS, IT DOES NOT BLOCK ──
 *
 * A wall genuinely can be measured on a section or a detail, and a sheet number
 * read by a model can be wrong. So nothing here disables a tool: the manual
 * trace is untouched, and so is the Find-the-walls button. What changes is that
 * the result arrives with the reason it is probably double-counted, named, at
 * the moment somebody is deciding whether to accept it.
 *
 * Refusing outright was the first design and it is the wrong one. A wrong
 * classification would then silently remove a capability, and a reader with no
 * walls on screen has no way to tell "this sheet has none" from "the app
 * decided for me".
 */

/** What the sheet is, as far as this can tell, and what to say about it. */
export type SheetSuitability = {
  /** True when wall quantities from this sheet are probably a double count. */
  likelyDuplicate: boolean;
  /** What kind of sheet this was taken to be — shown to the reader. */
  kind: string;
  /** Why, in the estimator's own terms. Empty when the sheet is a plan. */
  caution: string;
};

const PLAN: SheetSuitability = { likelyDuplicate: false, kind: "floor plan", caution: "" };

/**
 * The disciplines whose sheets repeat the architectural plan underneath their
 * own work. Keyed on the sheet number's leading letters, which is the one
 * convention that holds across every office — M is mechanical, E electrical, P
 * plumbing, FP fire protection, FA fire alarm, T telecom.
 *
 * S (structural) is here for a different reason: the answer key's S-101 carries
 * girders drawn double, which the finder reads as a wall thickness apart.
 * Nothing on it is a stud wall.
 */
const BACKGROUND_DISCIPLINES: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/^M[-\s]?\d/i, "mechanical plan", "the architectural walls repeated in grey under the ductwork"],
  [/^E[-\s]?\d/i, "electrical plan", "the architectural walls repeated in grey under the power plan"],
  [/^P[-\s]?\d/i, "plumbing plan", "the architectural walls repeated in grey under the piping"],
  [/^FP[-\s]?\d/i, "fire protection plan", "the architectural walls repeated in grey under the sprinkler layout"],
  [/^FA[-\s]?\d/i, "fire alarm plan", "the architectural walls repeated in grey under the devices"],
  [/^T[-\s]?\d/i, "telecom plan", "the architectural walls repeated in grey under the cabling"],
  [/^S[-\s]?\d/i, "structural plan", "girders and joists, which are drawn a wall's thickness apart"],
  [/^C[-\s]?\d/i, "civil drawing", "site work rather than the building's partitions"],
  [/^L[-\s]?\d/i, "landscape drawing", "site work rather than the building's partitions"],
];

/**
 * Titles that name a drawing which is not a floor plan.
 *
 * CHECKED BEFORE the generic word "plan", because every one of these contains
 * it: a REFLECTED CEILING PLAN and a MECHANICAL PLAN are both plans and neither
 * is the one a wall is measured on.
 */
const TITLE_RULES: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/REFLECTED\s+CEILING/i, "reflected ceiling plan", "the architectural walls repeated under the ceiling grid"],
  [/\bRCP\b/i, "reflected ceiling plan", "the architectural walls repeated under the ceiling grid"],
  [/ELEVATION/i, "elevation", "floor and parapet lines, and storefront mullions — not partitions in plan"],
  [/\bSECTION/i, "section", "a cut through the building rather than a plan of it"],
  [/SCHEDULE/i, "schedule", "table rules, which pair up as though they were wall faces"],
  [/PARTITION\s+TYPE/i, "partition-type legend", "the wall types drawn as layered lines, not as walls in a building"],
  [/WALL\s+TYPE/i, "partition-type legend", "the wall types drawn as layered lines, not as walls in a building"],
  [/COVER\s+SHEET/i, "cover sheet", "the vicinity map and key plan, which are not the building"],
  [/\bDEMO(LITION)?\b/i, "demolition plan", "walls being removed, which are not the walls being built"],
  [/ROOF\s+PLAN/i, "roof plan", "roof edges and crickets rather than partitions"],
  [/SITE\s+PLAN/i, "site plan", "site work rather than the building's partitions"],
  [/FINISH\s+PLAN/i, "finish plan", "the architectural walls repeated under the finish hatching"],
  [/FURNITURE\s+PLAN/i, "furniture plan", "the architectural walls repeated under the furniture"],
  [/\bMECHANICAL\b/i, "mechanical plan", "the architectural walls repeated in grey under the ductwork"],
  [/\bELECTRICAL\b/i, "electrical plan", "the architectural walls repeated in grey under the power plan"],
  [/\bPLUMBING\b/i, "plumbing plan", "the architectural walls repeated in grey under the piping"],
  [/\bFRAMING\b/i, "framing plan", "girders and joists, which are drawn a wall's thickness apart"],
];

/** `pageType` values that are not a plan at all. */
const PAGE_TYPE_KINDS: Readonly<Record<string, readonly [string, string]>> = {
  ELEVATION: ["elevation", "floor and parapet lines rather than partitions in plan"],
  SECTION: ["section", "a cut through the building rather than a plan of it"],
  SCHEDULE: ["schedule", "table rules, which pair up as though they were wall faces"],
  COVER: ["cover sheet", "the vicinity map and key plan, which are not the building"],
  DETAIL: ["detail sheet", "details drawn at their own scales rather than the building's"],
};

/**
 * Should a wall takeoff on this sheet be trusted as new quantity?
 *
 * All three inputs are optional because all three can be missing: a sheet
 * nobody has numbered, a title the block did not print, a proposal older than
 * the prompt that introduced `pageType`. Missing evidence means PLAN — the
 * caution has to be earned, or an unnumbered sheet would be warned about for no
 * reason anybody could act on.
 */
export function sheetSuitability(
  sheetNumber: string | null | undefined,
  title: string | null | undefined,
  pageType: string | null | undefined,
): SheetSuitability {
  const number = (sheetNumber ?? "").trim();
  const name = (title ?? "").trim();

  // The TITLE first. It is what the drawing calls itself, and it beats both the
  // number and the model's classification — an office that numbers its ceiling
  // plans A-101 still writes REFLECTED CEILING PLAN on them.
  for (const [pattern, kind, caution] of TITLE_RULES) {
    if (pattern.test(name)) return { likelyDuplicate: true, kind, caution };
  }

  // Then the sheet number's discipline letter.
  for (const [pattern, kind, caution] of BACKGROUND_DISCIPLINES) {
    if (pattern.test(number)) return { likelyDuplicate: true, kind, caution };
  }

  // Then what the reader made of the page, which is the weakest of the three
  // because it is a model's answer rather than something printed on the sheet.
  const byType = PAGE_TYPE_KINDS[(pageType ?? "").trim().toUpperCase()];
  if (byType) return { likelyDuplicate: true, kind: byType[0], caution: byType[1] };

  return PLAN;
}

/**
 * The sentence shown above a set of found walls on a sheet that is probably not
 * the one to measure them on.
 *
 * Names the KIND and the REASON rather than saying "this may be wrong": an
 * estimator can check "is this the mechanical sheet?" in a second, and cannot
 * check a warning that does not say what it suspects.
 */
export function duplicateWallsCaution(suitability: SheetSuitability, sheetNumber: string | null): string {
  if (!suitability.likelyDuplicate) return "";
  const named = sheetNumber?.trim() ? `${sheetNumber.trim()} is a ${suitability.kind}` : `This looks like a ${suitability.kind}`;
  return (
    `${named}. What was found here is probably ${suitability.caution} — and where it is real wall, ` +
    `it is the same wall the architectural plan already carries. Adding it would bid those walls twice.`
  );
}
