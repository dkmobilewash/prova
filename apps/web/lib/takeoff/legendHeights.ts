import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { readPlanBytes } from "@/lib/plan-ingest/planBytes";
import { storeGeneralHeight, storeLevelMarks } from "./levelReads";
import { heightOfLegendType, heightSentence, setHeightFacts, type SetHeightFacts } from "./setHeightFacts";

/** What the library learned about a type's height — shown on the review row and kept in the type's notes. */
export type LegendHeightResult = {
  heightFt: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  generalNoteOnly: boolean;
  /** The chain, or why there is none — the same sentence the notes keep. */
  sentence: string;
  /** Where the drawing gives one height per part of the building: each, with what printed it, for a person to place. */
  options: { feet: number; from: string }[];
  /** Where the options are by building part: the one each building's plan takes ("WAREHOUSE" → 14'-4"), with its source. */
  byBuilding?: { building: string; feet: number; from: string }[];
};

/** The notes lines a type keeps for its height options — read back by `legendOptions` (`wallHeight.ts`). */
export function heightOptionLines(result: LegendHeightResult): string[] {
  return [
    ...result.options.map((o) => `Height option ${Number(o.feet.toFixed(3))} ft: ${o.from}`),
    // Read back by `buildingHeights` (`wallHeight.ts`): the queue pre-fills a group with its plan's building's.
    ...(result.byBuilding ?? []).map((b) => `Height for ${b.building} ${Number(b.feet.toFixed(3))} ft: ${b.from}`),
  ];
}

export type LegendTypeForHeight = { code: string; lines: readonly string[]; heightNote: string | null };

/** One type's reading against a set's facts, or against none when the set would not open. */
export function legendHeightOf(type: LegendTypeForHeight, set: SetHeightFacts | null, unread: string | null): LegendHeightResult {
  const reading = heightOfLegendType(type, set ?? { facts: [], generalNote: null, factSheets: [] });
  const sentence =
    unread === null || reading.feet !== null
      ? heightSentence(reading)
      : `No height read: ${reading.why} The set could not be read for one (${unread.slice(0, 120)}). Type it on the wall type.`;
  const options = (reading.options ?? []).filter((f) => f.feet !== null).map((f) => ({ feet: f.feet as number, from: `${f.sheet} ${f.phrase}` }));
  // ── ONE HEIGHT PER BUILDING PART (Bunkie: 10'-0" main and addition, 14'-4" warehouses) ──
  // Each building a PLAN names, asked separately: the zone drawn for it, where that settles it.
  const byBuilding =
    set === null || options.length < 2
      ? []
      : (set.buildings ?? []).flatMap((building) => {
          const one = heightOfLegendType(type, set, [building]);
          return one.feet === null ? [] : [{ building, feet: one.feet, from: one.from === null ? one.why.slice(0, 160) : `${one.from.sheet} ${one.from.phrase}` }];
        });
  return { heightFt: reading.feet, confidence: reading.feet === null ? null : reading.confidence, generalNoteOnly: reading.generalNoteOnly, sentence, options, ...(byBuilding.length > 0 ? { byBuilding } : {}) };
}

/**
 * ── EVERY TYPE'S HEIGHT ON ONE LEGEND PAGE, the set read once ──
 *
 * The review page shows these before Add, and `addWallTypeFromLegend` writes
 * the one it is given. Both go through here so the row and the library can
 * never say different things about the same type. The set is opened once per
 * call; a set that will not open leaves every type reading its own words
 * only (a printed figure still resolves) with the reason in the sentence.
 */
export async function legendHeightsFor(input: {
  planId: string;
  companyId: string;
  legendPage: number;
  types: readonly LegendTypeForHeight[];
}): Promise<Map<string, LegendHeightResult>> {
  let set: SetHeightFacts | null = null;
  let unread: string | null = null;
  try {
    const bytes = await readPlanBytes(input.planId, input.companyId);
    if (!bytes.ok) throw new Error(bytes.error);
    const pdf = await openPlanPdf(bytes.bytes);
    try {
      set = await setHeightFacts(pdf, { legendPage: input.legendPage });
      // Kept for the queue: a wall's floor-to-floor by its plan's level. Never at the height's cost.
      await storeLevelMarks(input.planId, set.levels ?? []).catch((error) => console.error("[takeoff] level marks not stored", { planId: input.planId }, error));
      // And the sheet-wide rule, for walls whose type has none (`generalHeightOf`).
      await storeGeneralHeight(input.planId, generalHeightOf(set)).catch((error) => console.error("[takeoff] general height not stored", { planId: input.planId }, error));
    } finally {
      await pdf.close();
    }
  } catch (err) {
    unread = err instanceof Error ? err.message : String(err);
  }
  return new Map(input.types.map((type) => [type.code.toUpperCase(), legendHeightOf(type, set, unread)]));
}

/**
 * ── THE SHEET-WIDE HEIGHT, FOR A WALL WITH NO TYPE RULE OF ITS OWN ──
 *
 * Baker A601 note A: "ALL WALLS WILL BE TO DECK ABOVE UNLESS OTHERWISE NOTED", and
 * the sections put the deck at 15'-0". A typed group already gets that through its
 * type's legend height; an UNTYPED group had only the ceiling plan to go on and
 * suggested 10'-0" (Chrome's re-test, 2026-11-06). The note says what every wall
 * does unless its own type says otherwise, so it outranks the ceiling — and an
 * "N" above the ceiling" note still needs a ceiling, so it gives no figure here.
 */
export function generalHeightOf(set: SetHeightFacts | null): { feet: number; from: string } | null {
  if (set === null || set.generalNote === null) return null;
  const reading = heightOfLegendType({ code: "ALL", heightNote: null, lines: [] }, set);
  if (reading.feet === null || !reading.generalNoteOnly) return null;
  return { feet: reading.feet, from: `general note ${set.generalNote.sheet}: ${reading.why}`.slice(0, 220) };
}
