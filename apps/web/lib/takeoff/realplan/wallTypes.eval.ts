import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { detectForSheet } from "../offeredCandidates";
import { groupsForStage } from "../stageGroups";
import { planTextTagByRun, isPropagatedTag, plainTag, tagVocabulary } from "../planTextTags";
import { wallTypeTags } from "../wallTags";
import type { MatchableWallType } from "../wallTypeMatch";
import { settledType, verdictFor, type WallGroup } from "../wallGroups";
import { storedLegendTypes, storedLegendTypesFromJson, type StoredLegendType } from "../legendProposal";
import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import type { WallLegendSightRead } from "@prova/integrations/src/wallLegendSight";
import { isHeldOut } from "../heldOutSets";

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
 *     REAL_PLAN_DIR=… WT_SHEETS="set.pdf:page:fpu:legend.json;…" (or WT_SHEETS_FILE=path) [WT_OUT=dir] [WT_SEED=n]
 *     npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/wallTypes.eval.ts
 *
 * `legend.json` is the legend read as the ingest stores it (`{types:[{code}]}`),
 * standing in for the WALL_LEGEND proposal; "-" means no legend, so the
 * vocabulary is empty and only a general note can type a wall. A cached model
 * read (`…-wall-legend.N.json`) with a sight read beside it
 * (`…-wall-legend-sight.N.json`, newest taken) is merged the way the proposal
 * is (`storedLegendTypes`), each type's thickness by the add-from-legend rule
 * (stud + 2 × layers × board, `addWallTypeFromLegend`).
 *
 * ── TYPED THE WAY THE WALLS STAGE POSTS IT (`wallItems.ts` `typeOf`) ──
 *
 * tag / carried: a tag group whose type the library has (`settledType`);
 * note: the legend's or sheet's U.N.O. where it is the one type that thick;
 * schedule-thickness: an untagged group with exactly one library type at its
 * thickness (`ONLY_ONE_THAT_THICK`); everything else untyped — including a tag
 * read off the sheet that names no type in the library (`tagNoType`).
 * With WT_OUT, `<set>__p<page>.runs.json` carries every run: endpoints in
 * page-width units, length, thickness, the type it was posted as (or null),
 * and the source.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
// WT_SHEETS_FILE: the same list in a file, for a run over every labelled sheet.
const SHEETS = (process.env.WT_SHEETS_FILE ? readFileSync(process.env.WT_SHEETS_FILE, "utf8") : process.env.WT_SHEETS ?? "").split(";").map((s) => s.trim()).filter(Boolean);
const OUT = process.env.WT_OUT ?? "";
const SEED = Number(process.env.WT_SEED ?? "7");

type Legend = { types: { code: string; name?: string; lines?: string[]; thicknessIn?: number }[]; uno?: { code: string; note: string }[] };

const thicknessOf = (t: StoredLegendType) => {
  const r = t.assembly.read;
  return r.studWidthIn === null ? {} : { thicknessIn: r.studWidthIn + 2 * (r.layersPerSide ?? 1) * (r.boardThicknessIn ?? 0) };
};

function legendAt(path: string): Legend | null {
  if (path === "-" || path === "" || !existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Legend & { proposals?: { pageNumber: number; merged: unknown; textRead: unknown }[] };
  // A `zzLegendReadAll` output (`legend-reads/<set>.json`): the proposals the
  // stage stored, one per page of ONE read. Merged as the stored legend is
  // (`planTextRead.ts` `legendFromProposal`, #970): every page, lowest first,
  // first page to name a code wins; an empty page is skipped; no types is no legend.
  if (Array.isArray(raw.proposals)) {
    const byCode = new Map<string, StoredLegendType>();
    const uno: { code: string; note: string }[] = [];
    for (const page of [...raw.proposals].sort((a, b) => a.pageNumber - b.pageNumber)) {
      const read = storedLegendTypesFromJson(page.merged);
      if (read.length === 0) continue;
      for (const t of read) if (!byCode.has(t.code.toUpperCase())) byCode.set(t.code.toUpperCase(), t);
      const list = (page.textRead as { uno?: unknown } | null)?.uno;
      if (Array.isArray(list)) uno.push(...list.filter((u): u is { code: string; note: string } => typeof u?.code === "string" && typeof u?.note === "string"));
    }
    if (byCode.size === 0) return null;
    return { types: [...byCode.values()].map((t) => ({ code: t.code, name: t.name ?? t.code, ...thicknessOf(t) })), ...(uno.length > 0 ? { uno } : {}) };
  }
  const text = raw as Legend;
  const prefix = basename(path).match(/^(.*)-wall-legend\.\d+\.json$/)?.[1];
  if (prefix === undefined) return text;
  const sights = readdirSync(dirname(path)).filter((f) => f.startsWith(`${prefix}-wall-legend-sight.`)).sort((a, b) => Number(a.match(/\.(\d+)\.json$/)?.[1]) - Number(b.match(/\.(\d+)\.json$/)?.[1]));
  const sight = sights.length === 0 ? null : (JSON.parse(readFileSync(join(dirname(path), sights[sights.length - 1]!), "utf8")) as WallLegendSightRead);
  const merged = storedLegendTypes(text as unknown as WallLegendRead, sight, path);
  return {
    types: merged.map((t) => ({ code: t.code, name: t.name ?? t.code, ...thicknessOf(t) })),
    ...(text.uno === undefined ? {} : { uno: text.uno }),
  };
}

type Source = "tag" | "carried" | "note" | "schedule-thickness";

/** The type a group is posted as, and how — `wallItems.ts` `typeOf`, word for word. */
function postedAs(group: WallGroup): { code: string; source: Source } | null {
  const verdict = verdictFor(group);
  const settled = settledType(verdict);
  if (settled !== null) {
    if (group.source.kind === "TAG") return { code: settled.code, source: isPropagatedTag(group.source.tag) ? "carried" : "tag" };
    return { code: settled.code, source: "schedule-thickness" };
  }
  if (verdict.state === "ASK" && group.source.kind === "GENERAL_NOTE" && verdict.suggested && group.candidates.length === 1) return { code: verdict.suggested.code, source: "note" };
  return null;
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
      // …and, as the WALLS stage does, the finder is given the types WITHOUT
      // their thicknesses and the groups are rebuilt beside it with them.
      const found = detectForSheet({
        segments: read.segments,
        textItems: items,
        pageSize: { widthPt: W, heightPt: read.heightPt },
        feetPerUnit: fpu,
        wallTypes: wallTypes.map((t) => ({ ...t, thicknessIn: null })),
        sampledSheets: null,
        ...(planText === undefined ? {} : { planText }),
      }).found;
      const staged = groupsForStage({ found, segmentsPt: read.segments, textItems: items, widthPt: W, feetPerUnit: fpu, wallTypes, legendCodes: planText?.legendCodes ?? null });
      const groups: WallGroup[] = staged.groups;
      const total = groups.reduce((s, g) => s + g.feet, 0);
      const by: Record<Source | "untyped" | "tagNoType", number> = { tag: 0, carried: 0, note: 0, "schedule-thickness": 0, untyped: 0, tagNoType: 0 };
      const perType = new Map<string, number>();
      const posted = new Map<WallGroup["runs"][number], { code: string; source: Source } | null>();
      for (const g of groups) {
        const as = postedAs(g);
        for (const r of g.runs) posted.set(r, as);
        if (as === null) {
          by.untyped += g.feet;
          if (g.source.kind === "TAG") by.tagNoType += g.feet;
        } else {
          by[as.source] += g.feet;
          perType.set(as.code, (perType.get(as.code) ?? 0) + g.feet);
        }
      }
      const typed = by.tag + by.carried + by.note + by["schedule-thickness"];
      const heldOut = isHeldOut(set);
      const report = planText === undefined ? null : planTextTagByRun({ segments: read.segments, text: items, widthPt: W, walls: found.walls, feetPerUnit: fpu, legendCodes: vocabulary, textTags: wallTypeTags(items, W), wallTypes }).report;
      const pct = (n: number) => (total > 0 ? `${((100 * n) / total).toFixed(0)}%` : "-");
      console.log(`\nWT ${set} p${page}${heldOut ? " [HELD-OUT, measured only]" : ""}: ${found.walls.length} runs, ${Math.round(total)} ft, ${staged.hatched.size} hatched; legend ${legend === null ? "none" : wallTypes.map((t) => (t.thicknessIn === null ? t.code : `${t.code}@${t.thicknessIn}`)).join("/")}`);
      console.log(`   typed ${Math.round(typed)} ft (${pct(typed)}) — tag ${Math.round(by.tag)} ft (${pct(by.tag)}), carried ${Math.round(by.carried)} ft (${pct(by.carried)}), note ${Math.round(by.note)} ft (${pct(by.note)}), schedule-thickness ${Math.round(by["schedule-thickness"])} ft (${pct(by["schedule-thickness"])}), untyped ${Math.round(by.untyped)} ft (${pct(by.untyped)}; ${Math.round(by.tagNoType)} ft of it tagged with no such type)`);
      console.log(`   per type: ${[...perType].sort((a, b) => b[1] - a[1]).map(([c, f]) => `${c} ${Math.round(f)} ft`).join(" · ") || "none"}`);
      console.log(`WTJSON ${JSON.stringify({ set, page, heldOut, legend: legend === null ? null : legendCodes, runs: found.walls.length, totalFt: total, typedFt: typed, ...by })}`);
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
      for (const [r, as] of posted) typeOf.set(r, `${as === null ? "untyped" : `${as.code} (${as.source})`}${staged.hatched.has(r) ? " [hatched]" : ""}`);
      const next = rng(SEED + page);
      const runs = [...found.walls];
      const sample: typeof runs = [];
      while (sample.length < Math.min(10, runs.length)) sample.push(runs.splice(Math.floor(next() * runs.length), 1)[0]!);
      console.log(`   sample: ${sample.map((r, i) => `#${i} (${((r.x1 + r.x2) / 2).toFixed(3)},${((r.y1 + r.y2) / 2).toFixed(3)}) ${r.lengthFeet.toFixed(0)}' ${(r.thicknessFeet * 12).toFixed(1)}" → ${typeOf.get(r) ?? "?"}`).join(" · ")}`);
      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `${basename(set!)}__p${page}.sample.json`), JSON.stringify(sample.map((r, i) => ({ name: `s${i}_${(typeOf.get(r) ?? "?").replace(/[^A-Za-z0-9]/g, "")}`, x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }))));
        writeFileSync(join(OUT, `${basename(set!)}__p${page}.types.json`), JSON.stringify({ total, by, perType: [...perType], groups: groups.map((g) => ({ source: g.source, feet: g.feet, inches: g.inches, runs: g.runs.length })) }, null, 1));
        writeFileSync(
          join(OUT, `${basename(set!)}__p${page}.runs.json`),
          JSON.stringify({
            set, page, feetPerUnit: fpu, heldOut, legend: legend === null ? null : legendCodes, units: "page-width",
            totalFt: total, typedFt: typed, by,
            runs: [...posted].map(([r, as]) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFt: r.lengthFeet, thicknessIn: r.thicknessFeet * 12, type: as?.code ?? null, source: as?.source ?? null, hatched: staged.hatched.has(r) })),
          }),
        );
      }
      expect(found.walls.length).toBeGreaterThan(0);
    });
  }
});
