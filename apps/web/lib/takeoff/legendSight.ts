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

export type CropRect = { code: string; x: number; y: number; width: number; height: number };

export function legendCropRects(input: {
  text: readonly TextForSymbol[];
  codes: readonly string[];
  widthPt: number;
  heightPt: number;
  pointsPerInch?: number;
}): CropRect[] {
  const ppi = input.pointsPerInch ?? 72;
  const out: CropRect[] = [];
  for (const code of input.codes) {
    const printings = input.text.filter((t) => t.str.trim().toUpperCase() === code.toUpperCase());
    if (printings.length === 0) continue;
    const scored = printings.map((p) => {
      const cx = p.x + p.width / 2;
      const below = input.text.filter(
        (t) =>
          t !== p &&
          t.y > p.y - CROP_INCHES.above * ppi &&
          t.y < p.y + CROP_INCHES.below * ppi &&
          Math.abs(t.x + t.width / 2 - cx) < CROP_INCHES.right * ppi,
      ).length;
      return { p, below };
    });
    scored.sort((a, b) => b.below - a.below);
    const p = scored[0].p;
    const cx = p.x + p.width / 2;
    const x = Math.max(0, cx - CROP_INCHES.left * ppi);
    const y = Math.max(0, p.y - p.height - CROP_INCHES.above * ppi);
    const width = Math.min(input.widthPt - x, (CROP_INCHES.left + CROP_INCHES.right) * ppi);
    const height = Math.min(input.heightPt - y, (CROP_INCHES.above + CROP_INCHES.below) * ppi);
    out.push({ code, x, y, width, height });
  }
  return out;
}
