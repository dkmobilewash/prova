import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { detectForSheet } from "../offeredCandidates";
import { planTextTagByRun, isPropagatedTag, plainTag, tagVocabulary } from "../planTextTags";
import { wallTypeTags } from "../wallTags";
import type { MatchableWallType } from "../wallTypeMatch";
import type { WallGroup } from "../wallGroups";

/**
 * ── HOW MUCH OF A FLOOR PLAN'S FOOTAGE GETS A WALL TYPE, AND WHICH ──
 *
 * The finder groups runs by thickness and names them from the drawing's own
 * tags, carried along the wall (`planTextTags.ts`), with the set's partition
 * legend as the vocabulary. This measures the result sheet by sheet on the
 * training sets: feet tagged, carried, defaulted by a note, and untyped; feet
 * per type; and ten random runs with their type, for a person to check in
 * crops.
 *
 *     REAL_PLAN_DIR=… WT_SHEETS="set.pdf:page:fpu:legend.json;…" [WT_OUT=dir] [WT_SEED=n]
 *     npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/wallTypes.eval.ts
 *
 * `legend.json` is the legend read as the ingest stores it (`{types:[{code}]}`),
 * standing in for the WALL_LEGEND proposal; "-" means no legend, so the
 * vocabulary is empty and only a general note can type a wall.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SHEETS = (process.env.WT_SHEETS ?? "").split(";").map((s) => s.trim()).filter(Boolean);
const OUT = process.env.WT_OUT ?? "";
const SEED = Number(process.env.WT_SEED ?? "7");

type Legend = { types: { code: string; name?: string; lines?: string[]; thicknessIn?: number }[]; uno?: { code: string; note: string }[] };

function legendAt(path: string): Legend | null {
  if (path === "-" || path === "" || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Legend;
}

/** The company's types as the legend would create them: one per code, thickness unknown. */
function typesFrom(legend: Legend | null): MatchableWallType[] {
  return (legend?.types ?? []).map((t) => ({
    id: t.code,
    code: t.code,
    name: t.name ?? t.code,
    hasParts: true,
    thicknessIn: t.thicknessIn ?? null,
    unoNote: legend?.uno?.find((u) => u.code === t.code)?.note ?? null,
  }));
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe.skipIf(DIR === "" || SHEETS.length === 0)("wall types on the training floor plans", () => {
  for (const spec of SHEETS) {
    const [set, pageText, fpuText, legendPath] = spec.split(":");
    const page = Number(pageText);
    const fpu = Number(fpuText);
    it(`${set} p${page}`, { timeout: 900_000 }, async () => {
      const read = await sheetStrokes(Buffer.from(readFileSync(join(DIR, set!))), page);
      expect(read).not.toBeNull();
      if (!read) return;
      const W = read.widthPt;
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, set!))));
      const text = await doc.pageText(page);
      const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const legend = legendAt(legendPath ?? "-");
      const wallTypes = typesFrom(legend);
      const legendCodes = wallTypes.map((t) => t.code);
      const vocabulary = tagVocabulary(legendCodes, legendCodes);
      const planText = vocabulary.length === 0 ? undefined : { legendCodes: vocabulary };
      // THE PRODUCT'S PATH, not the finder on the whole sheet: `detectForSheet`
      // splits the sheet into drawings and keeps the plan views, so the title
      // block's and the legend boxes' borders are not offered as walls. The
      // first by-eye sample on Joplin had two "A" walls that were the GENERAL
      // PLAN NOTES box, from a whole-sheet call this eval no longer makes.
      const found = detectForSheet({
        segments: read.segments,
        textItems: items,
        pageSize: { widthPt: W, heightPt: read.heightPt },
        feetPerUnit: fpu,
        wallTypes,
        sampledSheets: null,
        ...(planText === undefined ? {} : { planText }),
      }).found;
      const groups: WallGroup[] = found.groups;
      const total = groups.reduce((s, g) => s + g.feet, 0);
      const by = { tagged: 0, carried: 0, note: 0, untyped: 0 };
      const perType = new Map<string, { tagged: number; carried: number }>();
      for (const g of groups) {
        if (g.source.kind === "TAG") {
          const code = plainTag(g.source.tag);
          const slot = perType.get(code) ?? { tagged: 0, carried: 0 };
          if (isPropagatedTag(g.source.tag)) { by.carried += g.feet; slot.carried += g.feet; } else { by.tagged += g.feet; slot.tagged += g.feet; }
          perType.set(code, slot);
        } else if (g.source.kind === "GENERAL_NOTE") by.note += g.feet;
        else by.untyped += g.feet;
      }
      const report = planText === undefined ? null : planTextTagByRun({ segments: read.segments, text: items, widthPt: W, walls: found.walls, feetPerUnit: fpu, legendCodes: vocabulary, textTags: wallTypeTags(items, W), wallTypes }).report;
      const pct = (n: number) => (total > 0 ? `${((100 * n) / total).toFixed(0)}%` : "-");
      console.log(`\nWT ${set} p${page}: ${found.walls.length} runs, ${Math.round(total)} ft; legend ${legend === null ? "none" : legendCodes.join("/")}`);
      console.log(`   typed ${pct(by.tagged + by.carried + by.note)} — tagged ${Math.round(by.tagged)} ft (${pct(by.tagged)}), carried ${Math.round(by.carried)} ft (${pct(by.carried)}), note ${Math.round(by.note)} ft (${pct(by.note)}), untyped ${Math.round(by.untyped)} ft (${pct(by.untyped)})`);
      console.log(`   per type: ${[...perType].sort((a, b) => b[1].tagged + b[1].carried - a[1].tagged - a[1].carried).map(([c, f]) => `${c} ${Math.round(f.tagged + f.carried)} ft (${Math.round(f.tagged)} tagged)`).join(" · ") || "none"}`);
      if (process.env.WT_DEBUG === "1") {
        const direct = planText === undefined ? null : planTextTagByRun({ segments: read.segments, text: items, widthPt: W, walls: found.walls, feetPerUnit: fpu, legendCodes: vocabulary, textTags: wallTypeTags(items, W), wallTypes }).byRun;
        const names = new Map<string, number>();
        for (const tag of direct?.values() ?? []) names.set(tag, (names.get(tag) ?? 0) + 1);
        console.log(`   tag names: ${[...names].map(([n, c]) => `${n}×${c}`).join(" ") || "none"}; text tags on the sheet: ${[...new Set(wallTypeTags(items, W).map((t) => t.name))].slice(0, 30).join(" ") || "none"}`);
        const show = process.env.WT_SHOW ?? "";
        if (show && direct) console.log(`   ${show} runs: ${[...direct].filter(([, t]) => plainTag(t) === show).map(([r, t]) => `(${((r.x1 + r.x2) / 2).toFixed(3)},${((r.y1 + r.y2) / 2).toFixed(3)}) ${r.lengthFeet.toFixed(0)}' ${t}`).join(" · ")}`);
      }
      if (report) console.log(`   tags: ${report.symbols} symbols, ${report.coded} coded, ${report.bareText} bare, ${report.direct} runs tagged, ${report.propagated} carried, ${report.conflicts} conflicts, shape ${report.shape}, shortForm ${report.shortForm}`);
      // ── TEN RANDOM RUNS, FOR THE CROPS ──
      const typeOf = new Map<WallGroup["runs"][number], string>();
      for (const g of groups) for (const r of g.runs) typeOf.set(r, g.source.kind === "TAG" ? g.source.tag : g.source.kind === "GENERAL_NOTE" ? `${g.candidates[0]?.code ?? "?"} (note)` : "untyped");
      const next = rng(SEED + page);
      const runs = [...found.walls];
      const sample: typeof runs = [];
      while (sample.length < Math.min(10, runs.length)) sample.push(runs.splice(Math.floor(next() * runs.length), 1)[0]!);
      console.log(`   sample: ${sample.map((r, i) => `#${i} (${((r.x1 + r.x2) / 2).toFixed(3)},${((r.y1 + r.y2) / 2).toFixed(3)}) ${r.lengthFeet.toFixed(0)}' ${(r.thicknessFeet * 12).toFixed(1)}" → ${typeOf.get(r) ?? "?"}`).join(" · ")}`);
      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `${set}__p${page}.sample.json`), JSON.stringify(sample.map((r, i) => ({ name: `s${i}_${(typeOf.get(r) ?? "?").replace(/[^A-Za-z0-9]/g, "")}`, x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }))));
        writeFileSync(join(OUT, `${set}__p${page}.types.json`), JSON.stringify({ total, by, perType: [...perType], groups: groups.map((g) => ({ source: g.source, feet: g.feet, inches: g.inches, runs: g.runs.length })) }, null, 1));
      }
      expect(found.walls.length).toBeGreaterThan(0);
    });
  }
});
