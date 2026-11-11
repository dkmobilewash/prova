import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { readLegendFromText } from "../legendText";
import { readPartitionAssembly, type PartitionAssembly } from "../partitionAssembly";
import { tagSymbols } from "../tagSymbols";
import { isHeldOut } from "../heldOutSets";
import { legendPages } from "../legendPages";
import { pageLines } from "../planTextRead";

/**
 * ── THE KEYLESS LEGEND READ AGAINST EVERY CACHED MODEL READ ──
 *
 * For each set with a cached model read of its wall legend (`LEGEND_CACHE`, the newest text read
 * per page, never a sight read), the text-layer read (`readLegendFromText`) runs on the same page
 * and is compared: which codes both found, and for each shared code whether the assembly fields
 * (`readPartitionAssembly`: stud width, spacing and gauge, board thickness, layers, type X,
 * insulation, rating) and the height words agree. Training and held-out are reported apart;
 * HELD_OUT=1 adds the held-out sets (measured once).
 *
 *     LEGEND_CACHE=<dir> REAL_PLAN_DIR=<dir>[:<dir>] OUT=<file> [HELD_OUT=1] [ONLY=<substring>] \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/legendText.eval.ts
 *
 * Calls no model. Prints codes and counts, never a legend's words, to stdout; OUT (outside the
 * tree) carries the per-page detail.
 */
const CACHE = process.env.LEGEND_CACHE ?? "";
const DIRS = (process.env.REAL_PLAN_DIR ?? "").split(":").filter((d) => d !== "");
const HELD = process.env.HELD_OUT === "1";
const ONLY = process.env.ONLY ?? "";
const norm = (s: string) => s.toLowerCase().replace(/\.pdf$/, "").replace(/pdf$/, "").replace(/[^a-z0-9]/g, "");
const codeKey = (c: string) => c.toUpperCase().replace(/[\s.-]/g, "").replace(/^(?:WALL|PARTITION)?TYPE/, "");
const HEIGHT = /\bTO\s+(?:THE\s+)?(?:UNDERSIDE\s+OF\s+)?(?:STRUCT|DECK|ROOF)|\bABOVE\s+(?:FINISH(?:ED)?\s+)?(?:CEILING|CLG)|\bFULL\s+HEIGHT\b|\bTO\s+CEILING\b/i;
const FIELDS = ["studWidthIn", "studSpacingIn", "studGauge", "boardThicknessIn", "layersPerSide", "boardIsTypeX", "insulation", "hourlyRating"] as const;

function pdfs(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) pdfs(full, out);
    else if (name.toLowerCase().endsWith(".pdf") && !out.has(norm(name))) out.set(norm(name), full);
  }
  return out;
}

type Read = { types: { code: string; lines: string[] }[] };

describe.skipIf(CACHE === "" || DIRS.length === 0)("keyless legend read", () => {
  it("against the cached model reads", { timeout: 3_600_000 }, async () => {
    const files = new Map<string, string>();
    for (const d of DIRS) pdfs(d, files);
    // Newest text read per set page.
    const newest = new Map<string, { file: string; v: number }>();
    for (const f of readdirSync(CACHE)) {
      const m = f.match(/^(.*)-p(\d+)-wall-legend\.(\d+)\.json$/);
      if (!m) continue;
      const key = `${m[1]}|${m[2]}`;
      if ((newest.get(key)?.v ?? -1) < Number(m[3])) newest.set(key, { file: f, v: Number(m[3]) });
    }
    const out: string[] = [];
    const tally = {
      train: { sets: 0, ai: 0, text: 0, both: 0, fields: 0, fieldsAgree: 0, heights: 0, heightsAgree: 0, missingPdf: 0 },
      held: { sets: 0, ai: 0, text: 0, both: 0, fields: 0, fieldsAgree: 0, heights: 0, heightsAgree: 0, missingPdf: 0 },
    };
    // Per SET: the codes across every cached page, each with its richest lines — what the set's
    // typing uses — against the text read of the same pages.
    const bySet = new Map<string, number[]>();
    for (const key of newest.keys()) {
      const [stem, page] = key.split("|") as [string, string];
      bySet.set(stem, [...(bySet.get(stem) ?? []), Number(page)]);
    }
    const open = new Map<string, Awaited<ReturnType<typeof openPlanPdf>>>();
    const richest = (into: Map<string, string[]>, types: readonly { code: string; lines: string[] }[]) => {
      for (const x of types) {
        const k = codeKey(x.code);
        if ((into.get(k)?.length ?? -1) < x.lines.length) into.set(k, x.lines);
      }
    };
    for (const [stem, pages] of [...bySet.entries()].sort()) {
      const held = isHeldOut(stem.replace(/_pdf$/, ".pdf"));
      if (held && !HELD) continue;
      if (ONLY !== "" && !stem.includes(ONLY)) continue;
      const t = held ? tally.held : tally.train;
      const aiCodes = new Map<string, string[]>();
      for (const page of pages) {
        const ai = JSON.parse(readFileSync(path.join(CACHE, newest.get(`${stem}|${page}`)!.file), "utf8")) as Read;
        if (Array.isArray(ai.types)) richest(aiCodes, ai.types);
      }
      if (aiCodes.size === 0) continue;
      const pdfPath = files.get(norm(stem));
      if (pdfPath === undefined) {
        t.missingPdf += 1;
        out.push(`MISSING ${stem}`);
        continue;
      }
      if (!open.has(pdfPath)) open.set(pdfPath, await openPlanPdf(Buffer.from(readFileSync(pdfPath))));
      const doc = open.get(pdfPath)!;
      const myCodes = new Map<string, string[]>();
      for (const page of pages) {
        if (page > doc.pageCount) continue;
        // The app reads a page only where its own words say it legends the walls (`wallLegendWork`).
        const rank = legendPages([{ page, title: null, lines: await pageLines(doc, page) }])[0]?.rank;
        if (rank === undefined || rank > 2) continue;
        const text = await doc.pageText(page);
        const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const strokes = await doc.pageStrokes(page);
        const symbols = tagSymbols({ segments: strokes.segments, text: items, unitsPerPaperInch: 72 });
        richest(myCodes, readLegendFromText({ items, widthPt: text.widthPt, heightPt: text.heightPt, symbols }).types);
      }
      t.sets += 1;
      const both = [...aiCodes.keys()].filter((c) => myCodes.has(c));
      t.ai += aiCodes.size;
      t.text += myCodes.size;
      t.both += both.length;
      const fieldMiss: string[] = [];
      for (const c of both) {
        const a = readPartitionAssembly({ lines: aiCodes.get(c)!, where: "ai" }).read as PartitionAssembly["read"];
        const b = readPartitionAssembly({ lines: myCodes.get(c)!, where: "text" }).read as PartitionAssembly["read"];
        for (const f of FIELDS) {
          if (a[f] === null || a[f] === false) continue;
          t.fields += 1;
          if (a[f] === b[f]) t.fieldsAgree += 1;
          else fieldMiss.push(`${c}.${f}`);
        }
        if (aiCodes.get(c)!.some((l) => HEIGHT.test(l))) {
          t.heights += 1;
          if (myCodes.get(c)!.some((l) => HEIGHT.test(l))) t.heightsAgree += 1;
          else fieldMiss.push(`${c}.height`);
        }
      }
      out.push(
        `${held ? "HELD" : "TRAIN"} ${stem} (${pages.length} pages): ai ${aiCodes.size} · text ${myCodes.size} · both ${both.length}` +
          ` · missed [${[...aiCodes.keys()].filter((c) => !myCodes.has(c)).join(" ")}] · extra [${[...myCodes.keys()].filter((c) => !aiCodes.has(c)).join(" ")}]` +
          (fieldMiss.length > 0 ? ` · fields off [${fieldMiss.join(" ")}]` : ""),
      );
    }
    for (const doc of open.values()) await doc.close();
    const pct = (a: number, b: number) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(1)}%`);
    for (const [name, t] of Object.entries(tally)) {
      if (t.sets === 0) continue;
      const line = `${name.toUpperCase()} sets ${t.sets} (+${t.missingPdf} without a PDF) · codes: model ${t.ai}, text ${t.text}, both ${t.both} → recall ${pct(t.both, t.ai)}, precision ${pct(t.both, t.text)} · fields agree ${pct(t.fieldsAgree, t.fields)} of ${t.fields} · height words ${pct(t.heightsAgree, t.heights)} of ${t.heights}`;
      out.unshift(line);
      console.error(line);
    }
    if (process.env.OUT) writeFileSync(process.env.OUT, out.join("\n") + "\n");
    const compared = out.filter((l) => /^(TRAIN|HELD) /.test(l));
    expect(compared.length, "no cached read was compared").toBeGreaterThan(0);
  });
});
