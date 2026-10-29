/**
 * ── WHICH CAPTIONS ON A SCANNED SHEET ARE WORTH BELIEVING ──
 *
 * On a vector sheet a caption is what the drafter typed. On a SCAN it is
 * what OCR made of the pixels, and OCR noise reads as captions: "ELEVATIONS"
 * out of a hatch, "NOTES" out of a title block, a word that is no word at
 * all. The view detector then splits the sheet by those and sets the pieces
 * aside for reasons that sound real — and the sheet measures nothing
 * (Bunkie A100 at 300 dpi, 0 of 470 ft).
 *
 * So a caption on a scan is TRUSTED only when OCR was sure of it and every
 * word in it is a word a drawing caption uses. Anything less is not a
 * caption, and a sheet with fewer than two trusted captions takes the
 * single-drawing path, which measures the drawing and lets the estimator
 * check it. Pure, so the rule has tests.
 */

/** OCR line confidence, 0–100, below which a caption is noise. Tesseract and Vision both score real captions in the 80s and 90s. */
export const CAPTION_MIN_CONFIDENCE = 70;

/**
 * The words a drawing caption is made of. Not a dictionary: the vocabulary
 * the caption classifiers (`viewTitles`, `viewKind`, `sheetSuitability`)
 * already recognise, plus the ordinary qualifiers that sit beside them.
 */
const CAPTION_WORDS = new Set(
  (
    "PLAN PLANS FLOOR FLOORS LEVEL LEVELS ROOF CEILING CEILINGS REFLECTED RCP ELEVATION ELEVATIONS SECTION SECTIONS DETAIL DETAILS " +
    "SCHEDULE SCHEDULES NOTES NOTE LEGEND LEGENDS KEY KEYED SYMBOLS ABBREVIATIONS TYPES TYPE INDEX ENLARGED PARTIAL OVERALL TYPICAL TYP " +
    "DEMOLITION DEMO EXISTING NEW PROPOSED SITE FOUNDATION FRAMING FINISH FINISHES FURNITURE EQUIPMENT LIGHTING POWER MECHANICAL " +
    "ELECTRICAL PLUMBING FIRE PROTECTION ALARM SPRINKLER HVAC STRUCTURAL ARCHITECTURAL CIVIL LANDSCAPE INTERIOR EXTERIOR BUILDING " +
    "WALL WALLS PARTITION PARTITIONS DIMENSION DIMENSIONS DIMENSIONED LAYOUT AREA AREAS UNIT UNITS ROOM ROOMS CODE LIFE SAFETY EGRESS " +
    "ACCESSIBILITY FIRST SECOND THIRD FOURTH FIFTH GROUND BASEMENT MEZZANINE PENTHOUSE MAIN UPPER LOWER NORTH SOUTH EAST WEST " +
    "LEFT RIGHT FRONT REAR SIDE WING PHASE SCALE NTS GENERAL SHEET SHEETS COVER TITLE VICINITY MAP LOCATION DOOR WINDOW WINDOWS " +
    "HARDWARE FIXTURE FIXTURES CASEWORK MILLWORK STAIR STAIRS ELEVATOR RESTROOM TOILET KITCHEN LOBBY CORRIDOR OFFICE WAREHOUSE " +
    "GARAGE CANOPY ENTRY ENTRANCE SLAB DECK WEST EAST AND OF THE AT TO FOR WITH ON IN"
  ).split(/\s+/),
);

/** Whether every word of a caption is one a caption uses. Numbers, scales and level codes ("P2", "A-1") pass. */
export function captionWordsAreReal(name: string): boolean {
  const words = name
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Z0-9\p{L}]+|[^A-Z0-9\p{L}"']+$/gu, ""))
    .filter((w) => w.length > 0);
  if (words.length === 0) return false;
  let real = 0;
  for (const word of words) {
    // A letter outside A–Z is OCR reading a stroke as an accent: noise.
    if (/[^\x00-\x7F]/.test(word)) return false;
    const letters = word.replace(/[^A-Z]/g, "");
    // A number, a scale fragment, a level code: not a word, not noise.
    if (letters.length <= 2) {
      real += 1;
      continue;
    }
    if (!CAPTION_WORDS.has(letters)) return false;
    real += 1;
  }
  return real > 0;
}

export type CaptionEvidence = { str: string; confidence?: number };

/**
 * Trusted when OCR scored the line it came from at or above the threshold
 * AND its words are real. A caption with no line behind it, or a line with
 * no confidence (an older stored read), is not trusted on a scan.
 */
export function captionTrusted(name: string, items: readonly CaptionEvidence[]): boolean {
  const wanted = name.trim().toUpperCase();
  if (wanted === "") return false;
  let best = -1;
  for (const item of items) {
    if (item.confidence === undefined) continue;
    const str = item.str.trim().toUpperCase();
    if (str === wanted || str.includes(wanted) || wanted.includes(str)) best = Math.max(best, item.confidence);
  }
  if (best < CAPTION_MIN_CONFIDENCE) return false;
  return captionWordsAreReal(name);
}

/** The views whose captions a scan can be trusted on. */
export function trustedScanViews<T extends { name: string }>(views: readonly T[], items: readonly CaptionEvidence[]): T[] {
  return views.filter((view) => captionTrusted(view.name, items));
}
