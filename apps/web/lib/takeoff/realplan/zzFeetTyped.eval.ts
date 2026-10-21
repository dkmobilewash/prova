import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { bareTextTags } from "../bareTextTags";
import { sheetStrokes } from "../sheetStrokes";
import { shapeFromLegend, tagSymbols } from "../tagSymbols";
import { legendVocabulary, tagsFromSymbols } from "../symbolTagging";
import { GAP_FEET, propagateTypes, TOUCH_FEET } from "../typePropagation";
import { defaultWallTypeFromNotes } from "../wallNotes";
import { tagByRun, type WallTypeTag } from "../wallTags";
import type { WallCandidate } from "../wallVectors";

/**
 * ── FEET, AGAINST THE WALLS A PERSON ACCEPTED ──
 *
 * `zzTagReport` counts runs. An estimator counts feet, and the feet that
 * matter are the walls a reviewer accepted in the labelling app, not what
 * the finder happened to emit. So this reads a label file, takes every run
 * with verdict `wall` as the sheet's walls, and asks: of those feet, how
 * many get a type from a tag, how many from propagation along the wall, how
 * many from the sheet's U.N.O. note, and how many nothing names.
 *
 *     LABEL_FILE=… REAL_PLAN_DIR=… CHAIN_SET=… CHAIN_LEGEND=… LEGEND_CACHE=… \
 *       [CROP_JSON=…] npx vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzFeetTyped.eval.ts
 */
const LABEL = process.env.LABEL_FILE ?? "";
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const SET = process.env.CHAIN_SET ?? "";
const LEGEND_PAGE = Number(process.env.CHAIN_LEGEND ?? "0");
const PROMPT_VERSION = "wall-legend.1";

type LabelFile = {
  page: number;
  sheet: string;
  feetPerUnit: number;
  verdicts: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number; verdict: string }[];
};

describe.skipIf(LABEL === "" || DIR === "" || CACHE === "" || SET === "")("feet typed against accepted walls", () => {
  it("reports tagged, propagated, default and untyped feet", { timeout: 1_800_000 }, async () => {
    const label = JSON.parse(readFileSync(LABEL, "utf8")) as LabelFile;
    const walls: WallCandidate[] = label.verdicts
      .filter((v) => v.verdict === "wall")
      .map((v) => ({ x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, lengthFeet: v.lengthFeet, thicknessFeet: v.thicknessFeet }));
    const fpu = label.feetPerUnit;
    const acceptedFeet = walls.reduce((s, w) => s + w.lengthFeet, 0);

    const cacheAt = join(CACHE, `${SET.replace(/\W+/g, "_")}-p${LEGEND_PAGE}-${PROMPT_VERSION}.json`);
    expect(existsSync(cacheAt)).toBe(true);
    const legend = JSON.parse(readFileSync(cacheAt, "utf8")) as WallLegendRead;
    const codes = legend.types.map((t) => t.code.toUpperCase());

    // A fresh buffer per call: pdf.js detaches the one it is handed.
    const pdf = () => Buffer.from(readFileSync(join(DIR, SET)));
    const doc = await openPlanPdf(pdf());
    const itemsOf = async (page: number) =>
      (await doc.pageText(page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
    const legendRead = await sheetStrokes(pdf(), LEGEND_PAGE);
    const legendSymbols = tagSymbols({ segments: legendRead.segments, text: await itemsOf(LEGEND_PAGE), unitsPerPaperInch: 72 });
    const shape = shapeFromLegend(legendSymbols, { codes });

    const planRead = await sheetStrokes(pdf(), label.page);
    const items = await itemsOf(label.page);
    const W = planRead.widthPt;
    const symbols = tagSymbols({ segments: planRead.segments, text: items, unitsPerPaperInch: 72 });
    const bySymbol = tagsFromSymbols({ symbols, legendCodes: codes, shape, walls, feetPerUnit: fpu, widthPt: W });

    // ── BARE TEXT, THE SAME VOCABULARY, THEN THE SAME PAIRING ──
    const vocabulary = legendVocabulary(codes);
    const bare = bareTextTags({ text: items, vocabulary: new Set(vocabulary.keys()), symbols, walls, feetPerUnit: fpu, widthPt: W });
    const nearMisses = items
      .filter((i) => vocabulary.has(i.str.trim().toUpperCase()) && !bare.some((b) => b.x === (i.x + i.width / 2) / W))
      .map((i) => {
        const px = (i.x + i.width / 2) / W;
        const py = (i.y - i.height / 2) / W;
        let d = Infinity;
        for (const w of walls) {
          const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len2 = dx * dx + dy * dy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / len2));
          d = Math.min(d, Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy)) * fpu);
        }
        return `${i.str.trim()} ${d.toFixed(1)} ft`;
      });
    const bareTags: WallTypeTag[] = bare.map((b) => ({ name: vocabulary.get(b.text.toUpperCase()) ?? b.text, x: b.x, y: b.y }));
    const tagged = tagByRun(walls, [...bySymbol.tags, ...bareTags], fpu);
    const taggedBySymbolOnly = bySymbol.byRun;

    const matchable = codes.map((code) => ({ id: code, code, name: code, hasParts: true, thicknessIn: null }));
    const note = defaultWallTypeFromNotes(items, matchable);

    const before = propagateTypes({ walls, tagged: taggedBySymbolOnly, feetPerUnit: fpu, defaultCode: null });
    const touchingOnly = propagateTypes({ walls, tagged, feetPerUnit: fpu, defaultCode: null, gapFeet: TOUCH_FEET });
    const withBare = propagateTypes({ walls, tagged, feetPerUnit: fpu, defaultCode: null });
    const after = propagateTypes({ walls, tagged, feetPerUnit: fpu, defaultCode: note?.type.code ?? null });

    const pct = (ft: number) => (acceptedFeet === 0 ? "0%" : `${Math.round((100 * ft) / acceptedFeet)}%`);
    const row = (name: string, feet: { tagged: number; propagated: number; default: number; untyped: number }) =>
      `  ${name.padEnd(26)} tagged ${feet.tagged.toFixed(0).padStart(5)} ft (${pct(feet.tagged)})  propagated ${feet.propagated.toFixed(0).padStart(5)} ft (${pct(feet.propagated)})  default ${feet.default.toFixed(0).padStart(5)} ft (${pct(feet.default)})  untyped ${feet.untyped.toFixed(0).padStart(5)} ft (${pct(feet.untyped)})`;
    console.log(
      `\n${SET} ${label.sheet} p${label.page}: ${walls.length} accepted walls, ${acceptedFeet.toFixed(0)} ft; legend codes ${codes.join(" ")}; ` +
        `${bySymbol.counts.knownToLegend} symbol tags (${bySymbol.counts.matchedToRun} on an accepted wall), ${bare.length} bare-text tags [${bare.map((b) => b.text).join(" ")}] ` +
        `(${tagged.size - taggedBySymbolOnly.size} more walls tagged); U.N.O. default: ${note === null ? "none" : `${note.type.code} from "${note.note}"`}`,
    );
    if (nearMisses.length > 0) console.log(`  exact legend words NOT beside a wall (in a symbol, or too far): ${nearMisses.join(", ")}`);
    console.log(row("symbol tags only", { ...before.feet, propagated: 0, default: 0, untyped: acceptedFeet - before.feet.tagged }));
    console.log(row("+ bare text, no propagation", { ...withBare.feet, propagated: 0, default: 0, untyped: acceptedFeet - withBare.feet.tagged }));
    console.log(row("+ propagation, touching only", touchingOnly.feet));
    console.log(row(`+ propagation across ${GAP_FEET} ft`, withBare.feet));
    console.log(row("+ U.N.O. default", after.feet));
    if (after.conflicts.length > 0) {
      console.log(`  conflicts (two tags reached the same run): ${after.conflicts.map((c) => `${c.codes.join("/")} ${c.run.lengthFeet.toFixed(1)} ft`).join("; ")}`);
    }
    const byCode = new Map<string, number>();
    for (const w of walls) {
      const t = after.byRun.get(w);
      if (t) byCode.set(`${t.code} (${t.source})`, (byCode.get(`${t.code} (${t.source})`) ?? 0) + w.lengthFeet);
    }
    console.log("  feet by code: " + [...byCode].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(" | "));

    if (process.env.CROP_JSON) {
      const crops = walls.flatMap((w) => {
        const t = after.byRun.get(w);
        if (!t || t.source !== "propagated" || !t.via) return [];
        const v = t.via;
        return [{
          code: `${t.code} via`, shape: "propagated", sx: ((v.x1 + v.x2) / 2) * W, sy: ((v.y1 + v.y2) / 2) * W, lx: null, ly: null,
          wall: { x1: w.x1 * W, y1: w.y1 * W, x2: w.x2 * W, y2: w.y2 * W }, distFt: 0,
        }];
      });
      writeFileSync(process.env.CROP_JSON, JSON.stringify({ set: SET, page: label.page, widthPt: W, heightPt: planRead.heightPt, feetPerUnit: fpu, crops }, null, 1));
      console.log(`  wrote ${crops.length} propagated-run crops to ${process.env.CROP_JSON}`);
    }
    expect(walls.length).toBeGreaterThan(0);
  });
});
