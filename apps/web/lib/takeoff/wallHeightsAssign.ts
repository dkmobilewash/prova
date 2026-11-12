import { prisma } from "@prova/db";
import type { PlanPdf } from "@/lib/plan-ingest/planPdf";
import type { RoomFromWalls } from "./roomsFromWalls";
import type { RoomCeiling } from "./roomCeilings";
import { pointInRing } from "./drawTools";
import { roomPitched } from "./roofParts";
import { storeRoofParts, storedRoofParts } from "./roofPartsRead";
import { setHeightFacts } from "./setHeightFacts";
import { setHeightRule, wallHeightChain, type SetHeightRule } from "./heightsByCode";
import { syncTakeoffItemLines } from "@/lib/estimating/takeoff-item-lines";

/** The set's height rule, read once per plan by code (no model) and kept, so each sheet does not re-walk the set. */
export const HEIGHT_RULE = "HEIGHT_RULE";

export async function planHeightRule(planId: string, doc: PlanPdf): Promise<SetHeightRule | null> {
  const where = { planId_pageNumber_kind: { planId, pageNumber: 0, kind: HEIGHT_RULE } };
  const kept = await prisma.takeoffPlanTextRead.findUnique({ where, select: { value: true } });
  if (kept !== null) return ((kept.value as { rule?: SetHeightRule | null } | null)?.rule ?? null) as SetHeightRule | null;
  const facts = await setHeightFacts(doc, { legendPage: 0, maxPages: 120 });
  const rule = setHeightRule(facts.generalNote, facts.facts);
  // Under several structure levels each wall takes its rooms' roof, which needs the roof plan read.
  if (rule?.kind === "to-structure-by-roof" && (await storedRoofParts(planId)).size === 0) await storeRoofParts(planId, doc, facts);
  const value = { rule } as never;
  await prisma.takeoffPlanTextRead.upsert({ where, create: { planId, pageNumber: 0, kind: HEIGHT_RULE, value }, update: { value, computedAt: new Date() } });
  return rule;
}

/** A wall's two sides: just past its middle, either way. ponytail: a fixed offset; a wall drawn thicker than ~1.5 ft at 1/8" scale probes inside itself. */
const SIDE_OFFSET = 0.006;

/**
 * ── EVERY WALL ON A SHEET A HEIGHT, ONCE ITS ROOMS ARE FOUND ──
 *
 * For each wall measurement on the page with no height of its own: the chain (`heightsByCode.ts`)
 * over the rooms either side of its longest segment — their ceilings and, under several structure
 * levels, their roof. Written with where it came from; a wall a person gave a height keeps it.
 */
export async function assignWallHeights(input: { planId: string; pageId: string; pageNumber: number; companyId: string; jobId: string; doc: PlanPdf; rooms: readonly RoomFromWalls[]; ceilings: ReadonlyMap<number, RoomCeiling> }): Promise<{ drawn: number; assumed: number }> {
  const walls = await prisma.takeoffMeasurement.findMany({ where: { pageId: input.pageId, kind: "LINEAR", heightFt: null, item: { companyId: input.companyId } }, select: { id: true, xs: true, ys: true, itemId: true } });
  if (walls.length === 0) return { drawn: 0, assumed: 0 };
  const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { defaultWallHeightFt: true } });
  const defaultFt = company?.defaultWallHeightFt == null ? null : Number(company.defaultWallHeightFt);
  const rule = await planHeightRule(input.planId, input.doc);
  const roof = rule?.kind === "to-structure-by-roof" ? (await storedRoofParts(input.planId)).get(input.pageNumber) : undefined;
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
        const room = input.rooms.find((r) => pointInRing(px, py, r.xs, r.ys));
        sides.push(room ? (input.ceilings.get(room.id)?.heightFeet ?? null) : null);
        pitched.push(room && roof ? roomPitched(roof.mask, { xs: room.xs, ys: room.ys, named: room.tag !== null }) : null);
      }
    }
    const height = wallHeightChain(rule, sides, pitched, defaultFt);
    if (height === null) continue;
    await prisma.takeoffMeasurement.update({ where: { id: wall.id }, data: { heightFt: height.feet, heightFrom: height.from.slice(0, 300), heightAssumed: height.assumed } });
    if (height.assumed) assumed += 1;
    else drawn += 1;
    if (wall.itemId !== null) items.add(wall.itemId);
  }
  // The walls' lines were written before their rooms were found: their board follows the heights now.
  if (items.size > 0) await prisma.$transaction((tx) => syncTakeoffItemLines(tx, input.companyId, input.jobId, items), { timeout: 60_000 });
  return { drawn, assumed };
}
