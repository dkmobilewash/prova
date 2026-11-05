import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { pageInventoryWork, type ScaleReadingRow, type SheetProposalRow } from "../../plan-ingest/pageInventory";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { wallsPlan, type WallsSheet } from "../../plan-ingest/walls";
import { feetPerPageWidth } from "../../takeoff-plan";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { heldOutReason } from "../heldOutSets";
import { detectForSheet } from "../offeredCandidates";

/**
 * ── WHICH SHEETS THE VIEW TRIAGE EMPTIES ──
 *
 * Every sheet the whole-set run would measure on one TRAINING set
 * (`VIEWS_PDF`): the product's inventory and planner, then `detectForSheet`,
 * against the finder run on the whole page with no views. One JSON line per
 * sheet to `VIEWS_OUT`: drawings found, kept, the reasons the rest were left
 * out, and the feet each way. Refuses a held-out set.
 */
const PDF = process.env.VIEWS_PDF ?? "";
const OUT = process.env.VIEWS_OUT ?? "";

describe.skipIf(PDF === "" || OUT === "")("view triage over one training set", () => {
  it("records what each measured sheet kept", { timeout: 7_200_000 }, async () => {
    expect(heldOutReason(basename(PDF)), "a held-out set").toBeNull();
    const doc = await openPlanPdf(Buffer.from(readFileSync(PDF)));
    const readings = new Map<number, ScaleReadingRow>();
    const proposals = new Map<number, SheetProposalRow>();
    const work = pageInventoryWork(
      { planId: "p", companyId: "c", ingestJobId: "i", jobId: "j", startedByUserId: null },
      {
        readPlanBytes: async () => ({ ok: true, bytes: Buffer.from("") }),
        openPdf: async () => doc,
        saveSheetText: async () => {},
        saveScaleReading: async (r) => void readings.set(r.pageNumber, r),
        saveSheetProposal: async (r) => void proposals.set(r.pageNumber, r),
        sheetNamesOn: async () => true,
      },
    );
    for (let page = 1; page <= doc.pageCount; page += 1) {
      try {
        await work({ id: `t${page}`, pageNumber: page, stage: "PAGE_INVENTORY", attempts: 0 } as never);
      } catch {
        // an unreadable page is simply not measured
      }
    }
    const usable = (r: ScaleReadingRow | undefined) => r !== undefined && r.scaleName !== null && r.x1 !== null && r.y1 !== null && r.x2 !== null && r.y2 !== null && r.declaredDistanceFeet !== null;
    const sheets: WallsSheet[] = [];
    for (let page = 1; page <= doc.pageCount; page += 1) {
      const p = proposals.get(page);
      sheets.push({ pageNumber: page, sheetNumber: p?.sheetNumber ?? null, title: p?.title ?? null, hasScale: usable(readings.get(page)), hasWalls: false });
    }
    const plan = wallsPlan(sheets);
    const measured: unknown[] = [];
    for (const s of sheets) {
      if ((plan.get(s.pageNumber) ?? null) !== null) continue;
      const r = readings.get(s.pageNumber)!;
      const fpu = feetPerPageWidth({ x1: r.x1 as number, y1: r.y1 as number, x2: r.x2 as number, y2: r.y2 as number, declaredDistanceFeet: r.declaredDistanceFeet as number });
      if (fpu === null) continue;
      try {
        const st = await doc.pageStrokes(s.pageNumber);
        const items = (await doc.pageText(s.pageNumber)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const pageSize = { widthPt: st.widthPt, heightPt: st.heightPt };
        const d = detectForSheet({ segments: st.segments, textItems: items, pageSize, feetPerUnit: fpu });
        const whole = findWallsOnSheet({ segments: st.segments, textItems: items, pageSize, feetPerUnit: fpu, wallTypes: [], sampledSheets: null });
        const feet = (ws: readonly { lengthFeet: number }[]) => Math.round(ws.reduce((t, w) => t + w.lengthFeet, 0));
        measured.push({
          set: basename(PDF),
          page: s.pageNumber,
          sheet: s.sheetNumber,
          title: s.title,
          views: d.views,
          kept: d.kept.map((k) => ({ name: k.name, feet: Math.round(k.lengthFeet) })),
          others: d.others.map((o) => ({ name: o.view.name, feet: Math.round(o.lengthFeet) })),
          wholeSheet: d.wholeSheet?.why ?? null,
          leftOut: d.leftOut.map((l) => `${l.name}: ${l.reason}`),
          detectedFeet: feet(d.found.walls),
          wholePageFeet: feet(whole.walls),
        });
      } catch (error) {
        measured.push({ set: basename(PDF), page: s.pageNumber, sheet: s.sheetNumber, error: String(error).slice(0, 120) });
      }
    }
    for (const m of measured) appendFileSync(OUT, JSON.stringify(m) + "\n");
    const skipped = new Map<string, number>();
    for (const s of sheets) {
      const why = plan.get(s.pageNumber) ?? null;
      if (why !== null) skipped.set(why.startsWith("same level") ? "same level" : why, (skipped.get(why.startsWith("same level") ? "same level" : why) ?? 0) + 1);
    }
    appendFileSync(OUT, JSON.stringify({ summary: basename(PDF), pages: doc.pageCount, measured: measured.length, skipped: Object.fromEntries(skipped) }) + "\n");
    expect(sheets.length, "the set has no pages").toBeGreaterThan(0);
  });
});
