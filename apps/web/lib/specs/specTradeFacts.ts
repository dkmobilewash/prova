import type { SpecTradeRead } from "@prova/integrations/src/specTrade";
import { fraction, inchesFrom, readPartitionAssembly } from "@/lib/takeoff/partitionAssembly";

/**
 * ── THE SPEC'S FACTS AS NUMBERS, AND A WALL TYPE CHECKED AGAINST THEM ──
 *
 * The reader copies phrases ("20 gauge (33 mil) minimum", "16 inches on center
 * maximum", "5/8 inch"). This reads numbers out of them — the model's reading of a
 * number is never used, the legend reader's rule — and lays a legend wall type's own
 * read (`readPartitionAssembly`) beside them: what the spec says applies to that
 * type, and where the two disagree. All code, all tested; nothing here is a price.
 */

/** Mils (the steel's design thickness) to the gauge it is sold as. */
const GAUGE_BY_MIL: Record<number, number> = { 18: 25, 19: 25, 27: 22, 30: 20, 33: 20, 43: 18, 54: 16, 68: 14, 97: 12 };

/** "20 gauge", "20 ga.", "20GA", "33 mil", "(33 mils)" → gauge number. Null when the words give none. */
export function gaugeFrom(text: string): number | null {
  const ga = text.match(/\b(\d{2})\s*-?\s*(?:ga\.?|gauge|gage)\b/i);
  if (ga) return Number(ga[1]);
  const mil = text.match(/\b(\d{2})\s*-?\s*mils?\b/i);
  return mil ? (GAUGE_BY_MIL[Number(mil[1])] ?? null) : null;
}

/** "16 inches on center", "16" o.c.", "24 in. OC" → 16 / 24. */
export function spacingFrom(text: string): number | null {
  const hit = text.match(/\b(\d{1,2})\s*(?:inches|inch|in\.?|"|″)?\s*(?:on\s+center|o\.?\s*c\.?)\b/i);
  return hit ? Number(hit[1]) : null;
}

/** "5/8 inch", "5/8"", "1/2-inch" → inches; null when it is not a board thickness. */
export function thicknessFrom(text: string): number | null {
  const inches = inchesFrom(text);
  return inches !== null && inches > 0 && inches <= 1.25 ? inches : null;
}

const isTypeX = (kind: string) => /\btype\s*['"]?\s*x\b|fire[-\s]?rated|\bType C\b/i.test(kind);

export type SectionFacts = { sectionNumber: string; read: SpecTradeRead };

export type WallTypeSpecCheck = {
  code: string;
  /** One line per section that applies — `09 21 16: 5/8" Type X, Level 4`. */
  applies: string[];
  conflicts: { what: string; legend: string; spec: string; sectionNumber: string; quote: string }[];
};

/**
 * What the spec says about one legend wall type, from the type's own lines.
 *
 * WHICH SECTIONS APPLY is decided by what the wall is made of, never by the model:
 * board facts for a wall with gypsum board, stud facts for a wall with studs. A rated
 * wall gets the section's Type X board; an unrated one its ordinary board.
 */
export function checkWallType(type: { code: string; lines: readonly string[] }, sections: readonly SectionFacts[]): WallTypeSpecCheck {
  const wall = readPartitionAssembly({ lines: type.lines, where: type.code }).read;
  const hasBoard = wall.boardThicknessIn !== null || wall.layersPerSide !== null || /gyp|gwb|board/i.test(type.lines.join(" "));
  const hasStuds = wall.studWidthIn !== null || wall.studGauge !== null || /stud/i.test(type.lines.join(" "));
  const rated = (wall.hourlyRating ?? 0) > 0;
  const check: WallTypeSpecCheck = { code: type.code, applies: [], conflicts: [] };

  for (const { sectionNumber, read } of sections) {
    const parts: string[] = [];

    if (hasBoard && read.boards.length > 0) {
      const typeX = read.boards.filter((b) => isTypeX(b.kind));
      // The board that applies to THIS wall: the Type X on a rated wall, the board with no "where" on any other
      // (plain board first). A board the spec puts somewhere else (corridors, wet areas) is not checked against it.
      const applicable = rated ? typeX : read.boards.filter((b) => b.where === null).sort((a, b) => Number(isTypeX(a.kind)) - Number(isTypeX(b.kind)));
      const board = applicable[0] ?? null;
      if (board) {
        const t = board.thickness === null ? null : thicknessFrom(board.thickness);
        parts.push(`${t === null ? "" : `${fraction(t)}" `}${board.kind}`);
      }
      if (rated && typeX.length > 0 && !wall.boardIsTypeX) {
        check.conflicts.push({ what: "Board on a rated wall", legend: "not Type X", spec: typeX[0].kind, sectionNumber, quote: typeX[0].quote });
      }
      const thick = applicable.flatMap((b) => {
        const t = b.thickness === null ? null : thicknessFrom(b.thickness);
        return t === null ? [] : [{ t, quote: b.quote }];
      });
      const thinnest = thick.length === 0 ? null : thick.reduce((a, b) => (b.t < a.t ? b : a));
      if (wall.boardThicknessIn !== null && thinnest !== null && wall.boardThicknessIn < thinnest.t) {
        check.conflicts.push({
          what: "Board thickness",
          legend: `${fraction(wall.boardThicknessIn)}"`,
          spec: `${fraction(thinnest.t)}" or thicker`,
          sectionNumber,
          quote: thinnest.quote,
        });
      }
    }
    if (hasBoard && read.finishLevels.length > 0) {
      const typical = read.finishLevels.find((f) => f.where === null || /unless|typical|all\b/i.test(f.where)) ?? read.finishLevels[0];
      parts.push(`Level ${typical.level}`);
    }

    if (hasStuds && read.studs.length > 0) {
      const gauges = read.studs.map((s) => (s.gauge === null ? null : gaugeFrom(s.gauge))).filter((n): n is number => n !== null);
      const spacings = read.studs.map((s) => (s.spacing === null ? null : spacingFrom(s.spacing))).filter((n): n is number => n !== null);
      // The spec's minimum is its LIGHTEST stated gauge (the highest number); its spacing limit the widest stated.
      const minGauge = gauges.length > 0 ? Math.max(...gauges) : null;
      const maxSpacing = spacings.length > 0 ? Math.max(...spacings) : null;
      if (minGauge !== null) parts.push(`${minGauge} ga min`);
      if (maxSpacing !== null) parts.push(`${maxSpacing}" o.c. max`);
      const studQuote = (pick: (s: SpecTradeRead["studs"][number]) => boolean) => read.studs.find(pick)?.quote ?? read.studs[0].quote;
      if (minGauge !== null && wall.studGauge !== null && wall.studGauge > minGauge) {
        check.conflicts.push({
          what: "Stud gauge",
          legend: `${wall.studGauge} ga`,
          spec: `${minGauge} ga or heavier`,
          sectionNumber,
          quote: studQuote((s) => s.gauge !== null && gaugeFrom(s.gauge) === minGauge),
        });
      }
      if (maxSpacing !== null && wall.studSpacingIn !== null && wall.studSpacingIn > maxSpacing) {
        check.conflicts.push({
          what: "Stud spacing",
          legend: `${wall.studSpacingIn}" o.c.`,
          spec: `${maxSpacing}" o.c. or closer`,
          sectionNumber,
          quote: studQuote((s) => s.spacing !== null && spacingFrom(s.spacing) === maxSpacing),
        });
      }
      if (read.priceDrivers.some((d) => /deflection|slotted/i.test(`${d.label} ${d.why}`))) parts.push("deflection track");
    }

    if (rated && read.fireRatings.length > 0 && (hasBoard || hasStuds)) {
      const rating = read.fireRatings.find((r) => r.assembly !== null) ?? read.fireRatings[0];
      parts.push(rating.assembly ?? rating.rating);
    }

    if (parts.length > 0) check.applies.push(`${sectionNumber}: ${parts.join(", ")}`);
  }
  return check;
}

/** A stored `facts` JSON back into a read — malformed rows read as empty, never throw. */
export { specTradeReadFrom as specTradeReadFromJson } from "@prova/integrations/src/specTrade";
