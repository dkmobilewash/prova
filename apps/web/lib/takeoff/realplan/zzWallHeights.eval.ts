import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { studsRequired } from "../../takeoff";
import { runGeometry } from "../../wall-assemblies";
import { readPartitionAssembly } from "../partitionAssembly";
import { sheetStrokes } from "../sheetStrokes";
import { shapeFromLegend, tagSymbols } from "../tagSymbols";
import { legendVocabulary, tagsFromSymbols } from "../symbolTagging";
import { propagateTypes } from "../typePropagation";
import { buildingsOf, heightBasis, resolveHeight } from "../wallHeights";
import { sheetViews } from "../sheetViews";
import { heightOfLegendType, setHeightFacts } from "../setHeightFacts";
import { roofPartsFor } from "../roofPartsRead";
import { roomPitched, runPitched } from "../roofParts";
import { roomsFromWalls } from "../roomsFromWalls";

import { generalHeightOf } from "../legendHeights";
import { levelHeight, runLevels } from "../levelHeights";
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
    // The newest text read of this legend page (`…-wall-legend.N.json`).
    const reads = readdirSync(CACHE).filter((f) => new RegExp(`^${cacheKey}-p${LEGEND_PAGE}-wall-legend\\.\\d+\\.json$`).test(f)).sort((a, b) => Number(/\.(\d+)\.json$/.exec(a)?.[1]) - Number(/\.(\d+)\.json$/.exec(b)?.[1]));
    const textAt = join(CACHE, reads[reads.length - 1] ?? `${cacheKey}-p${LEGEND_PAGE}-wall-legend.1.json`);
    expect(existsSync(textAt), `no text read cached at ${textAt}`).toBe(true);
    const text = JSON.parse(readFileSync(textAt, "utf8")) as WallLegendRead;
    const sight = latestSight(cacheKey);
    expect(text.types.length, "the legend read has no types").toBeGreaterThan(0);
    const pdf = () => Buffer.from(readFileSync(join(DIR, SET)));
    const doc = await openPlanPdf(pdf());
    expect(doc.pageCount).toBeGreaterThan(0);

    // ── FACTS, FROM THE SHEETS THAT CARRY THEM — the app's own walk (`setHeightFacts`) ──
    const setAll = await setHeightFacts(doc, { legendPage: LEGEND_PAGE });
    const { facts, generalNote, factSheets, levels: levelsAll = [] } = setAll;
    // ── THE ROOF OVER EACH RUN (`roofParts.ts`), as the queue reads it: per run of the WALLS stage ──
    if (PLAN_PAGE > 0 && process.env.HEIGHT_RUNS_DIR) {
      const roofs = await roofPartsFor(doc, setAll);
      const roof = roofs.get(PLAN_PAGE);
      const runsPath = join(process.env.HEIGHT_RUNS_DIR, `${basename(SET)}__p${PLAN_PAGE}.runs.json`);
      console.log(`ROOF_PAGES ${[...roofs.keys()].join(",") || "none"}; this plan ${roof === undefined ? "no roof reading" : `roof ${roof.mask.roofSheet}, ${roof.mask.pitched.length} pitched cells, pitched ${roof.heights.pitched.feet.toFixed(3)} (${roof.heights.pitched.from}) / flat ${roof.heights.flat.feet.toFixed(3)} (${roof.heights.flat.from})`}`);
      if (roof !== undefined && existsSync(runsPath)) {
        const doc2 = JSON.parse(readFileSync(runsPath, "utf8")) as { feetPerUnit: number; runs: { x1: number; y1: number; x2: number; y2: number; thicknessIn: number; type: string | null }[] };
        const planText = await doc.pageText(PLAN_PAGE);
        // The product reads SAVED rooms; here, the room finder over the stage's own runs.
        const rooms = roomsFromWalls({ walls: doc2.runs.map((r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, thicknessFeet: r.thicknessIn / 12 })), feetPerUnit: doc2.feetPerUnit, text: planText.items, widthPt: planText.widthPt }).rooms;
        const set = new Set(roof.mask.pitched);
        const read = rooms.map((r) => ({ xs: r.xs, ys: r.ys, pitched: roomPitched(roof.mask, r, set) }));
        const structure = text.types.filter((t) => [...t.lines, sight?.types.find((x: SightType) => x.code.toUpperCase() === t.code.toUpperCase())?.heightNote ?? ""].some((l) => heightBasis(l)?.kind === "to-structure")).map((t) => t.code.toUpperCase());
        // A room-by-room key (HEIGHT_ROOM_PARTS, Chrome's Joplin key): each key wall's truth, the taller of its rooms' parts.
        if (process.env.HEIGHT_ROOM_PARTS && LABEL !== "") {
          const part = new Map<string, string>();
          for (const line of readFileSync(process.env.HEIGHT_ROOM_PARTS, "utf8").split("\n")) {
            const m = /^([\d.]+)\s*\|[^|]*\|\s*(LOWER|ADMIN|CENTRAL|can't tell)\s*\|/.exec(line.trim());
            if (m) part.set(m[1]!, m[2]!);
          }
          const partFt: Record<string, number> = { LOWER: 12, ADMIN: 12 + 4 / 12, CENTRAL: 16 + 8 / 12 };
          const lab = JSON.parse(readFileSync(LABEL, "utf8")) as LabelFile & { traced?: { x1: number; y1: number; x2: number; y2: number; thicknessFeet?: number }[] };
          const keyWalls = [...lab.verdicts.filter((v) => v.verdict === "wall"), ...(lab.traced ?? [])];
          const keyRooms = roomsFromWalls({ walls: keyWalls, feetPerUnit: lab.feetPerUnit, text: planText.items, widthPt: planText.widthPt }).rooms;
          const inR = (x: number, y: number, xs: number[], ys: number[]) => { let h = false; for (let i = 0, j = xs.length - 1; i < xs.length; j = i, i += 1) if (ys[i]! > y !== ys[j]! > y && x < ((xs[j]! - xs[i]!) * (y - ys[i]!)) / (ys[j]! - ys[i]!) + xs[i]!) h = !h; return h; };
          const truth = keyWalls.flatMap((w) => {
            const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1); if (L === 0) return [];
            const nx = -(w.y2 - w.y1) / L, ny = (w.x2 - w.x1) / L, off = (((w as { thicknessFeet?: number }).thicknessFeet ?? 0.5) / 2 + 1.5) / lab.feetPerUnit, mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
            const sides = [1, -1].map((sg) => { const r = keyRooms.find((q) => inR(mx + sg * nx * off, my + sg * ny * off, q.xs, q.ys)); return r === undefined ? "outside" : r.tag?.number ? (part.get(r.tag.number) ?? "unknown") : "unknown"; });
            if (sides.some((t) => t === "unknown" || t === "can't tell") || sides.every((t) => t === "outside")) return [];
            return [{ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, feet: Math.max(...sides.filter((t) => t !== "outside").map((t) => partFt[t]!)) }];
          });
          console.log(`ROOM_PART_TRUTH_JSON ${JSON.stringify(truth)}`);
        }
        console.log(`ROOF_RUNS_JSON ${JSON.stringify({ pitched: roof.heights.pitched.feet, flat: roof.heights.flat.feet, codes: structure, runs: doc2.runs.map((r) => ({ k: `${r.x1.toFixed(5)},${r.y1.toFixed(5)},${r.x2.toFixed(5)},${r.y2.toFixed(5)}`, roof: runPitched({ ...r, thicknessFeet: r.thicknessIn / 12 }, read, doc2.feetPerUnit) })) })}`);
      }
    }
    console.log(`\n=== ${SET}: legend p${LEGEND_PAGE}, ${text.types.length} types`);
    console.log(`  facts: ${factSheets.join(" || ") || "none"}`);
    console.log(`  general note: ${generalNote === null ? "none" : `${generalNote.sheet} "${generalNote.phrase}"`}`);
    // What an untyped group is offered before the ceiling (`generalHeightOf`).
    console.log(`GENERAL_HEIGHT_JSON ${JSON.stringify(generalHeightOf({ facts, generalNote, factSheets }))}`);

    // ── EACH TYPE'S HEIGHT ──
    const readings = text.types.map((t) => {
      const s = sight?.types.find((x: SightType) => x.code.toUpperCase() === t.code.toUpperCase());
      return resolveHeight({ code: t.code, heightNote: s?.heightNote ?? null, ownPhrases: t.lines, generalNote, facts });
    });
    for (const r of readings) {
      console.log(`HEIGHTJSON ${JSON.stringify({ set: SET, code: r.code, feet: r.feet, options: (r.options ?? []).map((f) => f.feet), why: r.why })}`);
      console.log(
        `  ${r.code.padEnd(14)} ${r.feet === null ? "   —  " : `${r.feet.toFixed(1).padStart(5)} ft`}  ${r.confidence.padEnd(6)} ${r.generalNoteOnly ? "GENERAL NOTE ONLY " : ""}${r.basis?.kind ?? "no basis"}: ${r.why}`,
      );
    }
    expect(readings.length).toBe(text.types.length);
    // What the library writes (`legendHeightOf`), and the same for the plan sheet HEIGHT_PLAN's own building.
    const planBuildings = PLAN_PAGE > 0 ? buildingsOf(sheetViews((await doc.pageText(PLAN_PAGE)).items, (await doc.pageText(PLAN_PAGE)).widthPt).map((v) => v.name)) : [];
    for (const [tag, buildings] of [["PRODUCT_HEIGHTS_JSON", undefined], ["SHEET_HEIGHTS_JSON", planBuildings]] as const) {
      console.log(`${tag} ${JSON.stringify(text.types.map((t) => {
        const s = sight?.types.find((x: SightType) => x.code.toUpperCase() === t.code.toUpperCase());
        const r = heightOfLegendType({ code: t.code, lines: t.lines, heightNote: s?.heightNote ?? null }, { facts, generalNote, factSheets }, buildings);
        return { code: t.code, feet: r.feet, conf: r.feet === null ? null : r.confidence, gno: r.generalNoteOnly, options: (r.options ?? []).map((f) => f.feet), sentence: r.why.slice(0, 160) };
      }))}`);
    }

    // ── BY LEVEL: the plan page's walls take their plan's level (`runLevels`), and a type
    // that runs to the structure takes that level's floor-to-floor — the level of most
    // of the sheet's wall length, which is every wall on a one-plan sheet.
    if (PLAN_PAGE > 0 && LABEL !== "") {
      const label = JSON.parse(readFileSync(LABEL, "utf8")) as LabelFile;
      const t = await doc.pageText(PLAN_PAGE);
      const walls = label.verdicts.filter((v) => v.verdict === "wall");
      const levels = runLevels(walls, sheetViews(t.items, t.widthPt), label.feetPerUnit);
      const feetBy = new Map<string, number>();
      walls.forEach((w, i) => feetBy.set(levels[i]!.join(","), (feetBy.get(levels[i]!.join(",")) ?? 0) + w.lengthFeet));
      const top = [...feetBy].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      const level = top === "" ? null : levelHeight(levelsAll, top.split(",").map(Number));
      console.log(`LEVEL plan p${PLAN_PAGE}: ${[...feetBy].map(([k, f]) => `[${k || "none"}] ${Math.round(f)} ft`).join(", ")} -> ${level === null ? "no floor-to-floor" : `${level.feet.toFixed(3)} ft, ${level.from}`}`);
      console.log(`LEVEL_HEIGHTS_JSON ${JSON.stringify(text.types.map((tp) => {
        const s = sight?.types.find((x: SightType) => x.code.toUpperCase() === tp.code.toUpperCase());
        const r = heightOfLegendType({ code: tp.code, lines: tp.lines, heightNote: s?.heightNote ?? null }, { facts, generalNote, factSheets }, planBuildings);
        return { code: tp.code, feet: level !== null && r.basis?.kind === "to-structure" ? level.feet : r.feet };
      }))}`);
    }

    if (process.env.HEIGHT_PLANS) for (const f of facts.filter((f) => f.kind === "structure-elevation" || f.kind === "bearing-elevation")) console.log(`LEVEL ${f.sheet} zone=${JSON.stringify(f.zone)} buildings=${JSON.stringify(f.buildings ?? [])} ${f.phrase}`);
    // ── PER PLAN SHEET: the zone the sheet's own building takes (HEIGHT_PLANS="31,35") ──
    for (const page of (process.env.HEIGHT_PLANS ?? "").split(",").filter(Boolean).map(Number)) {
      const t = await doc.pageText(page);
      const buildings = buildingsOf(sheetViews(t.items, t.widthPt).map((v) => v.name));
      for (const tp of text.types) {
        const s = sight?.types.find((x: SightType) => x.code.toUpperCase() === tp.code.toUpperCase());
        const r = resolveHeight({ code: tp.code, heightNote: s?.heightNote ?? null, ownPhrases: tp.lines, generalNote, facts, buildings });
        console.log(`HEIGHTSHEET ${JSON.stringify({ set: SET, page, buildings, code: r.code, feet: r.feet, options: (r.options ?? []).map((f) => f.feet) })}`);
      }
    }

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
          { id: code, code, defaultHeightFt: null, sides: 2, studSpacingIn: spacing, components: [] },
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
