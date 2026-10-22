import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import type { WallLegendSightRead, WallTypeSight } from "@prova/integrations/src/wallLegendSight";
import { assemblyFromSight } from "./legendSight";
import { readPartitionAssembly, type AssemblyFlag, type PartitionAssembly } from "./partitionAssembly";

/**
 * ── TWO READS OF ONE LEGEND, AND WHICH TO BELIEVE WHERE THEY DIFFER ──
 *
 * The text read parses the legend's words; the sight read has the model
 * state fields from the crop AND the words. Measured on the training sets
 * and the three held-out sets (2026-10-21): every disagreement on a printed
 * size went the sight read's way — Camp Bow Wow D's 16in spacing against the
 * text's 48in bracing, NG Green Bay IW-6's two layers on one face, ELEVEN03's
 * MA spacing, MB1 board and WD rating, Lodi's K06/N21 studs the text read had
 * swapped between neighbouring columns. The text read's failure is always
 * attribution: the right words on the wrong type.
 *
 * So the rule is: the sight read wins a field it states; the text read fills
 * a field the sight read left null; and every disagreement is flagged with
 * both values, because "the drawing shows 16in where the words said 48in"
 * is something an estimator wants to read, not have decided silently.
 * Where no sight read exists the text read stands alone, as before.
 */
export type MergedType = {
  code: string;
  assembly: PartitionAssembly;
  /** Which read each component list came from. */
  from: "sight" | "text" | "both";
  /** The fields the two reads disagreed on, text → sight. */
  disagreements: { field: string; text: string; sight: string }[];
};

const FIELDS: (keyof PartitionAssembly["read"])[] = ["studWidthIn", "studGauge", "studSpacingIn", "boardThicknessIn", "layersPerSide", "insulation", "hourlyRating"];

export function mergeLegendReads(input: {
  text: WallLegendRead;
  sight: WallLegendSightRead | null;
  where: string;
}): MergedType[] {
  const out: MergedType[] = [];
  for (const t of input.text.types) {
    const fromText = readPartitionAssembly({ lines: t.lines, where: `${input.where}, type ${t.code}` });
    const s = input.sight?.types.find((one) => sameCode(one.code, t.code)) ?? null;
    if (s === null) {
      out.push({ code: t.code, assembly: fromText, from: "text", disagreements: [] });
      continue;
    }
    // Sight wins what it states; text fills what sight left null.
    const filled: WallTypeSight = { ...s };
    if (filled.studWidthIn === null && fromText.read.studWidthIn !== null) filled.studWidthIn = fromText.read.studWidthIn;
    if (filled.studGauge === null && fromText.read.studGauge !== null) filled.studGauge = fromText.read.studGauge;
    if (filled.studSpacingIn === null && fromText.read.studSpacingIn !== null) filled.studSpacingIn = fromText.read.studSpacingIn;
    if (filled.boardThicknessIn === null && fromText.read.boardThicknessIn !== null) filled.boardThicknessIn = fromText.read.boardThicknessIn;
    if (filled.layersSideA === null && filled.layersSideB === null && fromText.read.layersPerSide !== null) {
      filled.layersSideA = fromText.read.layersPerSide;
      filled.layersSideB = fromText.read.layersPerSide;
    }
    if (filled.insulation === null && fromText.read.insulation !== null) filled.insulation = fromText.read.insulation;
    if (filled.hourlyRating === null && fromText.read.hourlyRating !== null) filled.hourlyRating = fromText.read.hourlyRating;
    if (filled.boardIsTypeX === null) filled.boardIsTypeX = fromText.read.boardIsTypeX;
    const merged = assemblyFromSight(filled, `${input.where}, type ${t.code}`);
    const disagreements: MergedType["disagreements"] = [];
    for (const f of FIELDS) {
      const a = fromText.read[f];
      const b = merged.read[f];
      if (a !== null && b !== null && String(a) !== String(b)) disagreements.push({ field: f, text: String(a), sight: String(b) });
    }
    const flags: AssemblyFlag[] = [
      ...merged.flags,
      ...disagreements.map((d) => ({
        why: `the words say ${d.field} ${d.text} and the drawing shows ${d.sight} — the drawing was kept; check it`,
        phrase: t.lines.find((l) => l.includes(d.text)) ?? d.text,
      })),
    ];
    const anyFromText = FIELDS.some((f) => s[f === "layersPerSide" ? "layersSideA" : f] === null && merged.read[f] !== null);
    out.push({ code: t.code, assembly: { ...merged, flags }, from: anyFromText ? "both" : "sight", disagreements });
  }
  return out;
}

/** `WALL TYPE 1`, `TYPE 1` and `1` are one code; `2 – FURRING` is `2`. */
export function sameCode(a: string, b: string): boolean {
  const short = (c: string) =>
    c.trim().toUpperCase().replace(/^(?:WALL|PARTITION|PART\.?)\s+TYPE\s+|^TYPE\s+/, "").replace(/\s+[-–].*$/, "").trim();
  return short(a) === short(b) || a.trim().toUpperCase() === b.trim().toUpperCase();
}
