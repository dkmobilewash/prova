/**
 * ── WHAT A PARTITION TYPE IS MADE OF, READ FROM WHAT THE ARCHITECT WROTE ──
 *
 * A wall type reaches the estimate as a thickness and a name, and an estimator
 * then types in the studs, the track, the board and the insulation by hand.
 * The drawing already says all four. This turns the words into proposed
 * `WallTypeComponent` rows for a person to accept.
 *
 * ── QUANTITY ONLY. NEVER PRICE. ──
 *
 * `WallTypeComponent` carries both halves and they come from different places.
 * `basis`, `factor`, `wastePercent` and `roundUp` are QUANTITY — how much of a
 * thing a wall of this type needs — and a partition schedule states them.
 * `catalogEntryId`, `productionRate` and `craftClassificationId` are PRICE, and
 * a drawing knows nothing about what your supplier charges or what your crew
 * hangs in an hour. Nothing here writes one, and `partitionAssembly.test.ts`
 * fails if a proposal ever carries a price field at all.
 *
 * That line is the whole reason this is safe to propose. `wallTypes.ts` already
 * says it about components in general — *"a type created with invented
 * components would read as priced while costing nothing real"* — and the
 * resolution is not to leave the quantities out, it is to leave the PRICES out.
 *
 * ── AMBIGUOUS MEANS LEFT OUT, NOT GUESSED ──
 *
 * Diego's rule. Where the text supports two readings — two different stud
 * sizes in one description, a layer count that contradicts itself — the
 * component is omitted and a flag says why, with the phrase that caused it. A
 * component that is merely ABSENT from the text is not a flag: a partition
 * with no insulation line has no insulation, and saying "ambiguous" about it
 * would train a reviewer to click past the real ones.
 *
 * ── WHERE THE WORDS COME FROM, AND WHY THIS TAKES LINES RATHER THAN A ROW ──
 *
 * Measured across the five real sets on 2026-10-20, because the shape of the
 * input decides the shape of this function:
 *
 *   - **not one of them carries a partition schedule as a TABLE.** The only
 *     partition legend in any of them is Camp Bow Wow A130 p16, drawn as five
 *     DETAILS side by side with their callouts interleaved line by line;
 *   - ELEVEN03's richest assembly page, p74, is a sheet of UL firestop
 *     details — somebody else's assemblies, not this building's;
 *   - Camp Bow Wow p22 and p28 are wall sections whose callouts name studs and
 *     board, which is assembly text that belongs to no wall TYPE at all.
 *
 * So this takes a list of LINES and a label saying where they came from, and
 * is indifferent to whether they were a schedule row's description, a legend
 * detail's callouts, or one string. `scheduleRows.ts` produces the first;
 * nothing yet produces the second, which is recorded in NOTES.md as the thing
 * standing between this and a wall type that prices itself.
 */

/** A `WallTypeComponent`'s quantity half, and nothing else. */
export type ComponentBasis = "LINEAR_FT" | "FACE_SQFT" | "BOARDED_SQFT" | "STUDS" | "PER_RUN";

export type ProposedComponent = {
  description: string;
  unit: string | null;
  basis: ComponentBasis;
  factor: number;
  wastePercent: number;
  roundUp: boolean;
  /** The exact words this came from, and which sheet or row they were on. */
  from: { phrase: string; where: string };
};

export type AssemblyFlag = {
  /** What could not be decided, in an estimator's words. */
  why: string;
  /** The text that caused it, so a person can look at the same words. */
  phrase: string;
};

export type PartitionAssembly = {
  components: ProposedComponent[];
  flags: AssemblyFlag[];
  /** The facts the components were built from, for the review screen. */
  read: {
    studWidthIn: number | null;
    studSpacingIn: number | null;
    studGauge: number | null;
    boardThicknessIn: number | null;
    layersPerSide: number | null;
    boardIsTypeX: boolean;
    insulation: string | null;
    hourlyRating: number | null;
  };
};

/** `3 5/8`, `5/8`, `6`, `2-1/2` → inches. Null where it is not a measurement. */
export function inchesFrom(text: string): number | null {
  const whole = text.match(/(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)/);
  if (whole !== null) {
    const [, a, b, c] = whole;
    const denominator = Number(c);
    if (denominator === 0) return null;
    return Number(a) + Number(b) / denominator;
  }
  const fraction = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction !== null) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }
  const plain = text.match(/(\d+(?:\.\d+)?)/);
  return plain === null ? null : Number(plain[1]);
}

/**
 * A `LABEL | VALUE` row of a partition SCHEDULE drawn as a table — Central
 * Bank's: `STUD SIZE | 3 5/8"`, `STUD SPACING (O.C.) | 16"`, `GWB THICKNESS |
 * 5/8"`, `INSULATION THICKNESS | -`. The legend reader hands a table's cells
 * through joined with ` | `, so the label and its value arrive on one line.
 */
function labelled(line: string, label: RegExp): string | null {
  const hit = line.match(new RegExp(`^\\s*(?:${label.source})[^|]*\\|\\s*([^|]*)$`, "i"));
  return hit === null ? null : hit[1].trim();
}

/** A value cell that says there is none: `-`, `—`, `N/A`, `NONE`. */
const NO_VALUE = /^(?:-+|—|–|N\/?A|NONE|NA)$/i;

/**
 * The nominal lumber a `2X` stud is, in inches of actual width. A `2X` with
 * no number — E Street's `2X WOOD STUD FRAMING` — states no width, and the
 * component is flagged rather than guessed.
 */
const LUMBER_WIDTH: Record<string, number> = { "4": 3.5, "6": 5.5, "8": 7.25, "10": 9.25 };

/**
 * The narrowest stud anybody frames a partition with, in inches. ELEVEN03's
 * `1-5/8X C-SHAPE` is the floor; anything under it that lands in front of the
 * word STUD is a board thickness that drifted there — see below.
 */
const NARROWEST_STUD_IN = 1.5;

/** Every distinct stud width the text states, in inches. */
function studWidths(lines: readonly string[]): { value: number; phrase: string }[] {
  const out: { value: number; phrase: string }[] = [];
  const free: string[] = [];
  for (const line of lines) {
    const cell = labelled(line, /STUD\s+SIZE|STUD\s+WIDTH/);
    if (cell !== null) {
      const value = NO_VALUE.test(cell) ? null : inchesFrom(cell);
      if (value !== null && value > 0 && value <= 24) out.push({ value, phrase: line.trim() });
      continue;
    }
    // Lumber first: `2X4 WOOD STUDS`, `2 X 6 STUDS`. A line that names its
    // studs as lumber is read as lumber only, or the `4` of `2X4` would also
    // read as a four-inch metal stud and the two would flag each other.
    let lumber = false;
    for (const hit of line.matchAll(/\b2\s*[xX]\s*(4|6|8|10)\b[^.|]{0,24}?\bSTUDS?\b/g)) {
      out.push({ value: LUMBER_WIDTH[hit[1]], phrase: hit[0].trim() });
      lumber = true;
    }
    if (lumber) continue;
    free.push(line);
  }
  // ── A LEGEND WRAPPED INTO A COLUMN SPLITS THE PHRASE ACROSS LINES ──
  //
  // NG Green Bay prints its partition types in a narrow column beside the
  // plan: `3 5/8" 20 GA. MTL.` on one line and `STUD` on the next, so no line
  // holds both the size and the word. Read as lines, that type has no studs
  // at all; read as one string it says what the drafter wrote.
  //
  // A table's rows are NOT joined. Central Bank's `WALL THICKNESS | 4 7/8"`
  // runs straight into `STUD SPACING (O.C.) | 16"` when they are, and reads as
  // a 4-7/8in stud beside the 3-5/8in one the STUD SIZE row states. A row
  // with cells is read as its own line, as prose on a row is still prose.
  //
  // `3 5/8" MTL. STUD AT 16" O.C.`, `6" METAL STUDS @ 16" O.C.`, and the
  // longer spellings real sets use: Baker's `6", 18 MIL (25GA.), STEEL STUDS
  // 24" O.C.`, Murray's `3 5/8" 20 GAUGE METAL STUDS` and ELEVEN03's `1-5/8X
  // C-SHAPE METAL STUDS`.
  const re =
    /((?:\d+\s*[-\s]\s*)?\d+(?:\s*\/\s*\d+)?)\s*"?\s*(?:X\s*)?(?:,\s*)?(?:\d+\s*MIL\.?\s*)?(?:\(?\s*\d+\s*(?:GA\.?|GAUGE)\s*\)?\s*,?\s*)?(?:C-?SHAPED?\s*)?(?:MTL\.?|METAL|STL\.?|STEEL|WD\.?|WOOD)?\s*STUDS?\b/gi;
  const texts = [free.filter((l) => !l.includes("|")).join(" "), ...free.filter((l) => l.includes("|"))];
  for (const text of texts) {
    for (const hit of text.matchAll(re)) {
      // `2X WOOD STUD` is lumber with its size left off, not a two-inch stud;
      // `unsizedLumber` flags it.
      if (/^2\s*X\b/i.test(hit[0])) continue;
      const value = inchesFrom(hit[1]);
      // Joining lines is what lets `5/8" GYP. BD.` end one line and `STUDS AT
      // 16" O.C.` start the next; a 5/8in "stud" is that board, not a stud.
      if (value === null || value < NARROWEST_STUD_IN || value > 24) continue;
      out.push({ value, phrase: hit[0].trim() });
    }
  }
  return out;
}

/**
 * The spacing stated in the same breath as the studs — `STUDS AT 16" O.C.` —
 * which is the one that applies to them.
 *
 * Murray Towers' legend also says `BOTTOM TRACK FASTENED AT 24" O.C.` and Camp
 * Bow Wow's names a 48in bracing spacing; counting every O.C. on the type
 * flagged both as ambiguous when the drawing was not. Read over the type's
 * free text as one string, because a column-wrapped legend puts `STUD FRAMING
 * @` and `16" O.C.` on two lines.
 */
function spacingOnStudLine(lines: readonly string[]): { value: number; phrase: string } | null {
  const text = lines.filter((l) => !l.includes("|")).join(" ");
  const hit = text.match(
    /\bSTUDS?\b[^.|]{0,40}?(\d+(?:\s*\/\s*\d+)?)\s*"?\s*(?:O\.?\s*C\.?|ON\s+CENTER)/i,
  );
  if (hit === null) return null;
  const value = inchesFrom(hit[1]);
  if (value === null || value <= 0 || value > 48) return null;
  return { value, phrase: hit[0].trim() };
}

/** A `2X` stud with no nominal size — a wood wall whose width is not stated. */
function unsizedLumber(lines: readonly string[]): string | null {
  for (const line of lines) {
    const hit = line.match(/\b2\s*[xX]\b(?!\s*\d)[^.|]{0,20}?\bSTUDS?\b/);
    if (hit !== null) return hit[0].trim();
  }
  return null;
}

/** The on-centre spacing, where the text gives one. */
function spacings(lines: readonly string[]): { value: number; phrase: string }[] {
  const out: { value: number; phrase: string }[] = [];
  for (const line of lines) {
    const cell = labelled(line, /STUD\s+SPACING/);
    if (cell !== null) {
      const value = NO_VALUE.test(cell) ? null : inchesFrom(cell);
      if (value !== null && value > 0 && value <= 48) out.push({ value, phrase: line.trim() });
      continue;
    }
    const re = /(\d+(?:\s*\/\s*\d+)?)\s*"?\s*(?:O\.?\s*C\.?|ON\s+CENTER)/gi;
    for (const hit of line.matchAll(re)) {
      const value = inchesFrom(hit[1]);
      if (value === null || value <= 0 || value > 48) continue;
      out.push({ value, phrase: hit[0].trim() });
    }
  }
  return out;
}

/** The board thickness and whether it is Type X. */
function boards(lines: readonly string[]): { value: number; phrase: string }[] {
  const out: { value: number; phrase: string }[] = [];
  for (const line of lines) {
    const cell = labelled(line, /(?:GWB|GYP\.?(?:SUM)?(?:\s+(?:WALL\s*)?(?:BOARD|BD\.?))?)\s+THICKNESS/);
    if (cell !== null) {
      const value = NO_VALUE.test(cell) ? null : inchesFrom(cell);
      if (value !== null && value >= 0.25 && value <= 1.25) out.push({ value, phrase: line.trim() });
      continue;
    }
    const re =
      /(\d+(?:\s*\/\s*\d+)?)\s*"?\s*(?:THICK\s*)?(?:PAINTED\s*)?(?:TYPE\s*['"]?X['"]?\s*)?(?:GYP\.?(?:SUM)?|GWB|G\.?W\.?B\.?|DRYWALL|WALL\s*BOARD|BOARD|BD\.?|CEMENTITIOUS\s+BACKER)/gi;
    for (const hit of line.matchAll(re)) {
      const value = inchesFrom(hit[1]);
      // A board is between a quarter inch and an inch and a quarter. A "5" in
      // "5 LAYERS" is not a thickness, and neither is a room number.
      if (value === null || value < 0.25 || value > 1.25) continue;
      out.push({ value, phrase: hit[0].trim() });
    }
  }
  return out;
}

/** How many layers per side the text states. */
function layerCounts(lines: readonly string[]): { value: number; phrase: string }[] {
  const out: { value: number; phrase: string }[] = [];
  const words: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, SINGLE: 1, DOUBLE: 2 };
  for (const line of lines) {
    for (const hit of line.matchAll(/\(?\b(\d+)\)?\s*LAYERS?\b/gi)) {
      const value = Number(hit[1]);
      if (value >= 1 && value <= 4) out.push({ value, phrase: hit[0].trim() });
    }
    for (const hit of line.matchAll(/\b(ONE|TWO|THREE|SINGLE|DOUBLE)\s+LAYERS?\b/gi)) {
      out.push({ value: words[hit[1].toUpperCase()] ?? 1, phrase: hit[0].trim() });
    }
  }
  return out;
}

const EACH_SIDE = /\b(?:EACH|EA\.?|BOTH)\s*SIDES?\b/i;
const ONE_SIDE = /\b(?:ONE|1)\s*SIDE\s*ONLY\b|\bONE\s+SIDE\b/i;

/** Distinct values, so "6in stud" said three times is one reading. */
function distinct(found: { value: number; phrase: string }[]): number[] {
  return [...new Set(found.map((one) => one.value))];
}

/**
 * Read a partition type's assembly from the words describing it.
 *
 * `lines` is however the text arrived — a schedule row's description split on
 * its own punctuation, or a legend detail's callouts. `where` is carried onto
 * every proposal so the review screen can say which sheet and which row a
 * number came from.
 */
export function readPartitionAssembly(input: {
  lines: readonly string[];
  where: string;
}): PartitionAssembly {
  // ── A TABLE ROW WHOSE VALUE IS "-" SAYS THE THING IS ABSENT ──
  //
  // Central Bank's schedule prints `INSULATION THICKNESS | -` on every type
  // that has no insulation, and the word INSULATION in that row proposed
  // batts for all ten of them. A labelled row with no value is dropped
  // before anything reads words out of it.
  const lines = input.lines
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l !== "")
    .filter((l) => {
      const hit = l.match(/^[^|]+\|\s*([^|]*)$/);
      return hit === null || !NO_VALUE.test(hit[1].trim());
    });
  const where = input.where;
  const components: ProposedComponent[] = [];
  const flags: AssemblyFlag[] = [];
  const joined = lines.join(" ");

  // ── STUDS ──
  const studs = studWidths(lines);
  const studValues = distinct(studs);
  let studWidthIn: number | null = null;
  if (studValues.length > 1) {
    flags.push({
      why: `two stud sizes are named and nothing says which this type uses (${studValues
        .map((v) => `${v}in`)
        .join(", ")})`,
      phrase: studs.map((s) => s.phrase).join("  ·  "),
    });
  } else if (studValues.length === 1) {
    studWidthIn = studValues[0];
  } else {
    const lumber = unsizedLumber(lines);
    if (lumber !== null) {
      flags.push({
        why: "wood studs with no nominal size stated — the width has to come from the wall thickness or a section",
        phrase: lumber,
      });
    }
  }

  const spacingFound = spacings(lines);
  const spacingValues = distinct(spacingFound);
  const onStudLine = spacingOnStudLine(lines);
  let studSpacingIn: number | null = null;
  if (onStudLine !== null) {
    // The drawing said which spacing is the studs'; the others (track
    // fasteners, bracing) are not a question about the studs.
    studSpacingIn = onStudLine.value;
  } else if (spacingValues.length > 1) {
    flags.push({
      why: `two spacings are named and nothing says which applies to the studs (${spacingValues
        .map((v) => `${v}in`)
        .join(", ")})`,
      phrase: spacingFound.map((s) => s.phrase).join("  ·  "),
    });
  } else if (spacingValues.length === 1) {
    studSpacingIn = spacingValues[0];
  }

  const gaugeHit = joined.match(/\b(\d{2})\s*(?:GA\.?|GAUGE)\b/i);
  const studGauge = gaugeHit === null ? null : Number(gaugeHit[1]);

  if (studWidthIn !== null) {
    const phrase = studs.find((s) => s.value === studWidthIn)?.phrase ?? `${studWidthIn}in stud`;
    components.push({
      description:
        `${fraction(studWidthIn)}in metal stud` +
        (studGauge === null ? "" : `, ${studGauge} ga`) +
        (studSpacingIn === null ? "" : ` at ${fraction(studSpacingIn)}in o.c.`),
      unit: "EA",
      // The COUNT comes from `studsRequired`, which reads the type's own
      // spacing — so this is one stud per stud, not a length.
      basis: "STUDS",
      factor: 1,
      wastePercent: 0,
      roundUp: true,
      from: { phrase, where },
    });

    // ── TRACK ──
    //
    // Not stated on any legend measured, and not a guess: a stud wall has a
    // top and a bottom track by construction, which is why the schema's own
    // comment gives 2 as the example factor for "top-and-bottom track". It is
    // proposed from the STUD line and says so.
    components.push({
      description: `${fraction(studWidthIn)}in track, top and bottom`,
      unit: "LF",
      basis: "LINEAR_FT",
      factor: 2,
      wastePercent: 0,
      roundUp: false,
      from: { phrase, where },
    });
  }

  // ── BOARD ──
  const boardFound = boards(lines);
  const boardValues = distinct(boardFound);
  let boardThicknessIn: number | null = null;
  if (boardValues.length > 1) {
    flags.push({
      why: `two board thicknesses are named and nothing says which side takes which (${boardValues
        .map((v) => `${fraction(v)}in`)
        .join(", ")})`,
      phrase: boardFound.map((b) => b.phrase).join("  ·  "),
    });
  } else if (boardValues.length === 1) {
    boardThicknessIn = boardValues[0];
  }

  const layers = layerCounts(lines);
  const layerValues = distinct(layers);
  let layersPerSide: number | null = null;
  if (layerValues.length > 1) {
    flags.push({
      why: `the layer count contradicts itself (${layerValues.join(", ")})`,
      phrase: layers.map((l) => l.phrase).join("  ·  "),
    });
  } else if (layerValues.length === 1) {
    layersPerSide = layerValues[0];
  } else if (boardThicknessIn !== null) {
    // No count stated and a board named: one layer is what "5/8in gyp. bd.
    // each side" means. This is a reading of the words, not a guess at a
    // missing number, so it is not flagged.
    layersPerSide = 1;
  }

  const boardIsTypeX = /\bTYPE\s*['"]?\s*X\b/i.test(joined);
  if (boardThicknessIn !== null && layersPerSide !== null) {
    if (ONE_SIDE.test(joined) && !EACH_SIDE.test(joined)) {
      // A one-sided wall is a different `sides` on the TYPE, not a halved
      // factor here — `BOARDED_SQFT` already counts the sides. Saying it in a
      // factor would double-count the moment somebody sets sides correctly.
      flags.push({
        why: "the board is on one side only — set the wall type's sides to 1 before accepting, because the quantity counts sides itself",
        phrase: joined.match(ONE_SIDE)?.[0] ?? "one side",
      });
    }
    const phrase = boardFound.find((b) => b.value === boardThicknessIn)?.phrase ?? "board";
    components.push({
      description:
        `${fraction(boardThicknessIn)}in ${boardIsTypeX ? "type X " : ""}gypsum board` +
        (layersPerSide > 1 ? `, ${layersPerSide} layers per side` : ""),
      unit: "SF",
      // Already both sides, via the type's `sides` — so the factor is layers
      // PER SIDE and nothing else.
      basis: "BOARDED_SQFT",
      factor: layersPerSide,
      wastePercent: 0,
      roundUp: false,
      from: { phrase, where },
    });
  }

  // ── INSULATION ──
  //
  // One cavity, so one face area — NOT `BOARDED_SQFT`, which counts both
  // sides and would buy twice the batts.
  const insulationHit = joined.match(
    /\b(?:(R\s*-?\s*\d+)\s*)?(?:(?:SOUND|THERMAL|ACOUSTIC(?:AL)?)\s+)?(?:BATT|BATTS|INSULATION)\b/i,
  );
  const insulation = insulationHit === null ? null : insulationHit[0].trim();
  if (insulation !== null) {
    const rValue = joined.match(/\bR\s*-?\s*(\d+)/i);
    components.push({
      description: `cavity insulation${rValue === null ? "" : `, R-${rValue[1]}`}`,
      unit: "SF",
      basis: "FACE_SQFT",
      factor: 1,
      wastePercent: 0,
      roundUp: false,
      from: { phrase: insulation, where },
    });
  }

  // ── RATING ──
  //
  // Read and reported, never turned into a component: a rating changes WHICH
  // board and which detail, and the board line already carries Type X when the
  // text says so. A component called "1 hour rating" would be a line item for
  // nothing.
  const ratingHit = joined.match(/\b(\d+)\s*(?:HR|HOUR)S?\b/i);
  const noRating = /\bNO\s+RATING\b/i.test(joined);
  const hourlyRating = noRating ? 0 : ratingHit === null ? null : Number(ratingHit[1]);

  return {
    components,
    flags,
    read: {
      studWidthIn,
      studSpacingIn,
      studGauge,
      boardThicknessIn,
      layersPerSide,
      boardIsTypeX,
      insulation,
      hourlyRating,
    },
  };
}

/** 3.625 → `3-5/8`, 6 → `6`, so a description reads the way the drawing does. */
export function fraction(value: number): string {
  const whole = Math.floor(value);
  const rest = value - whole;
  if (rest < 1 / 64) return String(whole);
  for (const denominator of [2, 4, 8, 16]) {
    const numerator = Math.round(rest * denominator);
    if (Math.abs(rest - numerator / denominator) < 1 / 64) {
      return whole === 0 ? `${numerator}/${denominator}` : `${whole}-${numerator}/${denominator}`;
    }
  }
  return value.toFixed(2);
}
