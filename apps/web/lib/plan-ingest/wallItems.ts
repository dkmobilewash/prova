import { prisma, type Prisma } from "@prova/db";
import { nextItemColor } from "@/lib/takeoff/itemColors";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { groupsFromProposals } from "@/lib/takeoff/wallProposal";
import { settledType, verdictFor, type WallGroup } from "@/lib/takeoff/wallGroups";
import type { MatchableWallType } from "@/lib/takeoff/wallTypeMatch";
import { isPropagatedTag, plainTag } from "@/lib/takeoff/planTextTags";

/**
 * ── THE WALLS A SHEET WAS COUNTED WITH, ON THE JOB BY TYPE ──
 *
 * The whole-set run stores each sheet's walls as proposals — one per group,
 * named by the drawing's tag, its U.N.O. note, or nothing — and until now
 * stopped there: the pilot posted every foot against one assembly. This
 * writes the groups as LINEAR measurements on a takeoff ITEM per wall type,
 * so "Send to estimate" prices each type with its own assembly (the item
 * sync, `syncTakeoffItemLines`), the way the room finder's ceilings reach
 * the estimate on a family's item.
 *
 * A group goes to a type's item when the drawing settles it — a tag naming
 * one of the company's types, or the legend's own "unless noted otherwise"
 * default for that thickness. Everything else goes to "Walls — untyped",
 * an item with no assembly, so the footage is on the job and visibly
 * unpriced rather than priced as a guess. Never twice: a page already
 * carrying DETECTED wall measurements is left alone.
 */
export const UNTYPED_ITEM = "Walls — untyped";

export type WallItemsOutcome =
  | { kind: "written"; typedFeet: number; untypedFeet: number; byType: { code: string; feet: number }[] }
  | { kind: "skipped"; why: string };

type Run = { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number };

export async function wallItemsForSheet(input: { planId: string; companyId: string; jobId: string; pageNumber: number; userId: string | null }): Promise<WallItemsOutcome> {
  const page = await prisma.takeoffPlanPage.findUnique({
    where: { planId_pageNumber: { planId: input.planId, pageNumber: input.pageNumber } },
    select: {
      id: true,
      calibrations: { orderBy: { createdAt: "desc" }, take: 1 },
      wallProposals: { orderBy: { createdAt: "desc" }, select: { calibrationId: true, createdAt: true, thicknessInches: true, source: true, sourceLabel: true, namedCode: true, itemId: true, runs: true } },
      measurements: { where: { source: "DETECTED", kind: "LINEAR" }, select: { id: true }, take: 1 },
    },
  });
  const calibration = page?.calibrations[0];
  if (!page || !calibration) return { kind: "skipped", why: "no scale" };
  if (page.measurements.length > 0) return { kind: "skipped", why: "walls already on the job" };
  const feetPerUnit = feetPerPageWidth({ x1: calibration.x1, y1: calibration.y1, x2: calibration.x2, y2: calibration.y2, declaredDistanceFeet: Number(calibration.declaredDistanceFeet) });
  if (feetPerUnit === null) return { kind: "skipped", why: "no scale" };
  const mine = page.wallProposals.filter((p) => p.calibrationId === calibration.id);
  if (mine.length === 0) return { kind: "skipped", why: "no walls found" };
  const newest = mine[0]!.createdAt.getTime();
  const rows = mine.filter((p) => p.createdAt.getTime() === newest);
  const types = await prisma.wallType.findMany({
    where: { companyId: input.companyId },
    select: { id: true, code: true, name: true, thicknessIn: true, defaultHeightFt: true, sides: true, _count: { select: { components: true } } },
  });
  const wallTypes: MatchableWallType[] = types.map((t) => ({ id: t.id, code: t.code, name: t.name, hasParts: t._count.components > 0, thicknessIn: t.thicknessIn === null ? null : Number(t.thicknessIn), defaultHeightFt: t.defaultHeightFt === null ? null : Number(t.defaultHeightFt) }));
  const groups = groupsFromProposals(rows, wallTypes, feetPerUnit);
  if (groups === null) return { kind: "skipped", why: "stored walls could not be read" };

  // The type each group settles to: a tag's own type, or the note's default.
  const typeOf = (group: WallGroup): MatchableWallType | null => {
    const verdict = verdictFor(group);
    const settled = settledType(verdict);
    if (settled !== null) return settled;
    // The note's default, only where it is the ONE type that thick: Joplin's
    // 7-1/4 in bucket is its CMU default B and its 6 in stud partition A3 at
    // once, and that is a question for the person, not a priced line.
    if (verdict.state === "ASK" && group.source.kind === "GENERAL_NOTE" && verdict.suggested && group.candidates.length === 1) return verdict.suggested;
    return null;
  };

  const written = await prisma.$transaction(async (tx) => {
    const byType = new Map<string, { code: string; feet: number }>();
    let typedFeet = 0, untypedFeet = 0;
    const data: Prisma.TakeoffMeasurementCreateManyInput[] = [];
    for (const group of groups) {
      const type = typeOf(group);
      const itemId = type === null ? await untypedItem(tx, input.companyId, input.jobId) : await itemForType(tx, input.companyId, input.jobId, type, types.find((t) => t.id === type.id)!);
      // The label says HOW the type was settled: the tag, the tag carried
      // along the wall, the legend's U.N.O., or the thickness alone — the
      // last being the weakest, a company with one type that thick.
      const label =
        type === null
          ? "wall, untyped"
          : group.source.kind === "TAG"
            ? isPropagatedTag(group.source.tag) ? `${plainTag(group.source.tag)} wall (carried)` : `${type.code} wall`
            : group.source.kind === "GENERAL_NOTE"
              ? `${type.code} wall (U.N.O.)`
              : `${type.code} wall (by thickness)`;
      for (const run of group.runs as Run[]) {
        data.push({ pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [run.x1, run.x2], ys: [run.y1, run.y2], label, source: "DETECTED", itemId, createdByUserId: input.userId });
      }
      if (type === null) untypedFeet += group.feet;
      else {
        typedFeet += group.feet;
        const slot = byType.get(type.code) ?? { code: type.code, feet: 0 };
        slot.feet += group.feet;
        byType.set(type.code, slot);
      }
    }
    if (data.length > 0) await tx.takeoffMeasurement.createMany({ data });
    return { typedFeet, untypedFeet, byType: [...byType.values()].sort((a, b) => b.feet - a.feet) };
  });
  return { kind: "written", ...written };
}

async function itemForType(tx: Prisma.TransactionClient, companyId: string, jobId: string, type: MatchableWallType, row: { defaultHeightFt: unknown; sides: number | null }): Promise<string> {
  const found = await tx.takeoffItem.findFirst({ where: { jobId, companyId, wallTypeId: type.id }, select: { id: true } });
  if (found) return found.id;
  const existing = await tx.takeoffItem.findMany({ where: { jobId }, select: { colorHex: true, sortOrder: true }, orderBy: { sortOrder: "desc" } });
  const item = await tx.takeoffItem.create({
    data: {
      companyId,
      jobId,
      name: `${type.code} walls`,
      type: "LINEAR",
      colorHex: nextItemColor(existing.map((i) => i.colorHex)),
      sortOrder: (existing[0]?.sortOrder ?? -1) + 1,
      wallTypeId: type.id,
      heightFt: row.defaultHeightFt === null ? null : Number(row.defaultHeightFt),
      sides: row.sides,
    },
    select: { id: true },
  });
  return item.id;
}

async function untypedItem(tx: Prisma.TransactionClient, companyId: string, jobId: string): Promise<string> {
  const found = await tx.takeoffItem.findFirst({ where: { jobId, companyId, name: UNTYPED_ITEM }, select: { id: true } });
  if (found) return found.id;
  const existing = await tx.takeoffItem.findMany({ where: { jobId }, select: { colorHex: true, sortOrder: true }, orderBy: { sortOrder: "desc" } });
  const item = await tx.takeoffItem.create({
    data: { companyId, jobId, name: UNTYPED_ITEM, type: "LINEAR", colorHex: nextItemColor(existing.map((i) => i.colorHex)), sortOrder: (existing[0]?.sortOrder ?? -1) + 1 },
    select: { id: true },
  });
  return item.id;
}

/** The sentence a task's note carries once the walls are on the job. */
export function wallItemsNoteFor(outcome: WallItemsOutcome): string {
  if (outcome.kind === "skipped") return `walls on job: ${outcome.why}`;
  const by = outcome.byType.map((t) => `${t.code} ${Math.round(t.feet).toLocaleString("en-US")} ft`).join(", ");
  return `on the job by type: ${by || "none typed"}; untyped ${Math.round(outcome.untypedFeet).toLocaleString("en-US")} ft`;
}
