import { parseFeetInches } from "@/lib/feet-inches";

/**
 * ── A PARTITION SCHEDULE, READ AS WALL TYPES ──
 *
 * `SCHEDULE_ROWS` already reads any table on a drawing into marks, descriptions,
 * sizes and notes, and it already knows a partition schedule when it sees one
 * (`kind: "PARTITION"`). What it deliberately does not do is LINK a row to
 * anything — its own header says so, and that is the right boundary for a stage
 * that costs money per page.
 *
 * This is the link, for one kind of schedule, and it is the piece that makes
 * automatic takeoff possible at all.
 *
 * ── WHY IT MATTERS MORE THAN IT LOOKS ──
 *
 * The wall finder measures a wall's THICKNESS off the sheet's own line work and
 * learns nothing else about it. The wall-type library knows the assembly, the
 * layers and the price, and nothing about thickness. So today a detected group
 * can only be priced when the architect tagged that particular run — and an
 * architect tags REPRESENTATIVE walls, not every wall. Measured on two pages of
 * a real set: 25-43% of the footage carries a tag at all.
 *
 * A partition schedule names every type and its thickness in one table. Read it
 * once and the other 57-75% can be priced too.
 *
 * ── ARITHMETIC STAYS IN CODE ──
 *
 * The model already did the part only a model can do — which column is the mark,
 * which rows are headers, what this table is OF. Turning `4 7/8"` into a number
 * is arithmetic, so it happens here, through `parseFeetInches`, which is the
 * app's one reader for a printed dimension. A second parser living in a model's
 * output would be a second authority on what a drawing says.
 *
 * ── A ROW WE CANNOT READ A THICKNESS FROM IS DROPPED ──
 *
 * The same rule the schedule reader states for itself: *"a fifty-first door
 * nobody ordered is worse than fifty with a gap somebody fills by hand."* A wall
 * type with a guessed thickness is worse than one the person types, because the
 * matcher will then price real footage against it and the number will look
 * right.
 *
 * Pure. No database, no React, no model.
 */

/** One row of a partition schedule, as the schedule reader reports it. */
export type PartitionScheduleRow = {
  mark: string;
  description: string | null;
  size: string | null;
  notes: string | null;
};

/** A wall type the schedule describes, ready for a person to accept. */
export type ProposedWallType = {
  /** The mark exactly as printed. An identity on somebody else's drawing. */
  code: string;
  name: string;
  thicknessIn: number;
  /** Where the schedule states one. Null is ordinary — most do not. */
  defaultHeightFt: number | null;
  /** The schedule's own words for anything the fields above do not carry. */
  notes: string | null;
};

/**
 * The widest and narrowest things a partition schedule row can be describing.
 *
 * The lower bound is a 1″ furring channel; the upper is a double-stud shaft
 * wall with two layers each side. Outside that the number read is not a wall
 * thickness — it is a stud spacing, a height in inches, a fire rating, or a
 * column the model named wrongly — and a type built from it would price footage
 * against a wall nobody drew.
 */
export const THINNEST_IN = 1;
export const THICKEST_IN = 24;

/** The shortest and tallest a stated wall height can be, in feet. A partition
 *  below 6 ft is a guard rail or a misread; above 40 is an atrium nobody frames
 *  as one run. */
const SHORTEST_FT = 6;
const TALLEST_FT = 40;

/**
 * Vulgar fractions as a CAD font emits them, spelled out for the app's own
 * parser.
 *
 * NOT a second number parser, and `numericInputCensus.test.ts` is the reason to
 * say which it is: nothing here reads a digit. It rewrites one glyph as the
 * three characters `parseFeetInches` already understands, and hands the string
 * on. A drawing that prints `4⅞"` means exactly what `4 7/8"` means, and
 * refusing it would drop a row for a typographic reason.
 */
const VULGAR: Record<string, string> = {
  "¼": " 1/4",
  "½": " 1/2",
  "¾": " 3/4",
  "⅓": " 1/3",
  "⅔": " 2/3",
  "⅛": " 1/8",
  "⅜": " 3/8",
  "⅝": " 5/8",
  "⅞": " 7/8",
};

/**
 * A cell as the app's own parser expects to read it.
 *
 * Two rewrites, neither of which reads a digit. The vulgar fraction becomes its
 * three characters; and `4-7/8"` becomes `4 7/8"`, because a HYPHEN between a
 * whole number and a fraction is how every drawing writes a thickness, while
 * `parseFeetInches` documents a bare hyphen as the feet-inches separator —
 * `24-6` is twenty-four feet six. Handing it `4-7/8"` unrewritten would read
 * four FEET.
 */
const asTypedDimension = (text: string): string =>
  text
    .replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, (glyph) => VULGAR[glyph])
    .replace(/(\d)\s*-\s*(\d+\/\d+)/g, "$1 $2");

/**
 * An inch dimension as a drawing writes one: `4 7/8"`, `4-7/8"`, `7/8"`, `6"`,
 * `4.875"`.
 *
 * THE FIRST DRAFT OF THIS PATTERN READ `3-5/8" STUD … (4-7/8" TOTAL)` AS
 * **8 INCHES** — from a string whose own answer is printed in it — because it
 * had no alternative for a whole number and a fraction at all, so the only
 * thing that matched was the `8"` at the tail. A wall type built from that
 * would have matched and priced every 8in group on the sheet.
 *
 * What fixes it is the hyphen rewrite in `asTypedDimension`, not the order of
 * the alternatives here: by the time this runs, `4-7/8"` is already `4 7/8"`.
 * Mutation-tested, and putting the bare fraction first changes nothing —
 * recorded because the comment that used to sit here called the ordering
 * load-bearing, which was true of an earlier draft and is not true of this one.
 * The ordering is kept as the belt to the rewrite's braces.
 */
const DIMENSION = String.raw`(?:\d+[\s-]*\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*["″”]`;

/**
 * Inches from a dimension that is the WHOLE of its cell, or null.
 *
 * `parseFeetInches` answers in FEET, because that is what every other caller
 * wants. A partition thickness is written in inches — `4 7/8"`, `6 1/8"` — and
 * a bare `4 7/8` with no inch mark parses as four feet seven and a half inches,
 * which is why the mark is required rather than assumed. A cell carrying a FOOT
 * mark as well is a size like `3'-0" x 7'-0"`, which belongs to some other
 * schedule and is refused rather than half-read.
 */
function inchesFromCell(raw: string | null): number | null {
  if (raw === null) return null;
  const text = asTypedDimension(raw).trim();
  if (text === "" || !/["″”]/.test(text) || /['′’]/.test(text)) return null;
  const read = parseFeetInches(text, { label: "Thickness" });
  if (!read.ok) return null;
  return inRange(read.n * 12);
}

/**
 * Inches from a dimension inside free text — and ONLY one the schedule itself
 * calls the total.
 *
 * ── THE MOST DANGEROUS LINE IN THIS FILE, SO IT IS THE NARROWEST ──
 *
 * A partition description names several dimensions and only one of them is the
 * wall: `3-5/8" STUD, 5/8" GWB EA SIDE (4-7/8" TOTAL)`. Taking the first gives
 * 3-5/8 — the STUD — and a type built from it would then match and price every
 * 3-5/8" group on the sheet as A1. The footage would look right and the
 * assembly would be wrong, which is the failure this whole takeoff effort keeps
 * paying for.
 *
 * So a dimension in free text counts only when a word beside it says it is the
 * overall thickness. Anything else leaves the row for a person, which costs one
 * line of typing and cannot be wrong.
 */
const SAYS_TOTAL = String.raw`(?:TOTAL|OVERALL|THICKNESS|THK\.?|NOMINAL|NOM\.?)`;

/**
 * The dimension must be ADJACENT to the word, not merely near it.
 *
 * "Near" was the first draft and it is not safe: in `5/8" GWB (4-7/8" TOTAL)` a
 * window wide enough to catch the real pairing also catches the BOARD, and
 * which one wins becomes an accident of character counts. A schedule writes
 * `4-7/8" TOTAL` or `TOTAL: 4-7/8"`, so those are the two shapes read, and
 * anything else leaves the row for a person.
 */
const TOTAL_PATTERNS = [
  new RegExp(String.raw`(${DIMENSION})\s*[-–—(,]?\s*${SAYS_TOTAL}`, "i"),
  new RegExp(String.raw`${SAYS_TOTAL}\s*[:=-]?\s*(${DIMENSION})`, "i"),
];

function inchesFromText(raw: string | null): number | null {
  if (raw === null) return null;
  const text = asTypedDimension(raw);
  for (const pattern of TOTAL_PATTERNS) {
    const match = text.match(pattern);
    if (match === null) continue;
    const read = parseFeetInches(match[1].trim(), { label: "Thickness" });
    if (!read.ok) continue;
    const inches = inRange(read.n * 12);
    if (inches !== null) return inches;
  }
  return null;
}

function inRange(inches: number): number | null {
  return inches >= THINNEST_IN && inches <= THICKEST_IN ? inches : null;
}

/** Feet from a printed height, or null. Requires a FOOT mark, for the mirror of
 *  the reason above: `10-6` in a notes column is as likely to be a detail
 *  reference as a height, and `10'-6"` is not. */
function heightFrom(raw: string | null): number | null {
  if (raw === null) return null;
  const match = asTypedDimension(raw).match(
    /\d+\s*['′’][-\s]*(?:\d+(?:\s+\d+\/\d+)?\s*["″”])?/,
  );
  if (match === null) return null;
  const read = parseFeetInches(match[0].trim(), { label: "Height" });
  if (!read.ok) return null;
  return read.n >= SHORTEST_FT && read.n <= TALLEST_FT ? read.n : null;
}

/**
 * The wall types a partition schedule proposes.
 *
 * Thickness is looked for in `size` first — a cell that is nothing but a
 * dimension — and only then in the free text of `description` and `notes`,
 * where it counts solely if the schedule's own words call it the total. See
 * `inchesFromText` for why that restriction is the important part.
 *
 * Height is read only from `notes` and `description`. Never from `size`: on a
 * schedule whose size column IS the thickness, a foot mark there means the
 * column was misread, and taking it as a height would quietly accept that.
 *
 * A mark seen twice keeps its FIRST row. A partition schedule that repeats its
 * headings mid-table is the ordinary cause, and the first is the one above the
 * repeat.
 */
export function wallTypesFromSchedule(rows: readonly PartitionScheduleRow[]): ProposedWallType[] {
  const out: ProposedWallType[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const code = row.mark.trim();
    if (code === "" || seen.has(code.toUpperCase())) continue;
    const thicknessIn =
      inchesFromCell(row.size) ?? inchesFromText(row.description) ?? inchesFromText(row.notes);
    if (thicknessIn === null) continue;
    seen.add(code.toUpperCase());
    out.push({
      code,
      name: row.description?.trim() || `${code} partition`,
      thicknessIn,
      defaultHeightFt: heightFrom(row.notes) ?? heightFrom(row.description),
      notes: row.notes?.trim() || null,
    });
  }
  return out;
}
