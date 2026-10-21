import type { WallTypeSight } from "@prova/integrations/src/wallLegendSight";
import { fraction, readPartitionAssembly, type AssemblyFlag, type PartitionAssembly } from "./partitionAssembly";
import type { TextForSymbol } from "./tagSymbols";

/**
 * ── FROM A SIGHT READ TO THE SAME ASSEMBLY THE TEXT READ PRODUCES ──
 *
 * The model states the fields; this writes them back as the lines a legend
 * would print — `6" METAL STUDS AT 24" O.C.`, `2 LAYERS 5/8" TYPE "X" GYP.
 * BOARD EACH SIDE` — and hands them to `readPartitionAssembly`, the one
 * parser that turns words into stud, track, board and insulation lines. So a
 * proposal reads the same whichever way the legend was read, the quantity
 * basis of each line is decided in one place, and the sight read cannot
 * propose a component the text read could not. The lines it wrote are kept
 * as the components' evidence, marked as the model's reading.
 */
export function assemblyFromSight(type: WallTypeSight, where: string): PartitionAssembly {
  // ── NOT A PARTITION: SAID, NOT PROPOSED ──
  if (type.notAPartition !== null) {
    return {
      components: [],
      flags: [{ why: `not a partition — the legend calls this a ${type.notAPartition}; nothing is proposed for it`, phrase: type.notes.join(" ").slice(0, 120) }],
      read: { studWidthIn: null, studSpacingIn: null, studGauge: null, boardThicknessIn: null, layersPerSide: null, boardIsTypeX: false, insulation: null, hourlyRating: type.hourlyRating },
    };
  }
  const lines: string[] = [];
  // A concrete or masonry wall has no studs to count, whatever width the
  // model read off its section: board only, and the flag below says why.
  const framed = type.studMaterial !== "masonry" && type.studMaterial !== "concrete";
  if (type.studWidthIn !== null && framed) {
    const material = type.studMaterial === "wood" ? "WOOD" : "METAL";
    lines.push(
      `${inches(type.studWidthIn)} ${material} STUDS` +
        (type.studGauge === null ? "" : ` ${type.studGauge} GA.`) +
        (type.studSpacingIn === null ? "" : ` AT ${inches(type.studSpacingIn)} O.C.`),
    );
  }
  const sides = [type.layersSideA, type.layersSideB].filter((n): n is number => n !== null);
  const layers = sides.length === 0 ? (type.boardThicknessIn === null ? null : 1) : Math.max(...sides);
  const oneSided = sides.length === 2 && sides.includes(0) && layers !== null && layers > 0;
  if (type.boardThicknessIn !== null && layers !== null && layers > 0) {
    lines.push(
      `${layers} LAYER${layers === 1 ? "" : "S"} ${inches(type.boardThicknessIn)} ${type.boardIsTypeX ? 'TYPE "X" ' : ""}GYP. BOARD ${oneSided ? "ONE SIDE ONLY" : "EACH SIDE"}`,
    );
  }
  if (type.insulation !== null) lines.push(/BATT|INSUL/i.test(type.insulation) ? type.insulation : `${type.insulation} INSULATION`);
  if (type.hourlyRating !== null) lines.push(type.hourlyRating === 0 ? "NO RATING" : `${type.hourlyRating} HR`);
  const assembly = readPartitionAssembly({ lines, where: `${where}, read by sight` });
  // The read keeps what the model saw, so a thickness band can still use it.
  if (!framed && type.studWidthIn !== null) assembly.read.studWidthIn = type.studWidthIn;

  const flags: AssemblyFlag[] = [...assembly.flags];
  const evidence = type.notes.join(" ").slice(0, 120);
  if (type.studWidthIn !== null && type.fromDrawing.includes("tagKey")) {
    flags.push({ why: `the ${inches(type.studWidthIn)} stud was decoded from the sheet's tag key, not printed beside the type — check the key`, phrase: evidence });
  } else if (type.studWidthIn !== null && type.fromDrawing.includes("studWidthIn")) {
    flags.push({ why: `the ${inches(type.studWidthIn)} stud was read off the drawing, not a printed size — check it against the section`, phrase: evidence });
  }
  if (sides.length === 2 && sides[0] !== sides[1] && !oneSided) {
    flags.push({ why: `the two faces carry different layer counts (${sides[0]} and ${sides[1]}); the quantity uses ${layers} per side — check the drawing`, phrase: evidence });
  }
  if (!framed) {
    flags.push({ why: `the wall is ${type.studMaterial} — board only; the framing is not this trade's`, phrase: evidence });
  }
  if (type.fromSheetNote.length > 0) {
    flags.push({
      why: `${type.fromSheetNote.join(", ")} came from a general note on the sheet, not this type's own words — check before bidding`,
      phrase: type.notes.find((n) => /ASSUME|ALL STUDS|ALL PARTITIONS|GENERAL/i.test(n)) ?? evidence,
    });
  }
  if (type.optional.length > 0) {
    flags.push({ why: `optional on the drawing, not counted: ${type.optional.join("; ")}`, phrase: type.optional.join("; ") });
  }
  return { ...assembly, flags };
}

/** `3 5/8"`, in the form the parser reads. */
function inches(value: number): string {
  return `${fraction(value).replace("-", " ")}"`;
}

/** A type counts as FULLY read when its stud and its board are both known. */
export function fullyRead(assembly: PartitionAssembly): boolean {
  return assembly.read.studWidthIn !== null && assembly.read.boardThicknessIn !== null && assembly.read.layersPerSide !== null;
}

/**
 * ── WHERE EACH TYPE'S DETAIL IS ON THE LEGEND PAGE ──
 *
 * A legend drawn as details puts each type's code at the top of its cell and
 * the section below it; a legend drawn as a tag key puts the code in a box
 * and the notes to its RIGHT. The crop for a type is a box around the code's
 * text, a little above it, well to the right of it, and tall enough to take
 * in a section and its notes. Measured on Baker A601: a crop centred on the
 * code cut its notes off mid-word, and the model then read the stud width
 * out of the code's letters. And NG Green Bay A3.2 prints each code UNDER
 * its detail, so the crop reaches as far above the code as below it, at the
 * cost of a neighbour showing at the top on sets that print it above.
 * Points, page coordinates, `y` down.
 *
 * Where a code is printed more than once (a key, a note), the printing with
 * the most other text beneath it is taken: that is the detail, the others
 * are mentions.
 */
export const CROP_INCHES = { left: 1.0, right: 4.0, above: 3.5, below: 4.5 };

/**
 * ── WHERE THE DETAIL IS, ABOVE OR BELOW THE CODE ──
 *
 * `above`/`below` split the crop's height around the code's printing, and
 * the split was fixed at 3.5 in above for the Crosslines shape — a section
 * drawn above a boxed letter. Baker draws it the other way: the code box
 * sits ABOVE its section and the rated-assembly notes, so a fixed 3.5 in
 * above took in the unrelated detail higher on the sheet and cut the type's
 * own drawing at the bottom. So the window SLIDES: every half-inch split
 * from 0.5 in above the code to 0.5 in below it is scored by the assembly
 * words it holds, and the best wins, with the original 3.5 in split as the
 * tie-break so a legend whose words sit all around the code is placed as
 * before. The crop's size never changes; only where the code sits in it.
 */
const SPLIT_STEP_IN = 0.5;
const SPLIT_MARGIN_IN = 0.5;

export type CropRect = { code: string; x: number; y: number; width: number; height: number };

/** Words that only appear where an assembly is being described. */
const ASSEMBLY_WORD = /\bSTUDS?\b|\bGYP|\bBOARD\b|\bBATT|\bINSUL|\bO\.?\s?C\.?\b|\bTRACK\b|\bCMU\b|\bCONCRETE\b|\bLAYERS?\b|\bRATED\b|\bGA\.?\b/i;

/**
 * ── WHICH PRINTING OF THE CODE IS THE DETAIL'S ──
 *
 * `A` is printed on Crosslines' A001 as a partition type, a column-grid
 * letter and an entry in the electrical symbol legend, and the first rule
 * — most text nearby — chose the symbol legend, which has the most text of
 * anything on the sheet. Two things single out the legend's own printing:
 * it sits inside a closed symbol (the boxed letter under the section), and
 * the text around it is about an ASSEMBLY — studs, board, batts, o.c. —
 * rather than about anything. So a printing inside a symbol beats one that
 * is not, assembly words nearby beat other words, and plain text density is
 * only the tie-break. `symbols` are the legend page's own, from
 * `tagSymbols`; without them the second and third rules still apply.
 */
export function legendCropRects(input: {
  text: readonly TextForSymbol[];
  codes: readonly string[];
  widthPt: number;
  heightPt: number;
  pointsPerInch?: number;
  /** Closed symbols on the legend page, so a boxed code outranks a bare one. */
  symbols?: readonly { x: number; y: number; radius: number }[];
  /** `density` is the first rule, kept so the miss rate can be compared. */
  strategy?: "density" | "assembly";
}): CropRect[] {
  const ppi = input.pointsPerInch ?? 72;
  const out: CropRect[] = [];
  const strategy = input.strategy ?? "assembly";
  for (const code of input.codes) {
    // `1` is also printed as `WALL TYPE 1` (MHK heads each legend row that
    // way), so a printing that is the code with its label counts.
    const printings = input.text.filter((t) => {
      const s = t.str.trim().toUpperCase();
      return s === code.toUpperCase() || s.replace(/^(?:WALL|PARTITION|PART\.?)\s+TYPE\s+|^TYPE\s+/, "") === code.toUpperCase();
    });
    if (printings.length === 0) continue;
    const scored = printings.map((p) => {
      const cx = p.x + p.width / 2;
      const cy = p.y - p.height / 2;
      const near = input.text.filter(
        (t) =>
          t !== p &&
          t.y > p.y - CROP_INCHES.above * ppi &&
          t.y < p.y + CROP_INCHES.below * ppi &&
          Math.abs(t.x + t.width / 2 - cx) < CROP_INCHES.right * ppi,
      );
      const inSymbol = (input.symbols ?? []).some((s) => Math.hypot(s.x - cx, s.y - cy) <= s.radius);
      const assembly = near.filter((t) => ASSEMBLY_WORD.test(t.str)).length;
      const score = strategy === "density" ? near.length : (inSymbol ? 1000 : 0) + assembly * 10 + Math.min(near.length, 9);
      return { p, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const p = scored[0].p;
    const cx = p.x + p.width / 2;
    const x = Math.max(0, cx - CROP_INCHES.left * ppi);
    const width = Math.min(input.widthPt - x, (CROP_INCHES.left + CROP_INCHES.right) * ppi);
    const totalIn = CROP_INCHES.above + CROP_INCHES.below;
    const top = p.y - p.height;
    let best = { above: CROP_INCHES.above, words: -1 };
    for (let above = SPLIT_MARGIN_IN; above <= totalIn - SPLIT_MARGIN_IN + 1e-9; above += SPLIT_STEP_IN) {
      const y0 = top - above * ppi;
      const y1 = y0 + totalIn * ppi;
      const words = input.text.filter(
        (t) => t !== p && t.y >= y0 && t.y <= y1 && t.x + t.width >= x && t.x <= x + width && ASSEMBLY_WORD.test(t.str),
      ).length;
      const closer = Math.abs(above - CROP_INCHES.above) < Math.abs(best.above - CROP_INCHES.above);
      if (words > best.words || (words === best.words && closer)) best = { above, words };
    }
    const y = Math.max(0, top - best.above * ppi);
    const height = Math.min(input.heightPt - y, totalIn * ppi);
    out.push({ code, x, y, width, height });
  }
  return out;
}
