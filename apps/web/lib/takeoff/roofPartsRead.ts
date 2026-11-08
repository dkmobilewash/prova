import { prisma } from "@prova/db";
import type { PlanPdf } from "@/lib/plan-ingest/planPdf";
import { sheetNumberFrom } from "@/lib/plan-ingest/sheetNumber";
import { printedScalesAt } from "./printedScales";
import { roofIndex, roofMask, roofPartHeights, type RoofMask, type RoofPartHeights } from "./roofParts";
import type { SetHeightFacts } from "./setHeightFacts";
import { sheetViews } from "./sheetViews";
import { alignViews, longFaces } from "./viewAlign";

/**
 * ── THE ROOF PLAN'S READING, KEPT PER FLOOR PLAN SO THE QUEUE NEVER OPENS THE PDF ──
 *
 * Written when a legend type's height is read — the set is open then and its
 * sections already walked (`legendHeightsFor`). Only where the sections print
 * two levels or more, so a one-roof set stores nothing and pays nothing.
 */
export const ROOF_PARTS = "ROOF_PARTS";
export type StoredRoofParts = { mask: RoofMask; heights: RoofPartHeights };

/** Least wall faces that must agree before a roof plan is laid over a floor plan. */
export const ROOF_ALIGN_VOTES = 20;

/** A page's drawing scale: its commonest printed caption, in feet per page-width unit. */
function feetPerUnitOf(items: readonly { str: string; x: number; y: number }[], widthPt: number): { name: string; feetPerUnit: number } | null {
  const count = new Map<string, { n: number; feetPerInch: number }>();
  for (const s of printedScalesAt(items)) count.set(s.name, { n: (count.get(s.name)?.n ?? 0) + 1, feetPerInch: s.feetPerInch });
  const top = [...count].sort((a, b) => b[1].n - a[1].n)[0];
  return top === undefined ? null : { name: top[0], feetPerUnit: (widthPt / 72) * top[1].feetPerInch };
}

export async function storeRoofParts(planId: string, doc: PlanPdf, set: SetHeightFacts, maxPages = 120): Promise<number> {
  await prisma.takeoffPlanTextRead.deleteMany({ where: { planId, kind: ROOF_PARTS } });
  const read = await roofPartsFor(doc, set, maxPages);
  for (const [page, value] of read) {
    const where = { planId_pageNumber_kind: { planId, pageNumber: page, kind: ROOF_PARTS } };
    await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber: page, kind: ROOF_PARTS, value: value as never }, update: { value: value as never, computedAt: new Date() } });
  }
  return read.size;
}

/** The roof plan's reading over each floor plan page, no database: what `storeRoofParts` keeps. */
export async function roofPartsFor(doc: PlanPdf, set: SetHeightFacts, maxPages = 120): Promise<Map<number, StoredRoofParts>> {
  const out = new Map<number, StoredRoofParts>();
  const heights = roofPartHeights(set.facts);
  if (heights === null) return out;
  const roofs: { page: number; sheet: string }[] = [];
  const floors: { page: number; scale: string; feetPerUnit: number }[] = [];
  for (let page = 1; page <= Math.min(doc.pageCount, maxPages); page += 1) {
    let t: Awaited<ReturnType<PlanPdf["pageText"]>>;
    try {
      t = await doc.pageText(page);
    } catch {
      continue;
    }
    const views = sheetViews(t.items, t.widthPt).map((v) => v.name).join(" | ");
    if (/\bROOF PLAN\b/i.test(views) && !/FRAMING/i.test(views)) {
      roofs.push({ page, sheet: sheetNumberFrom({ pageNumber: page, widthPt: t.widthPt, heightPt: t.heightPt, rotation: t.rotation, items: t.items }).sheetNumber ?? `p${page}` });
    } else if (/\bFLOOR PLAN\b/i.test(views) && !/CEILING|ROOF|FRAMING|DEMO/i.test(views)) {
      const scale = feetPerUnitOf(t.items, t.widthPt);
      if (scale !== null) floors.push({ page, scale: scale.name, feetPerUnit: scale.feetPerUnit });
    }
  }
  if (roofs.length === 0 || floors.length === 0) return out;
  const roofStrokes = new Map<number, Awaited<ReturnType<PlanPdf["pageStrokes"]>>>();
  for (const floor of floors) {
    const plan = await doc.pageStrokes(floor.page);
    // The roof plan whose wall faces line up with this floor plan's, best first.
    let best: { roof: (typeof roofs)[number]; shift: { dx: number; dy: number; votes: number } } | null = null;
    for (const roof of roofs) {
      const strokes = roofStrokes.get(roof.page) ?? (await doc.pageStrokes(roof.page));
      roofStrokes.set(roof.page, strokes);
      const shift = alignViews(longFaces(plan.segments, plan.widthPt, floor.feetPerUnit), longFaces(strokes.segments, strokes.widthPt, floor.feetPerUnit), floor.feetPerUnit);
      if (shift !== null && shift.votes >= ROOF_ALIGN_VOTES && (best === null || shift.votes > best.shift.votes)) best = { roof, shift };
    }
    if (best === null) continue;
    const strokes = roofStrokes.get(best.roof.page)!;
    const W = strokes.widthPt;
    const segs = strokes.segments.map((s) => ({ x1: s.x1 / W + best!.shift.dx, y1: s.y1 / W + best!.shift.dy, x2: s.x2 / W + best!.shift.dx, y2: s.y2 / W + best!.shift.dy }));
    const mask = roofMask(roofIndex(segs, floor.feetPerUnit), { x0: 0, y0: 0, x1: 1, y1: plan.heightPt / plan.widthPt }, best.roof.sheet);
    if (mask.pitched.length === 0) continue;
    out.set(floor.page, { mask, heights });
  }
  return out;
}

/** Each floor plan page's stored roof reading. */
export async function storedRoofParts(planId: string): Promise<Map<number, StoredRoofParts>> {
  const rows = await prisma.takeoffPlanTextRead.findMany({ where: { planId, kind: ROOF_PARTS }, select: { pageNumber: true, value: true } });
  const out = new Map<number, StoredRoofParts>();
  for (const r of rows) {
    const v = r.value as Partial<StoredRoofParts> | null;
    if (v?.mask && Array.isArray(v.mask.pitched) && v.heights?.pitched && v.heights.flat) out.set(r.pageNumber, v as StoredRoofParts);
  }
  return out;
}
