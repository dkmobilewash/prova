import { describe, expect, it } from "vitest";
import type { PlanPdf, PlanTextItem } from "@/lib/plan-ingest/planPdf";
import { heightOfLegendType, heightSentence, setHeightFacts } from "./setHeightFacts";

const W = 2592;
const t = (str: string, x: number, y: number, height = 9): PlanTextItem => ({ str, x, y, width: str.length * 5, height });
/** Enough filler for a page to count as a sheet (the gatherer skips pages under 20 items). */
const filler = (n: number) => Array.from({ length: n }, (_, i) => t(`NOTE ${i}`, 100 + i * 7, 2000 + (i % 5) * 20));
function doc(pages: PlanTextItem[][]): PlanPdf {
  return {
    pageCount: pages.length,
    pageText: async (n: number) => ({ pageNumber: n, widthPt: W, heightPt: 1728, rotation: 0, items: pages[n - 1] ?? [] }),
  } as unknown as PlanPdf;
}

describe("setHeightFacts", () => {
  it("takes a deck elevation from a SECTION sheet and a lettered note from the legend page, and resolves a 'to deck' type through them", async () => {
    const legend = [t("WALL TYPES", 200, 100, 20), t("A. ALL WALLS WILL BE TO DECK ABOVE UNLESS OTHERWISE NOTED.", 200, 140), t("A601", 2400, 1700, 14), ...filler(20)];
    const section = [t("BUILDING SECTION", 300, 1600, 16), t('SCALE: 1/4" = 1\'-0"', 300, 1620), t("T.O. ROOF FRAMING", 1200, 400), t("15' - 0\"", 1200, 412), t("A301", 2400, 1700, 14), ...filler(20)];
    const set = await setHeightFacts(doc([legend, section]), { legendPage: 1 });
    expect(set.facts.some((f) => f.kind === "structure-elevation" && f.feet === 15)).toBe(true);
    expect(set.generalNote?.text).toMatch(/TO DECK ABOVE/);
    expect(set.factSheets.join(" ")).toMatch(/section/);
    const reading = heightOfLegendType({ code: "S6A", heightNote: "SEE NOTE A", lines: ['6" METAL STUDS', 'SEE NOTE A'] }, set);
    expect(reading.feet).toBe(15);
    expect(["HIGH", "MEDIUM"]).toContain(reading.confidence);
    expect(heightSentence(reading)).toMatch(/^Height 15 ft \((HIGH|MEDIUM)\)/);
    const onlyNote = heightOfLegendType({ code: "S6B", heightNote: null, lines: ['6" METAL STUDS', "NON-RATED"] }, set);
    expect(onlyNote.feet).toBe(15);
    expect(onlyNote.generalNoteOnly).toBe(true);
    expect(heightSentence(onlyNote)).toMatch(/LOW — general note only, check the sheet/);
  });
  it("a fixed figure on the legend needs no fact, and a 'to deck' type with no section stays unread rather than guessed", async () => {
    const legend = [t("WALL TYPES", 200, 100, 20), ...filler(20)];
    const set = await setHeightFacts(doc([legend]), { legendPage: 1 });
    expect(set.facts.filter((f) => f.kind !== "note")).toEqual([]);
    const fixed = heightOfLegendType({ code: "P5", heightNote: "10'-0\" A.F.F.", lines: ["HEIGHT: 10'-0\" A.F.F."] }, set);
    expect(fixed.feet).toBe(10);
    expect(fixed.confidence).toBe("HIGH");
    const deck = heightOfLegendType({ code: "P1", heightNote: null, lines: ["EXTEND TO DECK"] }, set);
    expect(deck.feet).toBeNull();
    expect(heightSentence(deck)).toMatch(/^No height read: /);
  });
  it("skips a page whose text cannot be read instead of failing the set", async () => {
    const d = doc([[t("WALL TYPES", 200, 100, 20), ...filler(20)]]);
    const broken: PlanPdf = { ...d, pageCount: 2, pageText: async (n: number) => { if (n === 2) throw new Error("no text layer"); return d.pageText(n); } } as PlanPdf;
    await expect(setHeightFacts(broken, { legendPage: 1 })).resolves.toMatchObject({ generalNote: null });
  });
});
