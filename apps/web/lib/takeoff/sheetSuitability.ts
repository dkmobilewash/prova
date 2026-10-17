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

/**
 * ── MORE THAN ONE DRAWING, AT MORE THAN ONE SCALE, ON ONE SHEET ──
 *
 * A plan with an enlarged detail beside it prints TWO scales and both are
 * correct. Every length this app reports comes from ONE of them, because a
 * sheet has one calibration — so a quantity taken off the other drawing is out
 * by the ratio between them, silently, and a 1/4in plan beside a 1/2in detail
 * puts that at DOUBLE.
 *
 * Nothing here protects against that today and one thing accidentally does:
 * `wallsInTheBuilding` keeps only the biggest connected group, so on S15 the
 * enlarged bath is dropped because it is SMALLER, not because anybody noticed
 * it was drawn at a different scale. That is the right answer for the wrong
 * reason, and it inverts the moment the detail is the bigger drawing.
 *
 * So this says it rather than fixing it, for the reason this whole file says
 * things rather than fixing them: the measurement is not wrong — it is right
 * about one drawing — and an estimator who is TOLD which one can act on it in
 * a second, where an app that silently measured the other cannot be caught at
 * all.
 *
 * `printedScalesOnPage` is what finds them, and it already refuses metric
 * (`1:100`), `AS NOTED` and `NTS`, so this fires on a genuine second
 * ARCHITECTURAL scale and nothing else. Measured across the 20-sheet fixture
 * set: exactly one sheet — S15, the one that has two — and no other sheet
 * produces more than one.
 */
export function multiScaleCaution(printedScales: readonly string[], usedScaleName: string | null): string {
  const distinct = [...new Set(printedScales.map((one) => one.trim()).filter(Boolean))];
  if (distinct.length < 2) return "";
  const used = usedScaleName?.trim() ?? "";
  // THE ONE IN USE NAMED SEPARATELY, and the others listed — an estimator
  // checks "which drawing did this come off" against a caption on the sheet,
  // so the sentence has to carry the caption's own words.
  const others = distinct.filter((one) => one !== used);
  const list = distinct.join(" and ");
  if (used === "" || others.length === distinct.length) {
    return (
      `This sheet prints more than one scale — ${list}. Every length here was measured at a single ` +
      `scale, so anything taken off the other drawing is out by the ratio between them. Check which ` +
      `drawing a quantity came from before you bid it.`
    );
  }
  return (
    `This sheet prints more than one scale — ${list}. Every length here was measured at ${used}, which ` +
    `is the one captioned under the main drawing. A quantity read off ${others.join(" or ")} would be out ` +
    `by the ratio between them. Check which drawing a quantity came from before you bid it.`
  );
}

/**
 * The sentence for a sheet that was SPLIT into views and measured per view.
 *
 * It replaces `multiScaleCaution`'s warning with a RESULT. That one says "this
 * sheet prints two scales, check which drawing a quantity came from", which is
 * the best that can be said before the sheet has been split. Once each view has
 * been measured at its own scale there is something better to say: here is the
 * other drawing, here is its scale, here is what it measures, and it is NOT in
 * your total.
 *
 * Why the footage rather than just the name: "there is an enlarged bath plan"
 * invites a person to go and check whether it was counted. "28 ft, not added"
 * answers that, and an estimator who disagrees can act on the number.
 *
 * Not added, because an ENLARGED view is the same construction drawn larger —
 * see `primaryView`. Summing them would bid that bathroom twice.
 */
export function viewsMeasuredCaution(
  primary: { name: string; scaleName: string | null } | null,
  others: readonly { name: string; scaleName: string | null; lengthFeet: number }[],
  excluded: readonly { name: string; reason: string }[] = [],
): string {
  // AN EXCLUDED DRAWING IS ENOUGH ON ITS OWN to need a sentence. A sheet with
  // one plan and one NTS detail has no second MEASURED view, and the detail
  // still has to be named — which is the case the first version silently
  // skipped, because it returned early on `others.length === 0`.
  if (primary === null || (others.length === 0 && excluded.length === 0)) return "";
  const measured = others
    .map((one) => `${one.name} at ${one.scaleName ?? "an unstated scale"} measures ${Math.round(one.lengthFeet)} ft`)
    .join("; ");
  const left = excluded.map((one) => `${one.name} — ${one.reason}`).join("; ");

  const head =
    `This sheet carries more than one drawing. The quantities here are ${primary.name} at ` +
    `${primary.scaleName ?? "an unstated scale"}.`;
  const alsoMeasured =
    measured === ""
      ? ""
      : ` Also on the sheet: ${measured} — measured at its own scale and NOT included, because an ` +
        `enlarged view is usually the same construction drawn larger. Add it only if it is a different ` +
        `part of the building.`;
  // NAMED EVEN THOUGH THERE IS NO FIGURE, which is the point of it: a drawing
  // with no scale has nothing to report EXCEPT that it was left out.
  const alsoLeft = left === "" ? "" : ` Left out of the quantities: ${left}.`;
  return head + alsoMeasured + alsoLeft;
}

/**
 * Which of the three cautions a sheet shows — and there is only ever one slot.
 *
 * ── THE SERVER'S ANSWER WINS, AND THAT IS THE WHOLE RULE ──
 *
 * Two readings of the same question reach the viewer. One comes from a
 * `PlanSheetProposal`: a model read the title block and an estimator may have
 * corrected it on the sheet review, so it carries a human's judgement. The
 * other is read off the drawing in the browser by `sheetNumberFrom`, which is
 * deterministic, free, and available on sets the model stage never reached —
 * but it is still a heuristic over a corner of a page.
 *
 * So the read one FILLS A SILENCE rather than competing: where the server has
 * something, that is what an estimator already agreed to, and showing a second
 * sentence that says the same thing in different words is how a caution starts
 * being skipped.
 *
 * ── A FUNCTION, AND NOT AN `||` IN THE JSX ──
 *
 * It was an `||` in the JSX and three mutations survived it: never rendering
 * the element, dropping the read half, and INVERTING the precedence. All three
 * were invisible because the same two names appear twice over in that markup —
 * once in the guard and once in the value — so a source census could not tell
 * which it was looking at. A named function makes the precedence a thing a test
 * can hold still, and leaves the markup with one name in it.
 */
export function cautionToShow(
  fromServer: string | undefined,
  fromDrawing: string | undefined,
  fromScales: string | undefined = undefined,
): string {
  // ── AND THE SCALE ONE OUTRANKS BOTH, WHICH IS A DIFFERENT RULE FROM THE ONE
  // ABOVE AND NEEDS ITS OWN REASON ──
  //
  // The two readings above answer the same question (what kind of sheet is
  // this), so the better-sourced one wins and the other is redundant. The scale
  // caution answers a DIFFERENT question, and it is the more expensive one to
  // get wrong: a duplicate-walls caution is about a correct quantity in the
  // wrong place, which an estimator can still recognise on screen, while a
  // wrong scale makes every number here meaningless by a factor of two and
  // looks exactly like a right one.
  //
  // It is first rather than additional because the slot is still one slot —
  // stacking sentences above a drawing is how both of them stop being read.
  return (fromScales ?? "").trim() || (fromServer ?? "").trim() || (fromDrawing ?? "").trim() || "";
}


/**
 * ── WHICH SHEETS TO TAKE OFF FIRST, AND WHY STROKE COUNT IS THE WRONG ANSWER ──
 *
 * `sheetSuitability` answers "is this sheet a double count" — a yes or no about
 * ONE sheet. This answers a different question: given a set, which sheets would
 * an estimator actually price?
 *
 * It exists because the real-plan report was ranking by STROKE COUNT, and on
 * the ELEVEN03 set that picked four LIFE SAFETY plans and dropped every
 * architectural floor plan. It is not a close call either: a life-safety plan
 * is DENSER than the plan it is drawn over, because it carries the egress
 * paths, the occupancy tags and the rated-wall hatching ON TOP of the same
 * walls. Ranking by how much is drawn therefore prefers exactly the sheets that
 * repeat the plan, which is the opposite of what is wanted.
 *
 * ── THE RULES ARE ABOUT WORDS, NOT ABOUT ONE SET'S SHEET NUMBERS ──
 *
 * A drafter writes what a drawing IS across the bottom of it. That caption is
 * the most reliable thing on the sheet — more reliable than the number, which
 * is an office convention, and more than anything a model infers. So the rules
 * read the title, and the discipline letter only breaks ties.
 *
 * Scores are coarse on purpose. The point is to separate "price this" from
 * "do not price this", not to put two floor plans in a defensible order.
 */
export type SheetRank = {
  /** Higher is more worth taking off. Negative means do not. */
  score: number;
  /** The rule that decided it, in the estimator's own words. */
  why: string;
};

/**
 * Titles that name the drawing an estimator prices.
 *
 * `PARTITION` is here with the floor plans rather than above them: a partition
 * plan IS the wall drawing, and some offices call it that instead.
 */
const WORTH_PRICING: ReadonlyArray<readonly [RegExp, number, string]> = [
  [/\bDIMENSION(AL|ED)?\b[^.]*\bFLOOR\s+PLAN\b/i, 100, "a dimensioned floor plan"],
  [/\bFLOOR\s+PLAN\b/i, 90, "a floor plan"],
  [/\bPARTITION\b[^.]*\bPLAN\b/i, 90, "a partition plan"],
  [/\bENLARGED\b[^.]*\bPLAN\b/i, 70, "an enlarged plan"],
  [/\bPLAN\b/i, 40, "a plan of some kind"],
];

/**
 * Titles that say the drawing is ABOUT something else, even where it shows the
 * same walls.
 *
 * Every one of these was seen on a real set being preferred over the plan it is
 * drawn over, or is the same shape as one that was. The weights are large
 * enough to sink a sheet that also says PLAN, because all of these do: "LIFE
 * SAFETY & OCCUPANCY PLAN", "UNIT NUMBERING PLAN", "REFLECTED CEILING PLAN".
 * That is the whole difficulty — the word PLAN does not separate them.
 */
const NOT_WHAT_YOU_PRICE: ReadonlyArray<readonly [RegExp, number, string]> = [
  [/\bLIFE\s+SAFETY\b/i, -200, "a life-safety plan"],
  [/\bOCCUPANC(Y|IES)\b/i, -200, "an occupancy plan"],
  [/\bEGRESS\b/i, -200, "an egress plan"],
  [/\bUNIT\s+NUMBERING\b/i, -200, "a unit-numbering plan"],
  [/\bKEY\s+PLAN\b/i, -150, "a key plan"],
  [/\bFURNITURE\b/i, -200, "a furniture plan"],
  [/\bEQUIPMENT\b/i, -150, "an equipment plan"],
  [/\bREFLECTED\s+CEILING\b/i, -200, "a reflected ceiling plan"],
  [/\bRCP\b/i, -200, "a reflected ceiling plan"],
  [/\bFINISH(ES)?\b/i, -150, "a finish plan"],
  // ── THE ABBREVIATIONS, WHICH A VIEW CAPTION USES AND A SHEET TITLE DOES NOT ──
  //
  // A title block has room for "INTERIOR ELEVATIONS". The caption under a
  // drawing does not, and a drafter writes `RR 105 - EAST ELEV.` — which is
  // what all eight of Camp Bow Wow A120's interior elevations are captioned,
  // and why not one of them was recognised as a view. The sheet was then one
  // view, captioned as a plan, and the plan's region grew to cover the whole
  // page including the elevations and the accessories schedule.
  //
  // `\bELEV\b` cannot match ELEVATOR — there is no word boundary before the
  // R — so an elevator lobby plan is still a plan.
  [/\bDETAIL(S)?\b/i, -150, "a details sheet"],
  [/\bDET\.?\b/i, -150, "a detail"],
  [/\bSECTION(S)?\b/i, -200, "a sections sheet"],
  [/\bSECT\.?\b/i, -200, "a section"],
  [/\bELEVATION(S)?\b/i, -200, "an elevations sheet"],
  [/\bELEV\.?\b/i, -200, "an elevation"],
  // A SCHEDULE AND A DIAGRAM ARE NOT DRAWINGS YOU MEASURE, and both appear as
  // captioned views on a mixed sheet: A120 carries a TOILET ACCESSORIES
  // SCHEDULE, which is a ruled table of text. Demoted for sheet ranking too,
  // which is right — a door schedule sheet is not the sheet to price.
  [/\bSCHEDULE(S)?\b/i, -200, "a schedule"],
  [/\bSCHED\.?\b/i, -200, "a schedule"],
  [/\bDIAGRAM(S)?\b/i, -200, "a diagram"],
  [/\bSITE\b/i, -200, "a site plan"],
  [/\bROOF\b/i, -200, "a roof plan"],
];

/** The architectural discipline, which is where partitions are drawn. */
const ARCHITECTURAL = /^A[-\s.]?\d/i;

export function takeoffRank(
  sheetNumber: string | null | undefined,
  title: string | null | undefined,
): SheetRank {
  const number = (sheetNumber ?? "").trim();
  const name = (title ?? "").trim();

  // ── A DEMOTION WINS OVER A PROMOTION, BECAUSE ALL OF THEM SAY "PLAN" ──
  //
  // "LIFE SAFETY & OCCUPANCY PLAN LEVEL 3" matches both lists. Taking the
  // worst match rather than the best is what stops a sheet arguing its way up
  // on a word it shares with the drawing it is covering.
  let worst: readonly [RegExp, number, string] | null = null;
  for (const rule of NOT_WHAT_YOU_PRICE) {
    if (rule[0].test(name) && (worst === null || rule[1] < worst[1])) worst = rule;
  }

  let best: readonly [RegExp, number, string] | null = null;
  for (const rule of WORTH_PRICING) {
    if (rule[0].test(name) && (best === null || rule[1] > best[1])) best = rule;
  }

  // The discipline letter BREAKS TIES and never decides. An office that numbers
  // its ceiling plans in the A series is common; one that writes FLOOR PLAN on
  // an elevation is not.
  const discipline = ARCHITECTURAL.test(number) ? 5 : 0;

  // And the duplicate judgement this file already makes, folded in: a sheet
  // that repeats the architectural plan under its own work is not the one to
  // price, whatever its title says.
  const repeats = sheetSuitability(number, name, null);

  if (worst !== null) {
    return { score: worst[1] + discipline, why: worst[2] };
  }
  if (repeats.likelyDuplicate) {
    return { score: -100 + discipline, why: repeats.kind };
  }
  if (best !== null) {
    return { score: best[1] + discipline, why: best[2] };
  }
  // No opinion. Below every plan and above everything named as something else,
  // because a title nobody recognises is a weaker signal than a title that
  // names itself as a section.
  return { score: discipline, why: "nothing in the title says what it is" };
}

/**
 * The sheets of a set, best first.
 *
 * Ties keep the input order, which is page order — so a set that numbers its
 * plans in sequence reads in sequence.
 */
export function rankSheetsForTakeoff<T extends { number: string | null; title: string | null }>(
  sheets: readonly T[],
): { sheet: T; rank: SheetRank }[] {
  return sheets
    .map((sheet, at) => ({ sheet, rank: takeoffRank(sheet.number, sheet.title), at }))
    .sort((a, b) => b.rank.score - a.rank.score || a.at - b.at)
    .map(({ sheet, rank }) => ({ sheet, rank }));
}
