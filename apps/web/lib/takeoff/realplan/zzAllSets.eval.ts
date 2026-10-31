import { Buffer } from "node:buffer";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { pageInventoryWork, type ScaleReadingRow, type SheetProposalRow, type SheetTextRow } from "../../plan-ingest/pageInventory";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { isScannedSheet } from "../../plan-ingest/scannedSheet";
import { wallsPlan, type WallsSheet } from "../../plan-ingest/walls";
import { heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { feetPerPageWidth } from "../../takeoff-plan";
import { takeoffSheetVerdict } from "../takeoffSheet";
import { SheetTooDenseError } from "../wallVectors";

/**
 * ── THE WHOLE-SET PATH OVER ONE PLAN SET, FOR RELIABILITY ──
 *
 * The product's own inventory stage through its dependency seam, capturing what
 * it would save, then the product's own `wallsPlan`, then detection and the
 * set-asides on every sheet it would measure, timed against the stage's 45 s.
 * No database and no model: titles are the keyless reader's, and a scan is
 * counted as needing the raster stage rather than run through it.
 *
 * One set per process (`ALLSETS_PDF`), so a crash or an out-of-memory on a set
 * is itself a result. Writes `ALLSETS_OUT`. Counts and timings only: a held-out
 * set is reported the same way, and no line of it is printed.
 */
const PDF = process.env.ALLSETS_PDF ?? "";
const OUT = process.env.ALLSETS_OUT ?? "";
const BUDGET_MS = 45_000;

describe.skipIf(PDF === "" || OUT === "")("the whole-set path over one plan set", () => {
  it("reports what became of every sheet", { timeout: 7_200_000 }, async () => {
    const t0 = Date.now();
    const bytes = readFileSync(PDF);
    const doc = await openPlanPdf(Buffer.from(bytes));
    const texts = new Map<number, SheetTextRow>();
    const readings = new Map<number, ScaleReadingRow>();
    const proposals = new Map<number, SheetProposalRow>();
    const work = pageInventoryWork(
      { planId: "p", companyId: "c", ingestJobId: "i", jobId: "j", startedByUserId: null },
      {
        readPlanBytes: async () => ({ ok: true, bytes: Buffer.from("") }),
        openPdf: async () => doc,
        saveSheetText: async (r) => void texts.set(r.pageNumber, r),
        saveScaleReading: async (r) => void readings.set(r.pageNumber, r),
        saveSheetProposal: async (r) => void proposals.set(r.pageNumber, r),
        planTextReadOn: async () => true,
      },
    );
    const inventoryFailed: { page: number; error: string }[] = [];
    let slowestInventoryMs = 0;
    for (let page = 1; page <= doc.pageCount; page += 1) {
      const started = Date.now();
      try {
        const r = await work({ id: `t${page}`, pageNumber: page, stage: "PAGE_INVENTORY", attempts: 0 } as never);
        if (!r.ok) inventoryFailed.push({ page, error: r.error.slice(0, 120) });
      } catch (error) {
        inventoryFailed.push({ page, error: String(error).slice(0, 120) });
      }
      slowestInventoryMs = Math.max(slowestInventoryMs, Date.now() - started);
    }
    const inventoryMs = Date.now() - t0;
    const usable = (r: ScaleReadingRow | undefined) => r !== undefined && r.scaleName !== null && r.x1 !== null && r.y1 !== null && r.x2 !== null && r.y2 !== null && r.declaredDistanceFeet !== null;
    const sheets: WallsSheet[] = [];
    for (let page = 1; page <= doc.pageCount; page += 1) {
      const p = proposals.get(page);
      sheets.push({ pageNumber: page, sheetNumber: p?.sheetNumber ?? null, title: p?.title ?? null, hasScale: usable(readings.get(page)), hasWalls: false });
    }
    const plan = wallsPlan(sheets);
    const scanned = sheets.filter((s) => {
      const t = texts.get(s.pageNumber);
      return t !== undefined && !t.hasTextLayer && isScannedSheet({ hasTextLayer: t.hasTextLayer, pathOperators: t.pathOperators, imageOperators: t.imageOperators } as never);
    }).map((s) => s.pageNumber);
    const measured: { page: number; sheet: string | null; outcome: string; feet: number; ms: number }[] = [];
    const skip: Record<string, number> = {};
    for (const s of sheets) {
      const why = plan.get(s.pageNumber) ?? null;
      if (why !== null) {
        const k = why.startsWith("same level") ? "same level" : why;
        skip[k] = (skip[k] ?? 0) + 1;
        continue;
      }
      const started = Date.now();
      const r = readings.get(s.pageNumber) as ScaleReadingRow;
      const row = { page: s.pageNumber, sheet: s.sheetNumber, outcome: "walls", feet: 0, ms: 0 };
      try {
        const st = await doc.pageStrokes(s.pageNumber);
        const text = await doc.pageText(s.pageNumber);
        const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const fpu = feetPerPageWidth({ x1: r.x1 as number, y1: r.y1 as number, x2: r.x2 as number, y2: r.y2 as number, declaredDistanceFeet: r.declaredDistanceFeet as number });
        if (fpu === null) row.outcome = "scale unusable";
        else {
          const W = st.widthPt;
          const d = detectForSheet({ segments: st.segments, textItems: items, pageSize: { widthPt: W, heightPt: st.heightPt }, feetPerUnit: fpu });
          const o = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: st.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems: items });
          const groups = d.found.regroup(o.offeredRuns);
          row.feet = Math.round(groups.reduce((n, g) => n + g.feet, 0));
          if (groups.length === 0) row.outcome = "zero walls";
        }
      } catch (error) {
        row.outcome = error instanceof SheetTooDenseError ? "too dense" : `threw: ${String(error).slice(0, 100)}`;
      }
      row.ms = Date.now() - started;
      if (row.ms > BUDGET_MS && row.outcome === "walls") row.outcome = "over 45 s";
      measured.push(row);
    }
    const floorNoScale = sheets.filter((s) => plan.get(s.pageNumber) === "no scale" && !scanned.includes(s.pageNumber) && !takeoffSheetVerdict({ sheetNumber: s.sheetNumber, title: s.title }).skipAutomatically);
    const viewScalesOnly = floorNoScale.filter((s) => (readings.get(s.pageNumber)?.viewScales?.views.length ?? 0) > 0).length;
    const declines: Record<string, number> = {};
    for (const s of floorNoScale) {
      const k = (readings.get(s.pageNumber)?.declineReason ?? "no reason recorded").slice(0, 60);
      declines[k] = (declines[k] ?? 0) + 1;
    }
    const set = basename(PDF);
    const result = {
      set,
      heldOut: heldOutReason(set) !== null,
      mb: Math.round(statSync(PDF).size / 1e6),
      pages: doc.pageCount,
      minutes: +((Date.now() - t0) / 60000).toFixed(2),
      inventoryMinutes: +(inventoryMs / 60000).toFixed(2),
      slowestInventoryMs,
      noTitle: sheets.filter((s) => s.title === null && s.sheetNumber === null).length,
      scanned: scanned.length,
      skip,
      measured,
      inventoryFailed,
      sheets: sheets.map((s) => ({ page: s.pageNumber, number: s.sheetNumber, title: (s.title ?? "").slice(0, 50), skip: plan.get(s.pageNumber) ?? null, verdict: takeoffSheetVerdict({ sheetNumber: s.sheetNumber, title: s.title }).skipAutomatically, decline: (readings.get(s.pageNumber)?.declineReason ?? "").slice(0, 70), source: readings.get(s.pageNumber)?.source ?? null, scale: readings.get(s.pageNumber)?.scaleName ?? null, views: readings.get(s.pageNumber)?.viewScales?.views.length ?? 0 })),
      floorNoScale: floorNoScale.map((s) => `${s.sheetNumber ?? `p${s.pageNumber}`} ${s.title ?? ""}`.slice(0, 60)),
      viewScalesOnly,
      declines,
    };
    writeFileSync(OUT, JSON.stringify(result, null, 1));
    await doc.close();
    expect(sheets.length, "the set has no pages").toBeGreaterThan(0);
  });
});
