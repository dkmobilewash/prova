import { extractWallLegend, extractWallLegendBySight, type WallLegendRead, type WallLegendSightRead } from "@prova/integrations";
import { mergeLegendReads, type MergedType } from "./legendMerge";
import { aiGate } from "@/lib/ai/settings";
import { readPartitionAssembly, type PartitionAssembly } from "./partitionAssembly";

/**
 * ── READING A SET'S PARTITION LEGEND, BEHIND THE COMPANY'S OWN SWITCH ──
 *
 * The model reads the legend's WORDS; this turns them into proposed
 * components with ordinary code. Nothing is written anywhere and nothing is
 * priced: the result is a proposal for a person to accept, and the caller
 * decides what to do with it.
 *
 * ── WHY THIS EXISTS AS APP CODE AND NOT ONLY IN AN EVAL ──
 *
 * `aiFeatureGateCensus` caught it: a model-calling function with no app-side
 * caller is either dead or ungated, and `extractWallLegend` was both — reached
 * only from an eval, which runs outside the switch. A company that has turned
 * `SCHEDULE_READ` off has turned this off, and that cannot be true of a
 * function nothing in the app calls.
 *
 * ── ONCE PER SET, WHICH IS WHAT MAKES IT AFFORDABLE ──
 *
 * A legend is written once for a building and every floor plan refers back to
 * it, so this is one call per SET rather than per sheet. Measured on the real
 * sets: about 5 cents for Camp Bow Wow's five types, 3.5 cents for ELEVEN03's
 * thirteen. The caller is responsible for not asking twice — `legendPages`
 * narrows three hundred pages to one, and the result is worth caching against
 * the file and the prompt version.
 */

export type WallLegendProposal = {
  code: string;
  name: string | null;
  /** The legend's own words, verbatim, so a reviewer can check the source. */
  lines: string[];
  assembly: PartitionAssembly;
};

export type WallLegendResult =
  | { ok: true; proposals: WallLegendProposal[]; reason: string; confidence: WallLegendRead["confidence"] }
  | { ok: false; error: string };

/**
 * Read one legend page and propose each type's components.
 *
 * `where` names the sheet for provenance — it is carried onto every proposed
 * component so the review screen can say which page a number came from.
 */
export async function readWallLegend(input: {
  companyId: string;
  lines: readonly string[];
  pageNumber: number;
  sheetTitle?: string | null;
  where: string;
}): Promise<WallLegendResult> {
  const gate = await aiGate(input.companyId, "SCHEDULE_READ");
  if (!gate.ok) return { ok: false, error: gate.error };

  let read: WallLegendRead;
  try {
    read = await extractWallLegend({
      lines: input.lines,
      pageNumber: input.pageNumber,
      sheetTitle: input.sheetTitle ?? null,
      // The gate has already resolved the model against this company's
      // override, so the call site names its feature once.
      model: gate.model,
    });
  } catch {
    // The message is not surfaced: a thrown model error is redacted in
    // production anyway, and what a reader needs is which page failed.
    return {
      ok: false,
      error: `The wall legend on page ${input.pageNumber} could not be read. Nothing was changed.`,
    };
  }

  return {
    ok: true,
    proposals: read.types.map((type: WallLegendRead["types"][number]) => ({
      code: type.code,
      name: type.name,
      lines: type.lines,
      assembly: readPartitionAssembly({
        lines: type.lines,
        where: `${input.where}, type ${type.code}`,
      }),
    })),
    reason: read.reason,
    confidence: read.confidence,
  };
}

/**
 * ── THE LEGEND READ BY SIGHT, BEHIND THE SAME SWITCH ──
 *
 * The text read above, plus the drawing: the legend page and one crop per
 * type as images (rendered by the caller — in the browser, as the scanned-
 * sheet tiles are, since Node here has no rasteriser), read by
 * `extractWallLegendBySight` and merged with the text read by
 * `mergeLegendReads`, where the drawing wins a disagreement and every
 * disagreement is flagged. Gated per company by `SCHEDULE_READ` exactly as
 * the text read is; nothing here is a price.
 */
export type WallLegendSightResult =
  | { ok: true; types: MergedType[]; reason: string; confidence: WallLegendSightRead["confidence"] }
  | { ok: false; error: string };

export async function readWallLegendBySight(input: {
  companyId: string;
  text: WallLegendRead;
  page: { imageBase64: string; mediaType: "image/png" | "image/jpeg" };
  crops: { code: string; imageBase64: string; mediaType: "image/png" | "image/jpeg" }[];
  lines: readonly string[];
  pageNumber: number;
  sheetTitle?: string | null;
  where: string;
}): Promise<WallLegendSightResult> {
  const gate = await aiGate(input.companyId, "SCHEDULE_READ");
  if (!gate.ok) return { ok: false, error: gate.error };
  let sight: WallLegendSightRead;
  try {
    sight = await extractWallLegendBySight({
      page: input.page,
      crops: input.crops,
      lines: input.lines,
      pageNumber: input.pageNumber,
      sheetTitle: input.sheetTitle ?? null,
      model: gate.model,
    });
  } catch {
    return { ok: false, error: `The wall legend on page ${input.pageNumber} could not be read from the drawing. Nothing was changed.` };
  }
  return { ok: true, types: mergeLegendReads({ text: input.text, sight, where: input.where }), reason: sight.reason, confidence: sight.confidence };
}
