import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import { extractWallLegendBySight, WALL_LEGEND_SIGHT_PROMPT_VERSION, type WallLegendSightRead } from "@prova/integrations/src/wallLegendSight";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { assemblyFromSight, fullyRead, legendCropRects } from "../legendSight";
import { readPartitionAssembly } from "../partitionAssembly";
import { pageLines } from "../planTextRead";

/**
 * ── THE LEGEND READ BY SIGHT, BESIDE THE LEGEND READ FROM ITS TEXT ──
 *
 * CALLS A MODEL, once per set, cached by file, page and prompt version in
 * `LEGEND_CACHE` as the text read is. Renders the legend page and one crop
 * per type through `LEGEND_RENDER` (a Swift/PDFKit script outside the
 * repository — Node here has no rasteriser; see `planPdf.ts`), sends them
 * with the page's text, and reports per type what the text read got, what
 * the sight read got, and whether each is FULLY read (stud and board known).
 * Writes a contact sheet to `LEGEND_SIGHT_OUT` with every crop beside both
 * readings, so a person can check the model against the drawing.
 *
 *     REAL_PLAN_DIR=… LEGEND_CACHE=… LEGEND_SET=… LEGEND_PAGE=… \
 *       LEGEND_RENDER=…/legendCrops.swift LEGEND_SIGHT_OUT=… \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzLegendSight.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const SET = process.env.LEGEND_SET ?? "";
const PAGE = Number(process.env.LEGEND_PAGE ?? "0");
const RENDER = process.env.LEGEND_RENDER ?? "";
const OUT = process.env.LEGEND_SIGHT_OUT ?? "";
const LIVE = process.env.LEGEND_LIVE !== "0";

describe.skipIf(DIR === "" || CACHE === "" || SET === "" || PAGE === 0 || RENDER === "" || OUT === "")("the legend read by sight", () => {
  it("reads every type the text read found, and reports the ones only the drawing could give", { timeout: 1_800_000 }, async () => {
    const safe = SET.replace(/\W+/g, "_");
    const textAt = join(CACHE, `${safe}-p${PAGE}-wall-legend.1.json`);
    expect(existsSync(textAt), `no text read cached at ${textAt}`).toBe(true);
    const textRead = JSON.parse(readFileSync(textAt, "utf8")) as WallLegendRead;
    const codes = textRead.types.map((t) => t.code);

    const pdfPath = join(DIR, SET);
    const doc = await openPlanPdf(Buffer.from(readFileSync(pdfPath)));
    const text = await doc.pageText(PAGE);
    const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
    const rects = legendCropRects({ text: items, codes, widthPt: text.widthPt, heightPt: text.heightPt });
    const lines = await pageLines(doc, PAGE);
    await doc.close().catch(() => {});

    const outDir = join(OUT, `${safe}-p${PAGE}`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "rects.json"), JSON.stringify({ page: PAGE, widthPt: text.widthPt, heightPt: text.heightPt, rects }));
    const manifest = JSON.parse(execFileSync("swift", [RENDER, pdfPath, join(outDir, "rects.json"), outDir], { encoding: "utf8" }).trim()) as {
      page: { file: string; px: number; py: number };
      crops: { code: string; file: string; px: number; py: number }[];
    };
    console.log(`${SET} p${PAGE}: ${codes.length} types in the text read, ${rects.length} crops rendered (${manifest.crops.map((c) => `${c.code} ${c.px}×${c.py}`).join(", ")}), page ${manifest.page.px}×${manifest.page.py}`);

    const cacheAt = join(CACHE, `${safe}-p${PAGE}-${WALL_LEGEND_SIGHT_PROMPT_VERSION}.json`);
    let read: WallLegendSightRead;
    let cost = "cached";
    if (existsSync(cacheAt)) {
      read = JSON.parse(readFileSync(cacheAt, "utf8")) as WallLegendSightRead;
    } else {
      expect(LIVE, "LEGEND_LIVE=0 and nothing cached").toBe(true);
      let spent = { input: 0, output: 0 };
      read = await extractWallLegendBySight({
        page: { imageBase64: readFileSync(manifest.page.file).toString("base64"), mediaType: "image/png" },
        crops: manifest.crops.map((c) => ({ code: c.code, imageBase64: readFileSync(c.file).toString("base64"), mediaType: "image/png" })),
        lines,
        pageNumber: PAGE,
        onUsage: (usage) => {
          spent = { input: usage.inputTokens, output: usage.outputTokens };
        },
      });
      writeFileSync(cacheAt, JSON.stringify(read, null, 1), "utf8");
      // Opus 5: $5 per Mtok in, $25 out.
      cost = `${spent.input} in, ${spent.output} out, about $${((spent.input / 1e6) * 5 + (spent.output / 1e6) * 25).toFixed(3)}`;
    }
    console.log(`  LIVE sight read: ${cost}; confidence ${read.confidence}; ${read.reason.slice(0, 300)}`);

    // ── PER TYPE, BOTH READS ──
    const rows: string[] = [];
    let beforeFull = 0;
    let afterFull = 0;
    const html: string[] = [];
    for (const t of textRead.types) {
      const before = readPartitionAssembly({ lines: t.lines, where: "text" });
      // `WALL TYPE 1` and `1` are one code; the vocabulary maps the short form.
      const sight = read.types.find((s) => sameCode(s.code, t.code));
      const after = sight === undefined ? null : assemblyFromSight(sight, "sight");
      const bf = fullyRead(before);
      const af = after !== null && fullyRead(after);
      beforeFull += bf ? 1 : 0;
      afterFull += af ? 1 : 0;
      const line = (a: typeof before | null) =>
        a === null ? "— not read —" : a.components.map((c) => c.description).join("; ") || "no assembly";
      // What sight added beyond the text, and where the two disagree, field by field.
      const fields: (keyof typeof before.read)[] = ["studWidthIn", "studGauge", "studSpacingIn", "boardThicknessIn", "layersPerSide", "insulation", "hourlyRating"];
      const added = after === null ? [] : fields.filter((f) => before.read[f] === null && after.read[f] !== null);
      const differs = after === null ? [] : fields.filter((f) => before.read[f] !== null && after.read[f] !== null && String(before.read[f]) !== String(after.read[f]));
      if (sight !== undefined && sight.heightNote !== null) added.push("heightNote" as keyof typeof before.read);
      rows.push(
        `  ${t.code.padEnd(12)} added: ${added.join(", ") || "nothing"}${differs.length ? `; DIFFERS: ${differs.map((f) => `${f} ${String(before.read[f])}→${String(after!.read[f])}`).join(", ")}` : ""}\n` +
          `  ${t.code.padEnd(12)} text ${bf ? "FULL" : "part"}: ${line(before)}\n` +
          `  ${"".padEnd(12)} sight ${af ? "FULL" : "part"}: ${line(after)}` +
          (after !== null && after.flags.length > 0 ? `  ⚠ ${after.flags.map((f) => f.why).join("; ")}` : "") +
          (sight !== undefined ? `  [from drawing: ${sight.fromDrawing.join(", ") || "nothing"}; ${sight.confidence}]` : ""),
      );
      const crop = manifest.crops.find((c) => c.code === t.code);
      html.push(
        `<tr><td><b>${t.code}</b>${crop ? `<br><img src="${crop.file}" style="max-width:360px;border:1px solid #ccc">` : ""}</td>` +
          `<td><b>text read</b> ${bf ? "FULL" : "partial"}<br>${line(before)}<br><small>${t.lines.map(esc).join("<br>")}</small></td>` +
          `<td><b>sight read</b> ${af ? "FULL" : "partial"}<br>${esc(line(after))}` +
          (after !== null && after.flags.length > 0 ? `<br><span style="color:#b00">${after.flags.map((f) => esc(f.why)).join("<br>")}</span>` : "") +
          (sight !== undefined
            ? `<br><small>stud ${sight.studWidthIn ?? "–"}in ${sight.studMaterial ?? ""} ${sight.studGauge ?? ""}ga @ ${sight.studSpacingIn ?? "–"}; board ${sight.boardThicknessIn ?? "–"}in × ${sight.layersSideA ?? "–"}/${sight.layersSideB ?? "–"}${sight.boardIsTypeX ? " type X" : ""}; insulation ${sight.insulation ?? "–"}; rating ${sight.hourlyRating ?? "–"}; height ${sight.heightNote ?? "–"}; from drawing: ${sight.fromDrawing.join(", ") || "nothing"}; ${sight.confidence}<br>${sight.notes.map(esc).join("<br>")}</small>`
            : "") +
          `</td></tr>`,
      );
    }
    console.log(rows.join("\n"));
    console.log(`  fully read: text ${beforeFull} of ${textRead.types.length} → sight ${afterFull} of ${textRead.types.length}`);
    writeFileSync(
      join(OUT, `${safe}-p${PAGE}.html`),
      `<!doctype html><meta charset="utf-8"><title>${esc(SET)} p${PAGE} legend by sight</title><body style="font-family:system-ui;padding:1rem">` +
        `<h2>${esc(SET)} — legend page ${PAGE}</h2><p>${esc(read.reason)}</p><p><img src="${manifest.page.file}" style="max-width:100%;border:1px solid #ccc"></p>` +
        `<table border="1" cellpadding="8" style="border-collapse:collapse;vertical-align:top">${html.join("")}</table>`,
    );
    expect(read.types.length).toBeGreaterThan(0);
  });
});

function sameCode(a: string, b: string): boolean {
  const short = (c: string) =>
    c.trim().toUpperCase().replace(/^(?:WALL|PARTITION|PART\.?)\s+TYPE\s+|^TYPE\s+/, "").replace(/\s+-.*$/, "").trim();
  return short(a) === short(b) || a.trim().toUpperCase() === b.trim().toUpperCase();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
