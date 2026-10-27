import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { dimensionLabels, metricDimensionLabels } from "../../plan-ingest/dimensionLabels";
import { readSheetScale } from "../scaleFromDimensions";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { printedScalesOnPage } from "../printedScales";
import { feetPerUnitFrom, sheetScale } from "../sheetScale";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import { heldOutReason } from "../heldOutSets";
import { storedLegendTypes } from "../legendProposal";
import { nameSheet } from "./nameSheet";
import { looksLikeFloorPlan } from "../sheetTree";
import { verdictFor, type WallGroup } from "../wallGroups";
import type { MatchableWallType } from "../wallTypeMatch";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── WHAT THE DRAWING'S OWN TAGS TYPE, WITH THE AI SWITCH OFF AND ON ──
 *
 *     REAL_PLAN_DIR="…/real-plans/new" LEGEND_CACHE="…/legend-cache" \
 *     TAG_EVAL_OUT="…/shots/tag-typing" \
 *       pnpm --filter @prova/web exec vitest run \
 *         --config vitest.eval.config.mts lib/takeoff/realplan/tagTyping.eval.ts
 *
 * Reading a wall tag printed in a symbol (a hexagon with S6A in it) is free
 * geometry; only the legend READ costs a model call. This eval measures what
 * the finder types on the training floor plans under four conditions:
 *
 *   off-before  — no vocabulary at all (what the switch OFF did until now)
 *   off-after   — the company's OWN library codes as the vocabulary
 *   on-before   — the cached legend's codes alone (the switch ON until now)
 *   on-after    — the legend's codes and the library's together
 *
 * The library stands in for an estimator who added the set's legend to it (the
 * walkthrough does exactly that) and had pressed "starters" first — so W1, W2,
 * W3 and the rest are in it too, which is the false-tag risk this exists to
 * measure: a drawing's WINDOW marks are often W1, W2.
 *
 * TRAINING SETS ONLY (`heldOutReason`), and only sets with a cached legend
 * read, so nothing is spent. Nothing from a drawing is written into the tree:
 * `TAG_EVAL_OUT` is outside it and what is printed is counts and footage.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const OUT = process.env.TAG_EVAL_OUT ?? join(process.env.TMPDIR ?? "/tmp", "tag-typing");
const PER_SET = Number(process.env.TAG_EVAL_PER_SET ?? "3");
const MIN_SEGMENTS = 400;
/** The starter library's codes, with no thickness, as `addStarterWallTypes` writes them. */
const PLAN_TEXT_HELD_OUT = ["lodi-memorial-library", "Missouri-New-Outdoor-Pavilion", "Nall-Wealth"];
const STARTERS = ["W1", "W2", "W3", "EW1", "FIN5", "ACT1", "ACT2", "GYPC1"];

type Condition = "off-before" | "off-after" | "on-before" | "on-after";
type Tally = {
  groups: number;
  feet: number;
  tagged: { groups: number; feet: number; tags: Record<string, number> };
  byVerdict: Record<string, { groups: number; feet: number }>;
  /** Tags that are a STARTER code and not a legend code — the window-mark risk. */
  starterTags: Record<string, number>;
};
type SheetRow = {
  set: string;
  page: number;
  number: string;
  scale: string;
  legendCodes: string[];
  runs: Partial<Record<Condition, Tally>>;
  error?: string;
};

function tally(groups: readonly WallGroup[], legendCodes: readonly string[]): Tally {
  const out: Tally = { groups: groups.length, feet: 0, tagged: { groups: 0, feet: 0, tags: {} }, byVerdict: {}, starterTags: {} };
  const legend = new Set(legendCodes.map((c) => c.toUpperCase()));
  for (const group of groups) {
    out.feet += group.feet;
    const verdict = verdictFor(group);
    const v = (out.byVerdict[verdict.state] ??= { groups: 0, feet: 0 });
    v.groups += 1;
    v.feet += group.feet;
    if (group.source.kind === "TAG") {
      const tag = group.source.tag.replace(/\s*≈$/, "");
      out.tagged.groups += 1;
      out.tagged.feet += group.feet;
      out.tagged.tags[tag] = (out.tagged.tags[tag] ?? 0) + group.feet;
      if (!legend.has(tag.toUpperCase()) && STARTERS.includes(tag.toUpperCase())) {
        out.starterTags[tag] = (out.starterTags[tag] ?? 0) + group.feet;
      }
    }
  }
  return out;
}

/** The set's legend types from the second session's cache, as library rows with the walkthrough's thickness rule. */
function libraryFor(key: string): { legendCodes: string[]; types: MatchableWallType[] } {
  const files = readdirSync(CACHE).filter((f) => f.startsWith(`${key}-p`) && /-wall-legend\.\d+\.json$/.test(f));
  const types: MatchableWallType[] = [];
  const codes: string[] = [];
  for (const file of files) {
    const page = file.match(/-p(\d+)-/)?.[1] ?? "?";
    const text = JSON.parse(readFileSync(join(CACHE, file), "utf8"));
    const sights = readdirSync(CACHE).filter((f) => f.startsWith(`${key}-p${page}-wall-legend-sight.`)).sort();
    const sight = sights.length === 0 ? null : JSON.parse(readFileSync(join(CACHE, sights[sights.length - 1]), "utf8"));
    for (const t of storedLegendTypes(text, sight, `p${page}`)) {
      if (codes.some((c) => c.toUpperCase() === t.code.toUpperCase())) continue;
      const r = t.assembly.read;
      const thickness = r.studWidthIn === null ? null : r.studWidthIn + 2 * (r.layersPerSide ?? 1) * (r.boardThicknessIn ?? 0);
      codes.push(t.code);
      types.push({ id: `legend-${t.code}`, code: t.code, name: t.name ?? t.code, hasParts: true, thicknessIn: thickness });
    }
  }
  for (const code of STARTERS) {
    if (types.some((t) => t.code === code)) continue;
    types.push({ id: `starter-${code}`, code, name: `starter ${code}`, hasParts: true, thicknessIn: null });
  }
  return { legendCodes: codes, types };
}

function union(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...a, ...b]) {
    if (seen.has(c.toUpperCase())) continue;
    seen.add(c.toUpperCase());
    out.push(c);
  }
  return out;
}

const SHEETS = (process.env.TAG_EVAL_SHEETS ?? "")
  .split(";")
  .map((p) => p.trim())
  .filter((p) => p.includes(":"))
  .map((p) => ({ key: p.split(":")[0].trim(), pages: p.split(":")[1].split(",").map((n) => Number(n.trim())).filter((n) => n > 0) }));

describe.skipIf(DIR === "" || CACHE === "")("what the drawing's tags type, switch off and on", () => {
  it("measures the training floor plans four ways", async () => {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
    expect(files.length).toBeGreaterThan(0);
    mkdirSync(OUT, { recursive: true });
    const rows: SheetRow[] = [];
    for (const file of files) {
      const label = basename(file, ".pdf");
      if (heldOutReason(label) !== null) continue;
      // The PLAN-TEXT held-out sets (BOARD.md rule 3) are not in the shared
      // wall list, so they are named here: never measured for tags, never tuned on.
      if (PLAN_TEXT_HELD_OUT.some((m) => label.includes(m))) continue;
      const key = label.replace(/\W+/g, "_") + "_pdf";
      const library = libraryFor(key);
      if (library.legendCodes.length === 0) continue;
      const named = SHEETS.find((s) => file.includes(s.key));
      const doc = await openPlanPdf(readFileSync(join(DIR, file)));
      try {
        let picked: { page: number; number: string; segments: number }[] = [];
        for (let page = 1; page <= doc.pageCount; page += 1) {
          if (named !== undefined && !named.pages.includes(page)) continue;
          let text;
          try {
            text = await doc.pageText(page);
          } catch {
            continue;
          }
          const { number, title } = nameSheet(
            text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, height: i.height })),
            { widthPt: text.widthPt, heightPt: text.heightPt },
          );
          const discipline = /^([A-Za-z]+)/.exec(number)?.[1]?.toUpperCase() ?? "";
          if (named === undefined && !looksLikeFloorPlan(number, title, discipline)) continue;
          picked.push({ page, number: number || `page ${page}`, segments: 0 });
        }
        for (const p of picked) {
          try {
            p.segments = (await doc.pageStrokes(p.page)).segments.length;
          } catch {
            p.segments = 0;
          }
        }
        if (named === undefined) picked = picked.filter((p) => p.segments >= MIN_SEGMENTS).sort((a, b) => b.segments - a.segments).slice(0, PER_SET);
        for (const sheet of picked.sort((a, b) => a.page - b.page)) {
          const row: SheetRow = { set: label, page: sheet.page, number: sheet.number, scale: "", legendCodes: library.legendCodes, runs: {} };
          rows.push(row);
          try {
            const text = await doc.pageText(sheet.page);
            const strokes = await doc.pageStrokes(sheet.page);
            const segments = strokes.segments as StrokeSegment[];
            const pageSize = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
            const textItems: SheetTextItem[] = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
            const verdict = readSheetScale(text, segments, dimensionLabels(text), {}, metricDimensionLabels(text));
            const printed = scaleFromPrinted(printedScalesOnPage(text.items), text.widthPt, text.heightPt);
            const decided = sheetScale({
              textItems,
              segments,
              pageSize,
              fromDimensions: verdict.ok ? { ok: true, scaleName: verdict.scaleName, feetPerInch: verdict.feetPerInch } : { ok: false, reason: verdict.reason },
              fromPrinted: printed === null ? null : { scaleName: printed.scaleName, feetPerInch: printed.declaredDistanceFeet / (text.widthPt / 72) },
            });
            if (decided.kind !== "DIMENSIONS" && decided.kind !== "PRINTED") {
              row.error = "no sheet-wide scale";
              continue;
            }
            row.scale = `${decided.scaleName} (${decided.kind.toLowerCase()})`;
            const feetPerUnit = feetPerUnitFrom(decided.feetPerInch, text.widthPt);
            const libraryCodes = library.types.map((t) => t.code);
            const conditions: [Condition, string[] | undefined][] = [
              ["off-before", undefined],
              ["off-after", libraryCodes],
              ["on-before", library.legendCodes],
              ["on-after", union(library.legendCodes, libraryCodes)],
            ];
            for (const [condition, codes] of conditions) {
              const found = findWallsOnSheet({
                segments,
                textItems,
                pageSize,
                feetPerUnit,
                wallTypes: library.types,
                sampledSheets: null,
                ...(codes === undefined ? {} : { planText: { legendCodes: codes } }),
              });
              row.runs[condition] = tally(found.groups, library.legendCodes);
            }
          } catch (err) {
            row.error = err instanceof Error ? err.message.slice(0, 140) : String(err).slice(0, 140);
          }
        }
      } finally {
        await doc.close();
      }
    }
    writeFileSync(join(OUT, "tag-typing.json"), JSON.stringify(rows, null, 2));
    const lines: string[] = [];
    const fmt = (t: Tally | undefined) =>
      t === undefined
        ? "—"
        : `${t.tagged.groups}/${t.groups} groups tagged, ${Math.round(t.tagged.feet)}/${Math.round(t.feet)} ft` +
          ` [${Object.entries(t.byVerdict).map(([k, v]) => `${k} ${v.groups}g ${Math.round(v.feet)}ft`).join(", ")}]` +
          (Object.keys(t.starterTags).length ? ` STARTER TAGS ${Object.entries(t.starterTags).map(([k, v]) => `${k} ${Math.round(v)}ft`).join(", ")}` : "");
    for (const row of rows) {
      lines.push(`${row.set} p${row.page} ${row.number} · ${row.scale}${row.error ? ` · ERROR ${row.error}` : ""} · legend ${row.legendCodes.join(",")}`);
      for (const c of ["off-before", "off-after", "on-before", "on-after"] as Condition[]) {
        const t = row.runs[c];
        lines.push(`    ${c.padEnd(10)} ${fmt(t)}`);
        if (t && Object.keys(t.tagged.tags).length) lines.push(`               tags: ${Object.entries(t.tagged.tags).map(([k, v]) => `${k} ${Math.round(v)}ft`).join(", ")}`);
      }
    }
    writeFileSync(join(OUT, "tag-typing.txt"), lines.join("\n") + "\n");
    // eslint-disable-next-line no-console -- this eval's output IS its report.
    console.log(lines.join("\n"));
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
