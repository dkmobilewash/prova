import type { PlanPdf } from "@/lib/plan-ingest/planPdf";
import { sheetNumberFrom } from "@/lib/plan-ingest/sheetNumber";
import { pageLines } from "./planTextRead";
import { sheetViews } from "./sheetViews";
import { levelMarks, type LevelMark } from "./levelHeights";
import { buildingsOf, ceilingNotesFromLines, heightFactsFromText, labelledWallHeights, lettersNotesFromLines, relativeToFloor, resolveHeight, type HeightFact, type HeightReading } from "./wallHeights";

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
  /** Every level marker the sections and elevations print (`levelMarks`), for a wall's floor-to-floor by its plan's level. */
  levels?: LevelMark[];
  /** The buildings the set's PLAN captions name ("FLOOR PLAN - WAREHOUSE" → WAREHOUSE), for a type's height per building. */
  buildings?: string[];
};

const GENERAL = (f: HeightFact) =>
  f.kind === "note" && /ALL\s+(?:NEW\s+|INTERIOR\s+)?(?:WALLS|PARTITIONS)/i.test(f.text ?? "") && /DECK|STRUCTURE|CEILING|HEIGHT|FULL/i.test(f.text ?? "");

export async function setHeightFacts(doc: PlanPdf, input: { legendPage: number; maxPages?: number }): Promise<SetHeightFacts> {
  const facts: HeightFact[] = [];
  const factSheets: string[] = [];
  const levels: LevelMark[] = [];
  // A caption's tail is a building only where a PLAN is captioned with it too
  // ("FLOOR PLAN - WAREHOUSE"); a wall section's "- BRICK ON MTL STUD" is not.
  const planBuildings = new Set<string>();
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
    const captions = sheetViews(items, t.widthPt).map((v) => v.name);
    const views = captions.join(" | ");
    const buildings = buildingsOf(captions);
    for (const b of buildingsOf(captions.filter((c) => /\bPLAN\b/i.test(c)))) planBuildings.add(b);
    const sheet = r.sheetNumber ?? `p${page}`;
    const isSection = /\bSECTION\b/i.test(views) || /\bSECTION\b/i.test(r.regionText);
    const isCeiling = /CEILING PLAN|RCP/i.test(views) || /CEILING PLAN/i.test(r.regionText);
    // A roof framing plan prints the deck by zone (Joplin S-sheets: "B/DECK EL = 112' - 6""), and an
    // exterior elevation its levels; any sheet may print the floor's datum ("ARCHITECTURAL FFE = 100'-0"").
    const isFraming = /FRAMING PLAN|\bELEVATIONS?\b/i.test(views) || /FRAMING PLAN/i.test(r.regionText);
    // A ceiling plan's numbered notes carry the rule for where partitions stop —
    // Green Bay A4.0 note 9, "TERMINATE ALL PARTITIONS 8" ABOVE HIGHEST ADJACENT CEILING".
    if (page === input.legendPage || isCeiling || /GENERAL NOTES/i.test(items.map((i) => i.str).join(" "))) {
      try {
        const lines = await pageLines(doc, page);
        const notes = lettersNotesFromLines(sheet, lines).map((f) => ({ ...f, sheet: page === input.legendPage ? sheet : `${sheet} (p${page})` }));
        facts.push(...notes);
        if (isCeiling) facts.push(...ceilingNotesFromLines(sheet, lines));
      } catch {
        // the lines did not read; the elevations below still can
      }
    }
    const all = heightFactsFromText({ sheet, items });
    levels.push(...levelMarks(sheet, items));
    facts.push(...all.filter((f) => f.kind === "floor-datum"));
    // An interior elevation names its walls' heights; "SEE SHEET A300" goes there.
    if (/INTERIOR\s+ELEVATIONS?/i.test(views) || /INTERIOR\s+ELEVATIONS?/i.test(r.regionText)) {
      const named = labelledWallHeights({ sheet, items });
      if (named.length > 0) {
        factSheets.push(`${sheet} (interior elevations): ${[...new Set(named.map((f) => f.phrase))].slice(0, 4).join("; ")}`);
        facts.push(...named);
      }
    }
    if (!isSection && !isCeiling && !isFraming) continue;
    const read = all
      .filter((f) => (isSection || isFraming ? f.kind === "structure-elevation" || f.kind === "bearing-elevation" : f.kind === "ceiling-height"))
      // A framing plan's deck is a spot elevation, and so are a structural
      // sheet's details (Joplin S-202's B/DECK EL); an architectural section's
      // is the level. Those count only where no section prints one.
      .map((f) => ((!isSection && /FRAMING PLAN/i.test(`${views} ${r.regionText}`)) || /^S/i.test(sheet) ? { ...f, framing: true } : f))
      .map((f) => (buildings.length > 0 ? { ...f, buildings } : f));
    if (read.length > 0) {
      factSheets.push(`${sheet} (${isSection ? "section" : isFraming ? "framing plan / elevation" : "ceiling plan"}): ${[...new Set(read.map((f) => f.phrase))].slice(0, 4).join("; ")}`);
      facts.push(...read);
    }
  }
  const generalNote = facts.find((f) => GENERAL(f) && !f.sheet.includes("(p")) ?? facts.find(GENERAL) ?? null;
  const located = facts.map((f) => (f.buildings === undefined ? f : { ...f, buildings: f.buildings.filter((b) => planBuildings.has(b)) }));
  return { facts: relativeToFloor(located), generalNote, factSheets, levels, buildings: [...planBuildings] };
}

/** One legend type's height from the set's facts — `resolveHeight` with the set's general note in place. */
export function heightOfLegendType(
  type: { code: string; heightNote: string | null; lines: readonly string[] },
  set: SetHeightFacts,
  /** The buildings a plan sheet's captions name, when the question is that sheet's walls (`buildingsOf`). */
  buildings?: readonly string[],
): HeightReading {
  return resolveHeight({ code: type.code, heightNote: type.heightNote, ownPhrases: type.lines, generalNote: set.generalNote, facts: set.facts, ...(buildings === undefined ? {} : { buildings }) });
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
