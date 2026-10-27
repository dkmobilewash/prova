import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type SheetScore } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { printedScalesOnPage } from "../printedScales";
import { grayToCanvas, ocrTiles, openPdf, renderGray } from "../raster/nodeStack";
import { readPgm, writePgm, type Gray } from "../raster/pgm";
import { degrade, SCAN_LIKE, skew } from "../raster/rasterDegrade";
import { estimateSkewDegrees, pageSizeOf, rasterLines } from "../raster/rasterLines";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { sheetStrokes } from "../sheetStrokes";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── SCANNED PLANS: what the finder can do with a BITMAP of a sheet ──
 *
 * The training sheets have answer keys and are vector. So: RASTERISE each of
 * them the way a scanner would see it — 150, 200 and 300 dpi, clean and
 * scan-like (skewed, speckled, blurred) — read lines off the bitmap
 * (`raster/rasterLines.ts`), read the printed scale with OCR, and hand both to
 * the SAME `detectForSheet` the vector path uses. Then score every arm
 * against the key with `scoreSheet`, beside the vector finder on the same
 * sheet, and time each step.
 *
 * Training sheets only — `heldOutReason` refuses the test buildings. Two
 * stacks for the render and the OCR: `SCAN_EVAL_STACK=mac` (default) is
 * Apple's PDFKit and Vision through `scanTool.swift`, the research arm;
 * `node` is pdf.js with its Node canvas and tesseract.js — nothing a Linux
 * server lacks — through `raster/nodeStack.ts`.
 *
 *   REAL_PLAN_DIR=… TAKEOFF_LABEL_DIR=… SCAN_EVAL_OUT=… [SCAN_EVAL_ONLY=Baker] [SCAN_EVAL_DPI=150,300] \
 *   node_modules/.bin/vitest run --config vitest.eval.config.mts lib/takeoff/realplan/scanned.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.SCAN_EVAL_OUT ?? "";
const ONLY = process.env.SCAN_EVAL_ONLY ?? "";
const DPIS = (process.env.SCAN_EVAL_DPI ?? "150,200,300").split(",").map(Number).filter((n) => n > 0);
const VARIANTS = (process.env.SCAN_EVAL_VARIANTS ?? "clean,scan").split(",") as ("clean" | "scan")[];
/** Ink threshold for the raster pass; see `rasterLines`. */
const THRESHOLD = process.env.SCAN_EVAL_THRESHOLD ? Number(process.env.SCAN_EVAL_THRESHOLD) : undefined;
/** "mac": PDFKit + Vision through scanTool.swift. "node": pdf.js + tesseract.js, what a Linux server runs. */
const STACK = (process.env.SCAN_EVAL_STACK ?? "mac") as "mac" | "node";
/** How fills become faces: "contour" (default) or "runs". */
const FILLS = (process.env.SCAN_EVAL_FILLS ?? "contour") as "runs" | "contour";

type Saved = {
  set: string;
  sheet: string;
  page: number;
  feetPerUnit: number;
  verdicts: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet?: number; verdict: string }[];
};
type OcrItem = { str: string; x: number; y: number; width: number; height: number; confidence: number };
type Arm = {
  arm: string;
  score: SheetScore;
  scale: "ocr" | "key" | "vector";
  ms: { render: number; lines: number; ocr: number; detect: number };
  lines: number;
  ocrItems: number;
};

const TOOL_SRC = join(__dirname, "scanTool.swift");

function tool(): string {
  const dir = join(tmpdir(), "prova-scanTool");
  const bin = join(dir, "scanTool");
  if (!existsSync(bin)) {
    mkdirSync(dir, { recursive: true });
    execFileSync("swiftc", ["-O", TOOL_SRC, "-o", bin], { stdio: "pipe" });
  }
  return bin;
}

function flat(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
}

function findPdf(setDir: string): string | null {
  for (const sub of ["", "new"]) {
    const where = join(DIR, sub);
    if (!existsSync(where)) continue;
    const hit = readdirSync(where).find((f) => f.toLowerCase().endsWith(".pdf") && flat(f) === flat(setDir));
    if (hit) return join(where, hit);
  }
  return null;
}

const ms = (t: number) => Date.now() - t;

describe.skipIf(DIR === "" || LABELS === "")("the finder on scanned sheets", () => {
  it("scores the raster path per dpi and variant against the keys, beside the vector path", { timeout: 7_200_000 }, async () => {
    const bin = STACK === "mac" ? tool() : "";
    const work = join(tmpdir(), "prova-scan-eval");
    const tessCache = join(tmpdir(), "prova-tessdata");
    mkdirSync(tessCache, { recursive: true });
    mkdirSync(work, { recursive: true });
    const labels: { dir: string; sheet: string; path: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (heldOutReason(dir) !== null) continue;
      if (ONLY && !flat(dir).includes(flat(ONLY))) continue;
      const full = join(LABELS, dir);
      let names: string[] = [];
      try {
        names = readdirSync(full).filter((n) => n.endsWith(".json"));
      } catch {
        continue;
      }
      for (const name of names) labels.push({ dir, sheet: name.slice(0, -5), path: join(full, name) });
    }
    const arms: Arm[] = [];
    const notes: string[] = [];
    const nodeDocs: Awaited<ReturnType<typeof openPdf>>[] = [];
    for (const file of labels) {
      const saved = JSON.parse(readFileSync(file.path, "utf8")) as Saved;
      const { key, fromTracedFeet } = keyFromLabels(saved);
      if (key.length === 0) continue;
      const pdf = findPdf(file.dir);
      if (pdf === null) {
        notes.push(`${file.dir}/${file.sheet}: no pdf under REAL_PLAN_DIR — skipped`);
        continue;
      }
      const tag = `${file.dir.slice(0, 20)}/${file.sheet}`;
      const score = (arm: string, proposed: SheetScore["proposedFeet"] extends number ? Parameters<typeof scoreSheet>[0]["proposed"] : never, feetPerUnit: number) =>
        scoreSheet({ set: file.dir, sheet: file.sheet, key, proposed, feetPerUnit, keyFromTracedFeet: fromTracedFeet });

      // ── THE VECTOR ARM, the number to beat ──
      {
        const bytes = Buffer.from(readFileSync(pdf));
        const t0 = Date.now();
        const read = await sheetStrokes(bytes, saved.page);
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        await doc.close();
        if (read === null) {
          notes.push(`${tag}: vector strokes unreadable`);
          continue;
        }
        const t1 = Date.now();
        const detected = detectForSheet({
          segments: read.segments,
          textItems: text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height })),
          pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
          feetPerUnit: saved.feetPerUnit,
        });
        const offered = offeredCandidates({
          walls: detected.found.walls,
          segments: detected.found.inUnits.map((s) => ({ ...s, x1: s.x1 * read.widthPt, y1: s.y1 * read.widthPt, x2: s.x2 * read.widthPt, y2: s.y2 * read.widthPt })),
          widthPt: read.widthPt,
          feetPerUnit: saved.feetPerUnit,
          planBoxes: detected.planBoxes,
        });
        arms.push({
          arm: "vector",
          scale: "vector",
          score: score("vector", offered.candidates.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: w.lengthFeet })), saved.feetPerUnit),
          ms: { render: 0, lines: t1 - t0, ocr: 0, detect: ms(t1) },
          lines: read.segments.length,
          ocrItems: text.items.length,
        });
      }

      // ── THE RASTER ARMS ──
      for (const dpi of DPIS) {
        const pgmPath = join(work, `${flat(file.dir)}-${file.sheet}-${dpi}${STACK === "node" ? "-node" : ""}.pgm`);
        const t0 = Date.now();
        let clean: Gray;
        let nodeDoc: Awaited<ReturnType<typeof openPdf>> | null = null;
        if (STACK === "mac") {
          execFileSync(bin, ["render", pdf, String(saved.page), String(dpi), pgmPath], { stdio: "pipe" });
          clean = readPgm(new Uint8Array(readFileSync(pgmPath)));
        } else {
          nodeDoc = await openPdf(new Uint8Array(readFileSync(pdf)));
          clean = (await renderGray(nodeDoc, saved.page, dpi)).gray;
          writeFileSync(pgmPath, writePgm(clean));
        }
        if (nodeDoc) nodeDocs.push(nodeDoc);
        const renderMs = ms(t0);
        for (const variant of VARIANTS) {
          let gray: Gray = clean;
          let inputPath = pgmPath;
          if (variant === "scan") {
            gray = degrade(clean, SCAN_LIKE);
            inputPath = pgmPath.replace(/\.pgm$/, "-scan.pgm");
            writeFileSync(inputPath, writePgm(gray));
          }
          const t1 = Date.now();
          let lines = rasterLines(gray, { dpi, threshold: THRESHOLD, fills: FILLS });
          // DESKEW: a scan off the glass by a degree is the common case, and
          // the finder pairs faces more happily when they sit on the axes. The
          // tilt is read off the long lines, the bitmap turned back, the lines
          // read again. Reported per arm.
          const tilt = estimateSkewDegrees(lines);
          notes.push(`${tag} ${dpi}dpi-${variant}: ${lines.length} lines, tilt ${tilt.toFixed(2)}°${Math.abs(tilt) > 0.15 ? " → deskewed" : ""}`);
          if (Math.abs(tilt) > 0.15) {
            gray = skew(gray, -tilt);
            inputPath = inputPath.replace(/\.pgm$/, "-deskewed.pgm");
            writeFileSync(inputPath, writePgm(gray));
            lines = rasterLines(gray, { dpi, threshold: THRESHOLD, fills: FILLS });
          }
          const linesMs = ms(t1);
          const t2 = Date.now();
          let ocr: { items: OcrItem[] };
          if (STACK === "mac") {
            const ocrPath = inputPath.replace(/\.pgm$/, ".ocr.json");
            execFileSync(bin, ["ocr", inputPath, ocrPath], { stdio: "pipe" });
            ocr = JSON.parse(readFileSync(ocrPath, "utf8")) as { items: OcrItem[] };
          } else {
            // Tesseract reads the (possibly degraded, deskewed) grey, put back on a canvas.
            const { canvas, context } = grayToCanvas(nodeDoc!, gray);
            ocr = await ocrTiles(nodeDoc!, canvas, context, { cachePath: tessCache, dpi });
          }
          const ocrMs = ms(t2);
          const ptPerPx = 72 / dpi;
          const textItems = ocr.items.map((i) => ({ str: i.str, x: i.x * ptPerPx, y: i.y * ptPerPx, width: i.width * ptPerPx, height: i.height * ptPerPx }));
          const pageSize = pageSizeOf(gray, dpi);
          // The scale the way the app would get it on a scan: OCR'd caption through the
          // same reader as a vector sheet. Falls back to the key's, and SAYS so.
          const printed = scaleFromPrinted(printedScalesOnPage(textItems), pageSize.widthPt, pageSize.heightPt);
          const feetPerUnit = printed?.declaredDistanceFeet ?? saved.feetPerUnit;
          const t3 = Date.now();
          const segments: StrokeSegment[] = lines.map((l) => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, width: l.width }));
          const detected = detectForSheet({ segments, textItems, pageSize, feetPerUnit });
          const offered = offeredCandidates({
            walls: detected.found.walls,
            segments: detected.found.inUnits.map((s) => ({ ...s, x1: s.x1 * pageSize.widthPt, y1: s.y1 * pageSize.widthPt, x2: s.x2 * pageSize.widthPt, y2: s.y2 * pageSize.widthPt })),
            widthPt: pageSize.widthPt,
            feetPerUnit,
            planBoxes: detected.planBoxes,
          });
          if (OUT) {
            // For `scanTool overlay`: raster lines (blue), what the finder offered
            // (red) and the key (green), all in pixels of this raster.
            const pxPerPt = dpi / 72;
            const W = pageSize.widthPt;
            const layer = (color: number[], width: number, segs: number[][]) => ({ color, width, segments: segs });
            writeFileSync(
              inputPath.replace(/\.pgm$/, ".marks.json"),
              JSON.stringify({
                layers: [
                  layer([0.2, 0.4, 1], 2, lines.map((l) => [l.x1 * pxPerPt, l.y1 * pxPerPt, l.x2 * pxPerPt, l.y2 * pxPerPt])),
                  layer([0, 0.7, 0.1], 7, key.map((k) => [k.x1 * W * pxPerPt, k.y1 * W * pxPerPt, k.x2 * W * pxPerPt, k.y2 * W * pxPerPt])),
                  layer([0.9, 0, 0], 3, offered.candidates.map((w) => [w.x1 * W * pxPerPt, w.y1 * W * pxPerPt, w.x2 * W * pxPerPt, w.y2 * W * pxPerPt])),
                ],
              }),
            );
          }
          arms.push({
            arm: `${dpi}dpi-${variant}${STACK === "node" ? "-node" : ""}`,
            scale: printed ? "ocr" : "key",
            // Scored at the KEY's scale: a candidate's geometry is in page-width
            // units, so a wrong OCR scale shows up as wrong candidates, not as a
            // rescaled key.
            score: score(`${dpi}-${variant}`, offered.candidates.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) * saved.feetPerUnit) })), saved.feetPerUnit),
            ms: { render: renderMs, lines: linesMs, ocr: ocrMs, detect: ms(t3) },
            lines: lines.length,
            ocrItems: ocr.items.length,
          });
        }
      }
      if (nodeDocs.length > 0) for (const d of nodeDocs.splice(0)) await d.destroy();
      const mine = arms.filter((a) => a.score.set === file.dir && a.score.sheet === file.sheet);
      console.log(
        `${tag}: ` +
          mine
            .map((a) => `${a.arm} found ${a.score.proposedFeet.toFixed(0)}/${a.score.keyFeet.toFixed(0)} ft, missing ${a.score.missingFeet.toFixed(0)}, extra ${a.score.extraFeet.toFixed(0)} [${a.scale}, ${a.ms.render + a.ms.lines + a.ms.ocr + a.ms.detect} ms]`)
            .join(" · "),
      );
    }

    // ── PER ARM, OVER EVERY SHEET ──
    const byArm = new Map<string, Arm[]>();
    for (const a of arms) (byArm.get(a.arm) ?? byArm.set(a.arm, []).get(a.arm)!).push(a);
    const sum = (rows: Arm[], pick: (a: Arm) => number) => rows.reduce((n, a) => n + pick(a), 0);
    const table = [...byArm.entries()].map(([arm, rows]) => ({
      arm,
      sheets: rows.length,
      keyFeet: Math.round(sum(rows, (a) => a.score.keyFeet)),
      foundFeet: Math.round(sum(rows, (a) => a.score.proposedFeet)),
      realFeet: Math.round(sum(rows, (a) => a.score.proposedFeet - a.score.extraFeet)),
      missingFeet: Math.round(sum(rows, (a) => a.score.missingFeet)),
      extraFeet: Math.round(sum(rows, (a) => a.score.extraFeet)),
      scaleFromOcr: rows.filter((a) => a.scale === "ocr").length,
      medianMs: Math.round(rows.map((a) => a.ms.render + a.ms.lines + a.ms.ocr + a.ms.detect).sort((x, y) => x - y)[Math.floor(rows.length / 2)] ?? 0),
      ms: {
        render: Math.round(sum(rows, (a) => a.ms.render) / rows.length),
        lines: Math.round(sum(rows, (a) => a.ms.lines) / rows.length),
        ocr: Math.round(sum(rows, (a) => a.ms.ocr) / rows.length),
        detect: Math.round(sum(rows, (a) => a.ms.detect) / rows.length),
      },
    }));
    console.log("\nPER ARM (training sheets): real ft = found − extra; missing = key ft no candidate covers");
    console.log("arm | sheets | key ft | found ft | real ft | missing ft | extra ft | scale from OCR | median ms | render/lines/ocr/detect ms");
    for (const r of table) {
      console.log(`${r.arm} | ${r.sheets} | ${r.keyFeet} | ${r.foundFeet} | ${r.realFeet} | ${r.missingFeet} | ${r.extraFeet} | ${r.scaleFromOcr} | ${r.medianMs} | ${r.ms.render}/${r.ms.lines}/${r.ms.ocr}/${r.ms.detect}`);
    }
    for (const n of notes) console.log(n);
    console.log(`work dir: ${work}`);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, "scanned-arms.json"), JSON.stringify({ table, arms, notes }, null, 2));
    }
    expect(labels.length).toBeGreaterThan(0);
    expect(arms.filter((a) => a.arm === "vector").length).toBeGreaterThan(0);
  });
});
