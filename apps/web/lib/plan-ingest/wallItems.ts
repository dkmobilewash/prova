import { prisma, type Prisma } from "@prova/db";
import { nextItemColor } from "@/lib/takeoff/itemColors";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { groupsFromProposals } from "@/lib/takeoff/wallProposal";
import type { WallGroup } from "@/lib/takeoff/wallGroups";
import { postedType } from "@/lib/takeoff/postingGate";
import { familyOf, type MatchableWallType } from "@/lib/takeoff/wallTypeMatch";
import { isPropagatedTag, isSiblingTag, plainTag } from "@/lib/takeoff/planTextTags";

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
export { UNTYPED_ITEM } from "@/lib/takeoff/untypedItem";
import { UNTYPED_ITEM } from "@/lib/takeoff/untypedItem";
import { HELD_ITEM, HELD_LABEL, isHeldRun } from "@/lib/takeoff/estimateHold";

export type WallItemsOutcome =
  | { kind: "written"; typedFeet: number; untypedFeet: number; heldFeet: number; byType: { code: string; feet: number }[] }
  | { kind: "skipped"; why: string };

type Run = { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number };

export async function wallItemsForSheet(input: { planId: string; companyId: string; jobId: string; pageNumber: number; userId: string | null; held?: readonly { x1: number; y1: number; x2: number; y2: number }[] }): Promise<WallItemsOutcome> {
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
  const typedItems = await prisma.takeoffItem.findMany({ where: { jobId: input.jobId, companyId: input.companyId, wallTypeId: { not: null } }, select: { id: true, wallTypeId: true } });
  const rememberedType = new Map(typedItems.map((i) => [i.id, i.wallTypeId!]));
  if (groups === null) return { kind: "skipped", why: "stored walls could not be read" };

  // The type each group is posted as: the drawing's, where its source is one
  // that is right 95% of the time (`postingGate.ts`); everything else waits in
  // the review queue with that type offered first.
  const typeOf = (group: WallGroup): MatchableWallType | null => {
    const posted = postedType(group);
    if (posted !== null) return posted;
    // Remembered for the job: an estimator's "Set type" gave an item this
    // thickness and type, and detection matched the group to that item.
    // Never over a tag: a drawing's tag the library lacks is a question, not this.
    if (group.source.kind === "TAG" || !group.itemId) return null;
    const remembered = rememberedType.get(group.itemId);
    const type = remembered === undefined ? null : (wallTypes.find((t) => t.id === remembered) ?? null);
    if (type !== null) setForJob.add(group);
    return type;
  };
  const setForJob = new Set<WallGroup>();

  const written = await prisma.$transaction(async (tx) => {
    const byType = new Map<string, { code: string; feet: number }>();
    let typedFeet = 0, untypedFeet = 0, heldFeet = 0;
    const held = input.held ?? [];
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
            ? isPropagatedTag(group.source.tag) ? `${plainTag(group.source.tag)} wall (carried)` : isSiblingTag(group.source.tag) ? `${type.code} wall (tag on another sheet)` : `${type.code} wall`
            : setForJob.has(group)
              ? `${type.code} wall (set for this job)`
              : group.source.kind === "GENERAL_NOTE"
                ? `${type.code} wall (U.N.O.)`
                : `${type.code} wall (by thickness)`;
      for (const run of group.runs as Run[]) {
        // Doubted by the wall model: on the sheet, off the estimate. See `estimateHold.ts`.
        const isHeld = isHeldRun(run, held);
        if (isHeld) heldFeet += Math.hypot(run.x2 - run.x1, run.y2 - run.y1) * feetPerUnit;
        data.push({ pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [run.x1, run.x2], ys: [run.y1, run.y2], label: isHeld ? HELD_LABEL : label, source: "DETECTED", itemId: isHeld ? await namedItem(tx, input.companyId, input.jobId, HELD_ITEM) : itemId, createdByUserId: input.userId });
      }
      const onEstimate = group.feet - (group.runs as Run[]).filter((run) => isHeldRun(run, held)).reduce((n, run) => n + Math.hypot(run.x2 - run.x1, run.y2 - run.y1) * feetPerUnit, 0);
      if (type === null) untypedFeet += onEstimate;
      else {
        typedFeet += onEstimate;
        const slot = byType.get(type.code) ?? { code: type.code, feet: 0 };
        slot.feet += onEstimate;
        byType.set(type.code, slot);
      }
    }
    if (data.length > 0) await tx.takeoffMeasurement.createMany({ data });
    return { typedFeet, untypedFeet, heldFeet, byType: [...byType.values()].sort((a, b) => b.feet - a.feet) };
  });
  return { kind: "written", ...written };
}

export async function itemForType(tx: Prisma.TransactionClient, companyId: string, jobId: string, type: MatchableWallType, row: { defaultHeightFt: unknown; sides: number | null }): Promise<string> {
  // A variant (C6 of family C) gets its own item under its full code, priced
  // with the family's assembly — so the family's item is found by its name
  // first, and never falls back onto a variant's.
  const onType = await tx.takeoffItem.findMany({ where: { jobId, companyId, wallTypeId: type.id }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } });
  const variantItem = (name: string) => /^(.*) walls$/.test(name) && familyOf(name.replace(/ walls$/, ""), [type.code]) !== null;
  const found =
    onType.find((i) => i.name === `${type.code} walls`) ??
    (type.family === undefined ? onType.find((i) => !variantItem(i.name)) : undefined);
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

export async function untypedItem(tx: Prisma.TransactionClient, companyId: string, jobId: string): Promise<string> {
  return namedItem(tx, companyId, jobId, UNTYPED_ITEM);
}

export async function namedItem(tx: Prisma.TransactionClient, companyId: string, jobId: string, name: string): Promise<string> {
  const found = await tx.takeoffItem.findFirst({ where: { jobId, companyId, name }, select: { id: true } });
  if (found) return found.id;
  const existing = await tx.takeoffItem.findMany({ where: { jobId }, select: { colorHex: true, sortOrder: true }, orderBy: { sortOrder: "desc" } });
  const item = await tx.takeoffItem.create({
    data: { companyId, jobId, name, type: "LINEAR", colorHex: nextItemColor(existing.map((i) => i.colorHex)), sortOrder: (existing[0]?.sortOrder ?? -1) + 1 },
    select: { id: true },
  });
  return item.id;
}

/** The sentence a task's note carries once the walls are on the job. */
export function wallItemsNoteFor(outcome: WallItemsOutcome): string {
  if (outcome.kind === "skipped") return `walls on job: ${outcome.why}`;
  const by = outcome.byType.map((t) => `${t.code} ${Math.round(t.feet).toLocaleString("en-US")} ft`).join(", ");
  return `on the job by type: ${by || "none typed"}; untyped ${Math.round(outcome.untypedFeet).toLocaleString("en-US")} ft${outcome.heldFeet > 0 ? `; to confirm, off the estimate ${Math.round(outcome.heldFeet).toLocaleString("en-US")} ft` : ""}`;
}
