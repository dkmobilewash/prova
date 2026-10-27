import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { readPlanBytes } from "@/lib/plan-ingest/planBytes";
import { heightOfLegendType, heightSentence, setHeightFacts, type SetHeightFacts } from "./setHeightFacts";

/** What the library learned about a type's height — shown on the review row and kept in the type's notes. */
export type LegendHeightResult = {
  heightFt: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  generalNoteOnly: boolean;
  /** The chain, or why there is none — the same sentence the notes keep. */
  sentence: string;
};

export type LegendTypeForHeight = { code: string; lines: readonly string[]; heightNote: string | null };

/** One type's reading against a set's facts, or against none when the set would not open. */
export function legendHeightOf(type: LegendTypeForHeight, set: SetHeightFacts | null, unread: string | null): LegendHeightResult {
  const reading = heightOfLegendType(type, set ?? { facts: [], generalNote: null, factSheets: [] });
  const sentence =
    unread === null || reading.feet !== null
      ? heightSentence(reading)
      : `No height read: ${reading.why} The set could not be read for one (${unread.slice(0, 120)}). Type it on the wall type.`;
  return { heightFt: reading.feet, confidence: reading.feet === null ? null : reading.confidence, generalNoteOnly: reading.generalNoteOnly, sentence };
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
    } finally {
      await pdf.close();
    }
  } catch (err) {
    unread = err instanceof Error ? err.message : String(err);
  }
  return new Map(input.types.map((type) => [type.code.toUpperCase(), legendHeightOf(type, set, unread)]));
}
