import { prisma } from "@prova/db";
import { planLevels, type LevelMark } from "./levelHeights";
import { sheetViews } from "./sheetViews";
import { buildingsOf } from "./wallHeights";

/**
 * ── WHERE A WALL'S LEVEL IS KEPT, SO THE REVIEW QUEUE NEVER OPENS THE PDF ──
 *
 * Two reads, both on `TakeoffPlanTextRead`: the set's level markers, written
 * when a legend type's height is read (the set is walked then anyway,
 * `legendHeightsFor`), and each detected sheet's plan captions with where they
 * sit, written by detection. The queue joins them (`runLevels`, `levelHeight`).
 */
export const LEVEL_MARKS = "LEVEL_MARKS";
export const PLAN_CAPTIONS = "PLAN_CAPTIONS";
export const GENERAL_HEIGHT = "GENERAL_HEIGHT";
export type StoredCaption = { name: string; captionX: number; captionY: number };

export async function storeLevelMarks(planId: string, marks: readonly LevelMark[]): Promise<void> {
  const where = { planId_pageNumber_kind: { planId, pageNumber: 0, kind: LEVEL_MARKS } };
  if (marks.length === 0) return;
  const value = { marks: marks.map((m) => ({ ...m })) };
  await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber: 0, kind: LEVEL_MARKS, value }, update: { value, computedAt: new Date() } });
}

/**
 * A sheet's captions, kept only where one names a level or its plan names a
 * building ("FLOOR PLAN - INVESTIGATIVE SERVICES ADDITION" → ADDITION): a
 * single-building, single-storey set stores nothing.
 */
export async function storePlanCaptions(planId: string, pageNumber: number, items: Parameters<typeof sheetViews>[0], widthPt: number): Promise<void> {
  const captions: StoredCaption[] = sheetViews(items, widthPt).map((v) => ({ name: v.name, captionX: v.captionX, captionY: v.captionY }));
  const buildings = buildingsOf(captions.map((c) => c.name).filter((name) => /\bPLAN\b/i.test(name)));
  const where = { planId_pageNumber_kind: { planId, pageNumber, kind: PLAN_CAPTIONS } };
  if (!captions.some((c) => planLevels(c.name).length > 0) && buildings.length === 0) {
    await prisma.takeoffPlanTextRead.deleteMany({ where: { planId, pageNumber, kind: PLAN_CAPTIONS } });
    return;
  }
  const value = { captions, buildings };
  await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber, kind: PLAN_CAPTIONS, value }, update: { value, computedAt: new Date() } });
}

/** The plan's stored level marks, and each page's captions and plan buildings, for the queue. */
export async function storedLevels(planId: string): Promise<{ marks: LevelMark[]; captions: Map<number, StoredCaption[]>; buildings: Map<number, string[]> }> {
  const rows = await prisma.takeoffPlanTextRead.findMany({ where: { planId, kind: { in: [LEVEL_MARKS, PLAN_CAPTIONS] } }, select: { pageNumber: true, kind: true, value: true } });
  const marks = ((rows.find((r) => r.kind === LEVEL_MARKS)?.value as { marks?: LevelMark[] } | null)?.marks ?? []).filter((m) => typeof m?.feet === "number" && typeof m.name === "string");
  const pages = rows.filter((r) => r.kind === PLAN_CAPTIONS);
  const captions = new Map(
    pages.map((r) => [r.pageNumber, ((r.value as { captions?: StoredCaption[] } | null)?.captions ?? []).filter((c) => typeof c?.name === "string" && Number.isFinite(c.captionX) && Number.isFinite(c.captionY))]),
  );
  const buildings = new Map(pages.map((r) => [r.pageNumber, ((r.value as { buildings?: unknown[] } | null)?.buildings ?? []).filter((b): b is string => typeof b === "string")]));
  return { marks, captions, buildings };
}

/** The set's sheet-wide height (`generalHeightOf`), or its absence: a re-read that finds none clears an old one. */
export async function storeGeneralHeight(planId: string, value: { feet: number; from: string } | null): Promise<void> {
  if (value === null) {
    await prisma.takeoffPlanTextRead.deleteMany({ where: { planId, pageNumber: 0, kind: GENERAL_HEIGHT } });
    return;
  }
  const where = { planId_pageNumber_kind: { planId, pageNumber: 0, kind: GENERAL_HEIGHT } };
  await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber: 0, kind: GENERAL_HEIGHT, value }, update: { value, computedAt: new Date() } });
}

export async function storedGeneralHeight(planId: string): Promise<{ feet: number; from: string } | null> {
  const row = await prisma.takeoffPlanTextRead.findUnique({ where: { planId_pageNumber_kind: { planId, pageNumber: 0, kind: GENERAL_HEIGHT } }, select: { value: true } });
  const v = row?.value as { feet?: unknown; from?: unknown } | null | undefined;
  return v && typeof v.feet === "number" && v.feet > 0 && typeof v.from === "string" ? { feet: v.feet, from: v.from } : null;
}
