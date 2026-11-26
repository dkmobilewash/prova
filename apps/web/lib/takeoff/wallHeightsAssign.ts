import { prisma } from "@prova/db";
import type { PlanPdf } from "@/lib/plan-ingest/planPdf";
import { wallChainWithRooms, wallSideCeilings } from "./wallSides";
import { generalTypeRule, typeHeightRule, wallHeightByType, type TypeHeightRule } from "./typeHeights";
import { deckZonesFor, type StoredDeckZones } from "./deckZonesRead";
import { storedLegendTypesFromJson } from "./legendProposal";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { storeRoofParts, storedRoofParts } from "./roofPartsRead";
import { setHeightFacts } from "./setHeightFacts";
import { levelHeight, planLevels, type LevelMark } from "./levelHeights";
import { sheetViews } from "./sheetViews";
import { setFigures, setHeightRule, wallHeightConventionFrom, type SetFigures, type SetHeightRule } from "./heightsByCode";
import { syncTakeoffItemLines } from "@/lib/estimating/takeoff-item-lines";

/** The set's height rule and figures, read once per plan by code (no model) and kept, so no sheet re-walks the set. */
export const HEIGHT_RULE = "HEIGHT_RULE";
/** The plan's per-type height rules and its rule for untyped walls (`typeHeights.ts`), kept once per plan. */
export const TYPE_HEIGHTS = "TYPE_HEIGHTS";
/** One priced page's deck zones (`deckZonesRead.ts`), kept per page. */
export const DECK_ZONES_READ = "DECK_ZONES";
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

type PlanTypeHeights = { rules: Map<string, TypeHeightRule>; general: ReturnType<typeof generalTypeRule> };

/**
 * ── PER-TYPE HEIGHTS, KEPT (prereg-type-heights.md, TAKEOFF_TYPE_HEIGHTS) ──
 *
 * Each partition type's height rule from the legend reads the plan already stores, and the plan's
 * rule for untyped walls from its notes. Kept, else read: the legend proposals always, the set's
 * notes when the PDF is open.
 */
export async function planTypeHeights(planId: string, doc: PlanPdf | null): Promise<PlanTypeHeights> {
  const where = { planId_pageNumber_kind: { planId, pageNumber: 0, kind: TYPE_HEIGHTS } };
  const kept = await prisma.takeoffPlanTextRead.findUnique({ where, select: { value: true } });
  if (kept !== null) {
    const v = (kept.value ?? {}) as { rules?: [string, TypeHeightRule][]; general?: PlanTypeHeights["general"] };
    return { rules: new Map(v.rules ?? []), general: v.general ?? null };
  }
  const facts = doc === null ? null : await setHeightFacts(doc, { legendPage: 0, maxPages: 120 });
  const rules = new Map<string, TypeHeightRule>();
  for (const row of await prisma.planLegendProposal.findMany({ where: { planId }, orderBy: { createdAt: "desc" }, select: { merged: true } })) {
    for (const t of storedLegendTypesFromJson(row.merged)) {
      if (rules.has(t.code.toUpperCase())) continue;
      const r = typeHeightRule({ code: t.code, heightNote: null, lines: t.lines }, { facts: facts?.facts ?? [] });
      if (r !== null) rules.set(t.code.toUpperCase(), r);
    }
  }
  const notes = facts === null ? [] : [facts.generalNote?.text ?? "", ...facts.facts.filter((f) => f.kind === "general-note" || f.kind === "note").map((f) => f.text ?? f.phrase ?? "")];
  const general = generalTypeRule(notes, facts?.facts ?? []);
  const read = { rules: [...rules], general };
  await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber: 0, kind: TYPE_HEIGHTS, value: read as never }, update: { value: read as never, computedAt: new Date() } });
  return { rules, general };
}

/** A priced page's deck zones: kept, else read with the PDF; none without it. */
async function pageDeckZones(planId: string, pageNumber: number, feetPerUnit: number | null, doc: PlanPdf | null): Promise<StoredDeckZones | null> {
  const where = { planId_pageNumber_kind: { planId, pageNumber, kind: DECK_ZONES_READ } };
  const kept = await prisma.takeoffPlanTextRead.findUnique({ where, select: { value: true } });
  if (kept !== null) return (kept.value as StoredDeckZones | null) ?? null;
  if (doc === null || feetPerUnit === null) return null;
  const read = (await deckZonesFor(doc, null, [{ page: pageNumber, feetPerUnit }])).get(pageNumber) ?? null;
  await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber, kind: DECK_ZONES_READ, value: read as never }, update: { value: read as never, computedAt: new Date() } });
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
    select: { id: true, xs: true, ys: true, itemId: true, item: { select: { wallType: { select: { code: true } } } } },
  });
  if (walls.length === 0) return { drawn: 0, assumed: 0 };
  // Per-type heights, behind their flag: the plan's type rules and this page's deck zones.
  const byType = process.env.TAKEOFF_TYPE_HEIGHTS === "1" ? await planTypeHeights(input.planId, input.doc) : null;
  const calibration = byType === null ? null : await prisma.takeoffScaleCalibration.findFirst({ where: { pageId: input.pageId }, orderBy: { createdAt: "desc" }, select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } });
  const pageFeetPerUnit = calibration === null ? null : feetPerPageWidth({ ...calibration, declaredDistanceFeet: Number(calibration.declaredDistanceFeet) });
  const deck = byType === null ? null : await pageDeckZones(input.planId, input.pageNumber, pageFeetPerUnit, input.doc);
  const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { defaultWallHeightFt: true, wallHeightConvention: true } });
  const answer = { convention: wallHeightConventionFrom(company?.wallHeightConvention), fixedFt: company?.defaultWallHeightFt == null ? null : Number(company.defaultWallHeightFt) };
  const plan = await planHeights(input.planId, input.doc);
  const figures: SetFigures = { floorToFloorFt: await floorToFloor(input.planId, input.pageNumber, input.doc, plan.marks), structureFt: plan.structureFt, setCeilingFt: plan.setCeilingFt };
  const roof = plan.rule?.kind === "to-structure-by-roof" ? (await storedRoofParts(input.planId)).get(input.pageNumber) : undefined;
  const rooms = await prisma.takeoffMeasurement.findMany({ where: { pageId: input.pageId, source: "ROOM_FINDER" }, select: { xs: true, ys: true, ceilingHeightFeet: true, roomNumber: true, roomName: true } });
  let drawn = 0, assumed = 0;
  const items = new Set<string>();
  for (const wall of walls) {
    // The chain over the rooms either side (`wallSides.ts`, the one function zero-touch prices with too).
    const height = wallChainWithRooms({
      wall,
      rooms,
      ceilingOf: (room) => (room.ceilingHeightFeet === null ? null : Number(room.ceilingHeightFeet)),
      namedOf: (room) => room.roomNumber !== null || room.roomName !== null,
      roofMask: roof?.mask,
      rule: plan.rule,
      answer,
      figures,
    });
    // ── THE WALL'S OWN TYPE FIRST (flag on): its rule; no board; or the question, priced at the company's answer ──
    const typed = byType === null ? null : wallHeightByType({
      code: wall.item?.wallType?.code ?? null,
      rules: byType.rules,
      general: byType.general,
      sideCeilings: wallSideCeilings(wall, rooms, (room) => (room.ceilingHeightFeet === null ? null : Number(room.ceilingHeightFeet))),
      setCeilingFt: figures.setCeilingFt,
      deck: deck === null || pageFeetPerUnit === null ? null : { zones: deck.zones, at: { x: ((wall.xs[0] ?? 0) + (wall.xs[1] ?? 0)) / 2, y: ((wall.ys[0] ?? 0) + (wall.ys[1] ?? 0)) / 2 }, feetPerUnit: pageFeetPerUnit },
    });
    const data =
      typed?.kind === "height" ? { heightFt: typed.feet, heightFrom: typed.from.slice(0, 300), heightAssumed: false }
      : typed?.kind === "no-board" ? { heightFt: 0, heightFrom: `no board: ${typed.why}`.slice(0, 300), heightAssumed: false }
      : typed?.kind === "needs-answer" ? (height === null ? { heightFt: null, heightFrom: `needs answer: ${typed.why}`.slice(0, 300), heightAssumed: false } : { heightFt: height.feet, heightFrom: `needs answer: ${typed.why}; ${height.from}`.slice(0, 300), heightAssumed: true })
      : height === null ? { heightFt: null, heightFrom: null, heightAssumed: false } : { heightFt: height.feet, heightFrom: height.from.slice(0, 300), heightAssumed: height.assumed };
    await prisma.takeoffMeasurement.update({ where: { id: wall.id }, data });
    if (data.heightAssumed) assumed += 1;
    else if (data.heightFt !== null) drawn += 1;
    if (wall.itemId !== null) items.add(wall.itemId);
  }
  // The walls' lines were written before their heights: their board follows them now.
  if (items.size > 0) await prisma.$transaction((tx) => syncTakeoffItemLines(tx, input.companyId, input.jobId, items), { timeout: 60_000 });
  return { drawn, assumed };
}

/** The company changed its answer: every assumed (or still height-less) wall on its open estimates, again. */
export async function reassignAssumedHeights(companyId: string): Promise<number> {
  const pages = await prisma.takeoffPlanPage.findMany({
    where: { plan: { companyId, deletedAt: null, job: { status: "ESTIMATE" } }, measurements: { some: { kind: "LINEAR", item: { companyId }, OR: [{ heightFt: null }, { heightAssumed: true }] } } },
    select: { id: true, pageNumber: true, planId: true, plan: { select: { jobId: true } } },
  });
  for (const page of pages) if (page.plan.jobId !== null) await assignWallHeights({ planId: page.planId, pageId: page.id, pageNumber: page.pageNumber, companyId, jobId: page.plan.jobId, doc: null, refresh: true });
  return pages.length;
}
