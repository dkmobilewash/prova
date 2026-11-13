import { prisma, type Prisma } from "@prova/db";
import { recordTakeoffEvents } from "@/lib/takeoff/events";
import { groupTarget } from "@/lib/takeoff/eventTarget";
import { nextItemColor } from "@/lib/takeoff/itemColors";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { groupsFromProposals } from "@/lib/takeoff/wallProposal";
import type { WallGroup } from "@/lib/takeoff/wallGroups";
import { postedType, SOURCE_WORDS, type PostSource } from "@/lib/takeoff/postingGate";
import { autoLabel, HIGH_CONFIDENCE_WALLS, modelAutoPostAt, modelPostsItself } from "@/lib/takeoff/autoPost";
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

/** `modelScore`: the wall model's score for the run, stored at detection (`wallProposal.ts`), carried onto the posted wall as its `confidence`. */
type Run = { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number; modelScore?: number };

/**
 * ── THE MODEL'S SCORE RIDES ONTO THE POSTED WALL (METHOD v2, part 1) ──
 * Each stored run carries the wall model's score from detection; posting it as the measurement's
 * `confidence` is what lets review order by it and auto-post decide on it later. Anything that is
 * not a probability is null, never a guess — `confidence` documents null as "no score".
 */
export function runConfidence(run: { modelScore?: number }): number | null {
  const s = run.modelScore;
  return typeof s === "number" && Number.isFinite(s) && s >= 0 && s <= 1 ? s : null;
}

export async function wallItemsForSheet(input: {
  planId: string;
  companyId: string;
  jobId: string;
  pageNumber: number;
  userId: string | null;
  held?: readonly { x1: number; y1: number; x2: number; y2: number }[];
  /** The wall model's auto-post score (`modelAutoPostAt("walls")`, the default); a test passes its own. */
  wallsAutoPostAt?: number | null;
}): Promise<WallItemsOutcome> {
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
  const autoPostOn = (await prisma.company.findUnique({ where: { id: input.companyId }, select: { autoPostOn: true } }))?.autoPostOn === true;
  const autoFrom = new Map<WallGroup, PostSource>();
  // ── A WALL THE MODEL IS SURE OF IS COUNTED WITHOUT REVIEW (METHOD v2, part 2) ──
  // Only with the company's switch on AND the wall model's evidence past the bar; null otherwise.
  const wallsAt = autoPostOn ? (input.wallsAutoPostAt === undefined ? modelAutoPostAt("walls") : input.wallsAutoPostAt) : null;
  const typeOf = (group: WallGroup): MatchableWallType | null => {
    const posted = postedType(group, autoPostOn);
    if (posted !== null) {
      autoFrom.set(group, posted.source);
      return posted.type;
    }
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
      const auto = autoFrom.get(group);
      const label =
        type === null
          ? "wall, untyped"
          : auto !== undefined
            ? autoLabel(type.code, SOURCE_WORDS[auto])
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
        data.push({ pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [run.x1, run.x2], ys: [run.y1, run.y2], label: isHeld ? HELD_LABEL : auto === undefined && modelPostsItself(runConfidence(run), wallsAt) ? HIGH_CONFIDENCE_WALLS : label, source: "DETECTED", confidence: runConfidence(run), itemId: isHeld ? await namedItem(tx, input.companyId, input.jobId, HELD_ITEM) : itemId, createdByUserId: input.userId });
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
  // Each group the auto-post rule typed, with nobody pressing anything (`TakeoffEvent`).
  await recordTakeoffEvents(
    [...autoFrom.entries()].map(([group, source]) => ({
      companyId: input.companyId,
      jobId: input.jobId,
      kind: "AUTO_POST" as const,
      planId: input.planId,
      pageNumber: input.pageNumber,
      target: groupTarget(input.planId, input.pageNumber, group.runs as Run[]),
      source,
      userId: input.userId,
    })),
  );
  return { kind: "written", ...written };
}

export async function itemForType(
  tx: Prisma.TransactionClient,
  companyId: string,
  jobId: string,
  type: MatchableWallType,
  row: { defaultHeightFt: unknown; sides: number | null },
  /** "levels 2–9": the type's walls on that level get their own item (`A walls · levels 2–9`), for its own height. */
  level: string | null = null,
): Promise<string> {
  // A variant (C6 of family C) gets its own item under its full code, priced
  // with the family's assembly — so the family's item is found by its name
  // first, and never falls back onto a variant's.
  const onType = await tx.takeoffItem.findMany({ where: { jobId, companyId, wallTypeId: type.id }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } });
  const levelName = level === null ? null : `${type.code} walls · ${level}`;
  const onLevel = (name: string) => name.includes(" walls · level");
  const variantItem = (name: string) => /^(.*) walls$/.test(name) && familyOf(name.replace(/ walls$/, ""), [type.code]) !== null;
  const found =
    levelName !== null
      ? onType.find((i) => i.name === levelName)
      : (onType.find((i) => i.name === `${type.code} walls`) ?? (type.family === undefined ? onType.find((i) => !variantItem(i.name) && !onLevel(i.name)) : undefined));
  if (found) return found.id;
  const existing = await tx.takeoffItem.findMany({ where: { jobId }, select: { colorHex: true, sortOrder: true }, orderBy: { sortOrder: "desc" } });
  const item = await tx.takeoffItem.create({
    data: {
      companyId,
      jobId,
      name: levelName ?? `${type.code} walls`,
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
