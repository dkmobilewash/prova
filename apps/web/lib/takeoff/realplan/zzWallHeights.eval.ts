import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetNumberFrom } from "../../plan-ingest/sheetNumber";
import { studsRequired } from "../../takeoff";
import { runGeometry } from "../../wall-assemblies";
import { readPartitionAssembly } from "../partitionAssembly";
import { pageLines } from "../planTextRead";
import { sheetStrokes } from "../sheetStrokes";
import { sheetViews } from "../sheetViews";
import { shapeFromLegend, tagSymbols } from "../tagSymbols";
import { legendVocabulary, tagsFromSymbols } from "../symbolTagging";
import { propagateTypes } from "../typePropagation";
import { heightFactsFromText, lettersNotesFromLines, resolveHeight, type HeightFact } from "../wallHeights";
import { tagByRun } from "../wallTags";
import type { WallCandidate } from "../wallVectors";

/**
 * ── WALL HEIGHTS READ OFF A SET, AND BAKER TAKEN END TO END ──
 *
 * For each set named: the legend's per-type height words (from the cached
 * reads), the lettered general notes on the legend page, the structure
 * elevations off every section sheet and the ceiling tags off every ceiling
 * plan (by title), and `resolveHeight` for each type — basis, feet, the fact
 * it came from, confidence, and the general-note-only flag. Nothing is
 * guessed; an unresolved type prints why.
 *
 * With `HEIGHT_LABEL` (a label file) and `HEIGHT_PLAN` (its page): every
 * accepted wall typed by the plan-text pipeline, and per type the chain
 * legend → LF → height → board SF / studs / track, every figure traceable
 * to a sheet and a phrase. Keyless; skips without its folders.
 *
 *     REAL_PLAN_DIR=… LEGEND_CACHE=… HEIGHT_SET="…pdf" HEIGHT_LEGEND=25 \
 *       [HEIGHT_LABEL=… HEIGHT_PLAN=13] \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzWallHeights.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const SET = process.env.HEIGHT_SET ?? "";
const LEGEND_PAGE = Number(process.env.HEIGHT_LEGEND ?? "0");
const LABEL = process.env.HEIGHT_LABEL ?? "";
const PLAN_PAGE = Number(process.env.HEIGHT_PLAN ?? "0");

/** The fields of a cached sight read this eval uses; the full shape is the integrations package's. */
type SightType = { code: string; studWidthIn: number | null; studSpacingIn: number | null; boardThicknessIn: number | null; layersSideA: number | null; layersSideB: number | null; heightNote: string | null; fromDrawing: string[] };
type WallLegendSightRead = { types: SightType[] };

type LabelFile = { feetPerUnit: number; verdicts: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number; verdict: string }[] };

function latestSight(cacheKey: string): WallLegendSightRead | null {
  const files = readdirSync(CACHE).filter((f) => f.startsWith(`${cacheKey}-p${LEGEND_PAGE}-wall-legend-sight.`)).sort();
  return files.length === 0 ? null : (JSON.parse(readFileSync(join(CACHE, files[files.length - 1]), "utf8")) as WallLegendSightRead);
}

describe.skipIf(DIR === "" || CACHE === "" || SET === "" || LEGEND_PAGE === 0)("wall heights off the drawings", () => {
  it("reads each type's height with its source and confidence, and prices Baker end to end", { timeout: 1_800_000 }, async () => {
    const cacheKey = SET.replace(/\W+/g, "_");
    const textAt = join(CACHE, `${cacheKey}-p${LEGEND_PAGE}-wall-legend.1.json`);
    expect(existsSync(textAt), `no text read cached at ${textAt}`).toBe(true);
    const text = JSON.parse(readFileSync(textAt, "utf8")) as WallLegendRead;
    const sight = latestSight(cacheKey);
    expect(text.types.length, "the legend read has no types").toBeGreaterThan(0);
    const pdf = () => Buffer.from(readFileSync(join(DIR, SET)));
    const doc = await openPlanPdf(pdf());
    expect(doc.pageCount).toBeGreaterThan(0);

    // ── FACTS, FROM THE SHEETS THAT CARRY THEM ──
    const facts: HeightFact[] = [];
    const factSheets: string[] = [];
    for (let page = 1; page <= doc.pageCount; page++) {
      const t = await doc.pageText(page);
      const items = t.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      if (items.length < 20) continue;
      const r = sheetNumberFrom({ pageNumber: page, widthPt: t.widthPt, heightPt: t.heightPt, rotation: 0, items });
      const views = sheetViews(items, t.widthPt).map((v) => v.name).join(" | ");
      const sheet = `${r.sheetNumber ?? `p${page}`}`;
      const isSection = /\bSECTION\b/i.test(views) || /\bSECTION\b/i.test(r.regionText);
      const isCeiling = /CEILING PLAN|RCP/i.test(views) || /CEILING PLAN/i.test(r.regionText);
      // A sheet-wide rule can sit on the legend sheet (Baker's note A) or on
      // the floor plan's general notes; read every lettered note that names
      // walls, and let the legend page's win below.
      if (page === LEGEND_PAGE || /GENERAL NOTES/i.test(items.map((i) => i.str).join(" "))) {
        facts.push(...lettersNotesFromLines(sheet, await pageLines(doc, page)).map((f) => ({ ...f, sheet: page === LEGEND_PAGE ? sheet : `${sheet} (p${page})` })));
      }
      if (!isSection && !isCeiling) continue;
      const read = heightFactsFromText({ sheet, items }).filter((f) => (isSection ? f.kind === "structure-elevation" || f.kind === "bearing-elevation" : f.kind === "ceiling-height"));
      if (read.length > 0) {
        factSheets.push(`${sheet} (${isSection ? "section" : "ceiling plan"}): ${[...new Set(read.map((f) => f.phrase))].slice(0, 4).join("; ")}`);
        facts.push(...read);
      }
    }
    const isGeneral = (f: HeightFact) => f.kind === "note" && /ALL\s+(?:NEW\s+|INTERIOR\s+)?(?:WALLS|PARTITIONS)/i.test(f.text ?? "") && /DECK|STRUCTURE|CEILING|HEIGHT|FULL/i.test(f.text ?? "");
    const generalNote = facts.find((f) => isGeneral(f) && !f.sheet.includes("(p")) ?? facts.find(isGeneral) ?? null;
    console.log(`\n=== ${SET}: legend p${LEGEND_PAGE}, ${text.types.length} types`);
    console.log(`  facts: ${factSheets.join(" || ") || "none"}`);
    console.log(`  general note: ${generalNote === null ? "none" : `${generalNote.sheet} "${generalNote.phrase}"`}`);

    // ── EACH TYPE'S HEIGHT ──
    const readings = text.types.map((t) => {
      const s = sight?.types.find((x: SightType) => x.code.toUpperCase() === t.code.toUpperCase());
      return resolveHeight({ code: t.code, heightNote: s?.heightNote ?? null, ownPhrases: t.lines, generalNote, facts });
    });
    for (const r of readings) {
      console.log(
        `  ${r.code.padEnd(14)} ${r.feet === null ? "   —  " : `${r.feet.toFixed(1).padStart(5)} ft`}  ${r.confidence.padEnd(6)} ${r.generalNoteOnly ? "GENERAL NOTE ONLY " : ""}${r.basis?.kind ?? "no basis"}: ${r.why}`,
      );
    }
    expect(readings.length).toBe(text.types.length);

    // ── BAKER END TO END, WHEN A LABEL FILE IS GIVEN ──
    if (LABEL !== "" && PLAN_PAGE > 0 && sight !== null) {
      const label = JSON.parse(readFileSync(LABEL, "utf8")) as LabelFile;
      const walls: WallCandidate[] = label.verdicts.filter((v) => v.verdict === "wall").map((v) => ({ x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, lengthFeet: v.lengthFeet, thicknessFeet: v.thicknessFeet }));
      const fpu = label.feetPerUnit;
      const codes = text.types.map((t) => t.code.toUpperCase());
      const legendRead = await sheetStrokes(pdf(), LEGEND_PAGE);
      const legendItems = (await doc.pageText(LEGEND_PAGE)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const shape = shapeFromLegend(tagSymbols({ segments: legendRead.segments, text: legendItems, unitsPerPaperInch: 72 }), { codes });
      const planRead = await sheetStrokes(pdf(), PLAN_PAGE);
      const items = (await doc.pageText(PLAN_PAGE)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const symbols = tagSymbols({ segments: planRead.segments, text: items, unitsPerPaperInch: 72 });
      const bySymbol = tagsFromSymbols({ symbols, legendCodes: codes, shape, walls, feetPerUnit: fpu, widthPt: planRead.widthPt });
      const vocabulary = legendVocabulary(codes);
      const tagged = tagByRun(walls, bySymbol.tags, fpu);
      const typed = propagateTypes({ walls, tagged, feetPerUnit: fpu, defaultCode: null });
      const feetByCode = new Map<string, { feet: number; runs: number; propagated: number }>();
      for (const [run, t] of typed.byRun) {
        const e = feetByCode.get(t.code) ?? { feet: 0, runs: 0, propagated: 0 };
        e.feet += run.lengthFeet; e.runs += 1; if (t.source === "propagated") e.propagated += run.lengthFeet;
        feetByCode.set(t.code, e);
      }
      const accepted = walls.reduce((s, w) => s + w.lengthFeet, 0);
      console.log(`\n  --- end to end on ${LABEL.split("/").slice(-2).join("/")}: ${walls.length} accepted walls, ${accepted.toFixed(0)} ft; ${typed.feet.tagged.toFixed(0)} ft tagged + ${typed.feet.propagated.toFixed(0)} ft carried, ${typed.feet.untyped.toFixed(0)} ft untyped (no quantities) ---`);
      void vocabulary;
      for (const [code, e] of [...feetByCode].sort((a, b) => b[1].feet - a[1].feet)) {
        const reading = readings.find((r) => r.code.toUpperCase() === code.toUpperCase());
        const s = sight.types.find((x: SightType) => x.code.toUpperCase() === code.toUpperCase());
        if (reading === undefined || s === undefined) continue;
        const assembly = readPartitionAssembly({ lines: text.types.find((t) => t.code.toUpperCase() === code.toUpperCase())?.lines ?? [], where: `legend p${LEGEND_PAGE}` });
        const layers = (s.layersSideA ?? 0) + (s.layersSideB ?? 0);
        const spacing = assembly.read.studSpacingIn ?? s.studSpacingIn ?? 16;
        console.log(`\n  ${code}: ${e.feet.toFixed(1)} LF over ${e.runs} runs (${e.propagated.toFixed(0)} ft carried along the wall)  [label file ${LABEL.split("/").pop()}, tags on p${PLAN_PAGE}]`);
        console.log(`     height: ${reading.feet === null ? "UNRESOLVED — " + reading.why : `${reading.feet} ft ${reading.confidence}${reading.generalNoteOnly ? " (general note only)" : ""} — ${reading.why}`}`);
        if (reading.feet === null) continue;
        const geometry = runGeometry(
          { id: code, label: code, wallTypeId: code, lengthFt: e.feet, heightFt: reading.feet, openings: [] },
          { id: code, code, defaultHeightFt: null, sides: 2, studSpacingIn: spacing, boardLayers: null, components: [] },
        );
        if (geometry === null) continue;
        const sides = (s.layersSideA ?? 0) > 0 && (s.layersSideB ?? 0) > 0 ? 2 : 1;
        const boardSf = e.feet * reading.feet * layers;
        const studs = studsRequired(e.feet, { spacingFt: spacing / 12 });
        console.log(`     stud width ${s.studWidthIn ?? "?"}" at ${spacing}" o.c. [legend p${LEGEND_PAGE}${s.fromDrawing.includes("studWidthIn") ? ", read off the drawing" : ""}]; board ${s.boardThicknessIn ?? "?"}" × ${s.layersSideA ?? 0}+${s.layersSideB ?? 0} layers [legend p${LEGEND_PAGE}]`);
        console.log(`     board:  ${e.feet.toFixed(1)} LF × ${reading.feet} ft × ${layers} layer${layers === 1 ? "" : "s"} = ${boardSf.toFixed(0)} SF (${sides} side${sides === 1 ? "" : "s"}; face ${geometry.faceSqFt.toFixed(0)} SF, no openings deducted — none read)`);
        if (assembly.read.studWidthIn === null) {
          console.log(`     studs/track: none — the legend names no stud for this type (${assembly.components.map((c) => c.description).join(", ") || "no parts read"})`);
        } else {
          console.log(`     studs:  ${e.feet.toFixed(1)} LF ÷ ${spacing}" o.c. + 1 per run = ${studs} studs (studsRequired)`);
          console.log(`     track:  ${e.feet.toFixed(1)} LF × 2 (top and bottom) = ${(e.feet * 2).toFixed(0)} LF`);
        }
        for (const c of assembly.components) console.log(`       part: ${c.description} — ${c.basis}${c.factor !== 1 ? ` × ${c.factor}` : ""}${c.unit ? ` ${c.unit}` : ""}  [${c.from.where}: ${c.from.phrase.slice(0, 50)}]`);
      }
    }
    await doc.close();
  });
});
