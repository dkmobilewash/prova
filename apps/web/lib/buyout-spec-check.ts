// Which spec findings a buyer should read before buying a line. Diego's first
// step, 2026-10-30: show them, do not judge them. Nothing here says a quote
// meets or misses a spec, and an empty result is not a clearance: it only means
// nothing was found in the sections somebody uploaded and read.
//
// Pure. Imports nothing from lib/takeoff. lib/buyout-spec-query.ts reads the
// rows. A job line has no spec section of its own, so a finding reaches a line
// through its trade, from the section number. NOTHING IS DROPPED: a finding that
// cannot be placed on a row goes in `unplaced`, which the page shows at the top.

import type { SpecFindingKind } from "@prova/integrations/src/specs";
import type { SpecFindingView } from "@/lib/specs/spec-findings";

/** What a buyer can act on. Contract terms such as liquidated damages are real
 * findings and stay on the bid; they do not change what gets bought. */
export const BUYOUT_FINDING_KINDS: readonly SpecFindingKind[] = [
  "NAMED_PRODUCT",
  "FIRE_RATING",
  "ACOUSTIC",
  "FINISH_LEVEL",
  "PERFORMANCE",
];

export type Trade = "METAL_FRAMING_DRYWALL" | "LATH_PLASTER" | "EIFS" | "ACOUSTICAL_CEILINGS" | "FIREPROOFING";

const SECTION_TRADES: readonly (readonly [string, Trade])[] = [
  ["0921", "METAL_FRAMING_DRYWALL"],
  ["0922", "METAL_FRAMING_DRYWALL"],
  ["0929", "METAL_FRAMING_DRYWALL"],
  ["0923", "LATH_PLASTER"],
  ["0924", "LATH_PLASTER"],
  ["0724", "EIFS"],
  ["0951", "ACOUSTICAL_CEILINGS"],
  ["0953", "ACOUSTICAL_CEILINGS"],
  ["0781", "FIREPROOFING"],
];

/** The section number is free text as printed, so digits only. Null when it is
 * not one of this product's trades. */
export function tradeForSection(sectionNumber: string): Trade | null {
  const digits = sectionNumber.replace(/\D/g, "");
  return SECTION_TRADES.find(([prefix]) => digits.startsWith(prefix))?.[1] ?? null;
}

export type ReadSection = { sectionNumber: string; findings: readonly SpecFindingView[] };

export type BuyoutFinding = SpecFindingView & { sectionNumber: string };

export type BuyoutSpecCheck = {
  byLine: Map<string, BuyoutFinding[]>;
  unplaced: BuyoutFinding[];
  sectionsRead: number;
};

export function buyoutSpecCheck(
  lines: readonly { id: string; tradeScope: string | null }[],
  sections: readonly ReadSection[],
): BuyoutSpecCheck {
  const byLine = new Map<string, BuyoutFinding[]>();
  const unplaced: BuyoutFinding[] = [];
  for (const section of sections) {
    const trade = tradeForSection(section.sectionNumber);
    const matching = trade ? lines.filter((line) => line.tradeScope === trade) : [];
    for (const finding of section.findings) {
      if (!BUYOUT_FINDING_KINDS.includes(finding.kind)) continue;
      const row = { ...finding, sectionNumber: section.sectionNumber };
      if (matching.length === 0) unplaced.push(row);
      for (const line of matching) byLine.set(line.id, [...(byLine.get(line.id) ?? []), row]);
    }
  }
  return { byLine, unplaced, sectionsRead: sections.length };
}

/** The sentence over the list. Says what was and was not looked at, and never
 * that anything is fine. */
export function specCheckSentence(check: Pick<BuyoutSpecCheck, "sectionsRead">): string {
  if (check.sectionsRead === 0) {
    return "No spec section has been read for this job, so nothing below reflects the spec.";
  }
  const n = check.sectionsRead;
  return `From ${n} spec section${n === 1 ? "" : "s"} read on the bid. Sections nobody read are not included, so compare against the spec yourself.`;
}
