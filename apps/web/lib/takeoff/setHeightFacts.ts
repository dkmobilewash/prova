import type { PlanPdf } from "@/lib/plan-ingest/planPdf";
import { sheetNumberFrom } from "@/lib/plan-ingest/sheetNumber";
import { pageLines } from "./planTextRead";
import { sheetViews } from "./sheetViews";
import { heightFactsFromText, lettersNotesFromLines, resolveHeight, type HeightFact, type HeightReading } from "./wallHeights";

/**
 * ── THE HEIGHT FACTS A WHOLE SET PRINTS, gathered once per set ──
 *
 * `wallHeights.ts` reads a type's height in two steps: the WORDS on the
 * legend ("TO DECK", "SEE NOTE A", "10'-0\""), then the FEET from facts
 * printed elsewhere — a section's deck elevation, a ceiling plan's A.F.F.
 * tags, the lettered notes beside the legend, a sheet-wide "ALL WALLS TO
 * DECK U.N.O." This is the gathering half, lifted from the eval that
 * measured it on the training sets so the library action can run the same
 * walk: sections contribute structure and bearing elevations, ceiling plans
 * contribute ceiling heights, the legend page and any GENERAL NOTES sheet
 * contribute lettered notes, and the general note is the first sheet-wide
 * rule found — on the legend's own page first.
 *
 * Every page's text is read, up to `maxPages`, because nothing says which
 * sheet holds the section. Baker's 15 ft is on A301, forty pages from its
 * legend. A page that fails to read is skipped, not fatal: a height is a
 * default an estimator can type over, and a missing one says so.
 */
export type SetHeightFacts = {
  facts: HeightFact[];
  generalNote: HeightFact | null;
  /** One line per sheet that contributed, for the notes: `A301 (section): T.O. ROOF FRAMING 15' 0"`. */
  factSheets: string[];
};

const GENERAL = (f: HeightFact) =>
  f.kind === "note" && /ALL\s+(?:NEW\s+|INTERIOR\s+)?(?:WALLS|PARTITIONS)/i.test(f.text ?? "") && /DECK|STRUCTURE|CEILING|HEIGHT|FULL/i.test(f.text ?? "");

export async function setHeightFacts(doc: PlanPdf, input: { legendPage: number; maxPages?: number }): Promise<SetHeightFacts> {
  const facts: HeightFact[] = [];
  const factSheets: string[] = [];
  const last = Math.min(doc.pageCount, input.maxPages ?? 120);
  for (let page = 1; page <= last; page++) {
    let t: Awaited<ReturnType<PlanPdf["pageText"]>>;
    try {
      t = await doc.pageText(page);
    } catch {
      continue;
    }
    const items = t.items;
    if (items.length < 20) continue;
    const r = sheetNumberFrom({ pageNumber: page, widthPt: t.widthPt, heightPt: t.heightPt, rotation: t.rotation, items });
    const views = sheetViews(items, t.widthPt).map((v) => v.name).join(" | ");
    const sheet = r.sheetNumber ?? `p${page}`;
    const isSection = /\bSECTION\b/i.test(views) || /\bSECTION\b/i.test(r.regionText);
    const isCeiling = /CEILING PLAN|RCP/i.test(views) || /CEILING PLAN/i.test(r.regionText);
    if (page === input.legendPage || /GENERAL NOTES/i.test(items.map((i) => i.str).join(" "))) {
      try {
        const notes = lettersNotesFromLines(sheet, await pageLines(doc, page)).map((f) => ({ ...f, sheet: page === input.legendPage ? sheet : `${sheet} (p${page})` }));
        facts.push(...notes);
      } catch {
        // the lines did not read; the elevations below still can
      }
    }
    if (!isSection && !isCeiling) continue;
    const read = heightFactsFromText({ sheet, items }).filter((f) =>
      isSection ? f.kind === "structure-elevation" || f.kind === "bearing-elevation" : f.kind === "ceiling-height",
    );
    if (read.length > 0) {
      factSheets.push(`${sheet} (${isSection ? "section" : "ceiling plan"}): ${[...new Set(read.map((f) => f.phrase))].slice(0, 4).join("; ")}`);
      facts.push(...read);
    }
  }
  const generalNote = facts.find((f) => GENERAL(f) && !f.sheet.includes("(p")) ?? facts.find(GENERAL) ?? null;
  return { facts, generalNote, factSheets };
}

/** One legend type's height from the set's facts — `resolveHeight` with the set's general note in place. */
export function heightOfLegendType(
  type: { code: string; heightNote: string | null; lines: readonly string[] },
  set: SetHeightFacts,
): HeightReading {
  return resolveHeight({ code: type.code, heightNote: type.heightNote, ownPhrases: type.lines, generalNote: set.generalNote, facts: set.facts });
}

/**
 * The sentence the library keeps beside the type — the chain, with its
 * confidence, so the estimator who reads the notes knows what to check:
 *   `Height 15 ft (MEDIUM): SEE NOTE A → "ALL WALLS TO DECK ABOVE U.N.O."; A301 prints T.O. ROOF FRAMING 15' 0"`
 *   `Height 15 ft (LOW — general note only, check the sheet): …`
 *   `No height read: to the deck, and no deck elevation was found on a section.`
 */
export function heightSentence(reading: HeightReading): string {
  if (reading.feet === null) return `No height read: ${reading.why}`;
  const grade = reading.generalNoteOnly ? `${reading.confidence} — general note only, check the sheet` : reading.confidence;
  return `Height ${Number(reading.feet.toFixed(2))} ft (${grade}): ${reading.why}`;
}
