import { prisma } from "@prova/db";
import type { PlanPdf } from "@/lib/plan-ingest/planPdf";
import { pointInRing } from "./drawTools";
import { roomPitched } from "./roofParts";
import { storeRoofParts, storedRoofParts } from "./roofPartsRead";
import { setHeightFacts } from "./setHeightFacts";
import { levelHeight, planLevels, type LevelMark } from "./levelHeights";
import { sheetViews } from "./sheetViews";
import { setFigures, setHeightRule, wallHeightChain, wallHeightConventionFrom, type SetFigures, type SetHeightRule } from "./heightsByCode";
import { syncTakeoffItemLines } from "@/lib/estimating/takeoff-item-lines";

/** The set's height rule and figures, read once per plan by code (no model) and kept, so no sheet re-walks the set. */
export const HEIGHT_RULE = "HEIGHT_RULE";
/** One floor plan's floor-to-floor (its caption's level through the sections' level marks), kept per page. */
export const FLOOR_TO_FLOOR = "FLOOR_TO_FLOOR";

type PlanHeights = { rule: SetHeightRule | null; structureFt: number | null; setCeilingFt: number | null; marks: LevelMark[] };

/** Kept, else read from the set with `doc`; with neither, nothing (a plan read before this existed). */
export async function planHeights(planId: string, doc: PlanPdf | null): Promise<PlanHeights> {
  const where = { planId_pageNumber_kind: { planId, pageNumber: 0, kind: HEIGHT_RULE } };
  const kept = await prisma.takeoffPlanTextRead.findUnique({ where, select: { value: true } });
  if (kept !== null) {
    const v = (kept.value ?? {}) as Partial<PlanHeights>;
    return { rule: v.rule ?? null, structureFt: v.structureFt ?? null, setCeilingFt: v.setCeilingFt ?? null, marks: v.marks ?? [] };
  }
  if (doc === null) return { rule: null, structureFt: null, setCeilingFt: null, marks: [] };
  const facts = await setHeightFacts(doc, { legendPage: 0, maxPages: 120 });
  const rule = setHeightRule(facts.generalNote, facts.facts);
  // Under several structure levels each wall takes its rooms' roof, which needs the roof plan read.
  if (rule?.kind === "to-structure-by-roof" && (await storedRoofParts(planId)).size === 0) await storeRoofParts(planId, doc, facts);
  const figures = setFigures(facts.facts, null);
  const read: PlanHeights = { rule, structureFt: figures.structureFt, setCeilingFt: figures.setCeilingFt, marks: facts.levels ?? [] };
  await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber: 0, kind: HEIGHT_RULE, value: read as never }, update: { value: read as never, computedAt: new Date() } });
  return read;
}

async function floorToFloor(planId: string, pageNumber: number, doc: PlanPdf | null, marks: readonly LevelMark[]): Promise<number | null> {
  const where = { planId_pageNumber_kind: { planId, pageNumber, kind: FLOOR_TO_FLOOR } };
  const kept = await prisma.takeoffPlanTextRead.findUnique({ where, select: { value: true } });
  if (kept !== null) return ((kept.value as { feet?: number | null } | null)?.feet ?? null) as number | null;
  if (doc === null) return null;
  const text = await doc.pageText(pageNumber);
  const levels = sheetViews(text.items, text.widthPt).map((v) => planLevels(v.name)).find((l) => l.length > 0) ?? [];
  const feet = levelHeight(marks, levels)?.feet ?? null;
  await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber, kind: FLOOR_TO_FLOOR, value: { feet } }, update: { value: { feet }, computedAt: new Date() } });
  return feet;
}

/** A wall's two sides: just past its middle, either way. ponytail: a fixed offset; a wall drawn thicker than ~1.5 ft at 1/8" scale probes inside itself. */
const SIDE_OFFSET = 0.006;

/**
 * ── EVERY WALL ON A SHEET A HEIGHT ──
 *
 * For each wall measurement on the page with no height (or, with `refresh`, one whose height is
 * assumed): the chain (`heightsByCode.ts`) over the rooms either side of its longest segment, as the
 * room finder stored them — their ceilings, and under several structure levels their roof — then the
 * company's own answer. Written with where it came from; a height a person or the drawing gave stays.
 */
export async function assignWallHeights(input: { planId: string; pageId: string; pageNumber: number; companyId: string; jobId: string; doc: PlanPdf | null; refresh?: boolean }): Promise<{ drawn: number; assumed: number }> {
  const walls = await prisma.takeoffMeasurement.findMany({
    where: { pageId: input.pageId, kind: "LINEAR", item: { companyId: input.companyId }, ...(input.refresh ? { OR: [{ heightFt: null }, { heightAssumed: true }] } : { heightFt: null }) },
    select: { id: true, xs: true, ys: true, itemId: true },
  });
  if (walls.length === 0) return { drawn: 0, assumed: 0 };
  const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { defaultWallHeightFt: true, wallHeightConvention: true } });
  const answer = { convention: wallHeightConventionFrom(company?.wallHeightConvention), fixedFt: company?.defaultWallHeightFt == null ? null : Number(company.defaultWallHeightFt) };
  const plan = await planHeights(input.planId, input.doc);
  const figures: SetFigures = { floorToFloorFt: await floorToFloor(input.planId, input.pageNumber, input.doc, plan.marks), structureFt: plan.structureFt, setCeilingFt: plan.setCeilingFt };
  const roof = plan.rule?.kind === "to-structure-by-roof" ? (await storedRoofParts(input.planId)).get(input.pageNumber) : undefined;
  const rooms = await prisma.takeoffMeasurement.findMany({ where: { pageId: input.pageId, source: "ROOM_FINDER" }, select: { xs: true, ys: true, ceilingHeightFeet: true, roomNumber: true, roomName: true } });
  let drawn = 0, assumed = 0;
  const items = new Set<string>();
  for (const wall of walls) {
    let best = { x1: 0, y1: 0, x2: 0, y2: 0, len: 0 };
    for (let i = 0; i + 1 < wall.xs.length; i += 1) {
      const s = { x1: wall.xs[i]!, y1: wall.ys[i]!, x2: wall.xs[i + 1]!, y2: wall.ys[i + 1]! };
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      if (len > best.len) best = { ...s, len };
    }
    const sides: (number | null)[] = [];
    const pitched: (boolean | null)[] = [];
    if (best.len > 0) {
      for (const sign of [1, -1]) {
        const px = (best.x1 + best.x2) / 2 + (sign * -(best.y2 - best.y1) / best.len) * SIDE_OFFSET;
        const py = (best.y1 + best.y2) / 2 + (sign * (best.x2 - best.x1) / best.len) * SIDE_OFFSET;
        const room = rooms.find((r) => pointInRing(px, py, r.xs, r.ys));
        sides.push(room?.ceilingHeightFeet ?? null);
        pitched.push(room && roof ? roomPitched(roof.mask, { xs: room.xs, ys: room.ys, named: room.roomNumber !== null || room.roomName !== null }) : null);
      }
    }
    const height = wallHeightChain(plan.rule, sides, pitched, answer, figures);
    await prisma.takeoffMeasurement.update({
      where: { id: wall.id },
      data: height === null ? { heightFt: null, heightFrom: null, heightAssumed: false } : { heightFt: height.feet, heightFrom: height.from.slice(0, 300), heightAssumed: height.assumed },
    });
    if (height?.assumed) assumed += 1;
    else if (height) drawn += 1;
    if (wall.itemId !== null) items.add(wall.itemId);
  }
  // The walls' lines were written before their heights: their board follows them now.
  if (items.size > 0) await prisma.$transaction((tx) => syncTakeoffItemLines(tx, input.companyId, input.jobId, items), { timeout: 60_000 });
  return { drawn, assumed };
}

/** The company changed its answer: every assumed (or still height-less) wall on its open estimates, again. */
export async function reassignAssumedHeights(companyId: string): Promise<number> {
  const pages = await prisma.takeoffPlanPage.findMany({
    where: { plan: { companyId, job: { status: "ESTIMATE" } }, measurements: { some: { kind: "LINEAR", item: { companyId }, OR: [{ heightFt: null }, { heightAssumed: true }] } } },
    select: { id: true, pageNumber: true, planId: true, plan: { select: { jobId: true } } },
  });
  for (const page of pages) await assignWallHeights({ planId: page.planId, pageId: page.id, pageNumber: page.pageNumber, companyId, jobId: page.plan.jobId, doc: null, refresh: true });
  return pages.length;
}
