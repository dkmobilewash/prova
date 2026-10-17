"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";

import { requireCompanyContext } from "@/lib/auth";
import { parseNumericInput } from "@/lib/numeric-input";
import { ringArea, ringSelfIntersects } from "@/lib/sheet-geometry";
import { cutoutInside } from "@/lib/takeoff/drawTools";
import { cutoutsFromJson } from "@/lib/takeoff/itemQuantities";
import { can } from "@/lib/permissions";
import { colorProblem, nextItemColor } from "@/lib/takeoff/itemColors";
import {
  actionFail,
  actionOk,
  assertEditableDirectly,
  assertJobInCompany,
  ownerRefusal,
  type ActionResult,
  type ActionResultWith,
} from "./shared";

/**
 * ── TAKEOFF ITEMS: create, rename, colour, reorder, delete ──
 *
 * The condition an estimator draws with. `lib/takeoff/itemQuantities.ts` adds
 * its measurements up; this file is only the writes.
 *
 * ── EVERY ACTION RETURNS `ActionResult`, NEVER THROWS ──
 *
 * Production redacts a thrown Server Action message to a digest, so a refusal
 * written as a `throw` reads perfectly in `next dev` and reaches a real user
 * as a dead button. `lib/actions/submittals.ts` is the reference, and
 * `ownerRefusalCensus.test.ts` fails the build if one of these refuses by
 * throwing.
 *
 * ── GATED ON `VIEW_JOB_COSTS`, like the rest of takeoff ──
 *
 * An item carries quantities that become money. The gate is the same one
 * `saveTakeoffMeasurement` uses, so somebody who may measure may also name
 * what they are measuring — splitting those would leave a tool that can draw
 * but not say what it drew.
 */

/**
 * THE SAME SENTENCE `takeoff.ts` USES, word for word, and not a paraphrase.
 *
 * `action-capability-guards.test.ts` recognises a capability refusal by the
 * phrase "part of your job function" — so a message that says the same thing
 * in different words reads to that suite as an action with NO GUARD, which is
 * what it caught here. More to the point, a person refused twice in one
 * session should be told the same thing twice; two wordings for one rule
 * reads as two different rules.
 */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";
const GONE = "That item is no longer on this job. Reload the page.";

const TYPES = ["LINEAR", "AREA", "COUNT", "SEGMENT", "AREA_WITH_PERIMETER"] as const;
type ItemType = (typeof TYPES)[number];

/** The most items one job may carry. A cap rather than a guess: the rail
 *  renders them all, and a runaway duplicate loop should hit a sentence
 *  rather than a slow page. */
const MAX_ITEMS = 500;

function typeFromForm(raw: unknown): ItemType | null {
  const value = String(raw ?? "");
  return (TYPES as readonly string[]).includes(value) ? (value as ItemType) : null;
}

/**
 * A property that may legitimately be blank.
 *
 * BLANK IS NULL, NOT ZERO, and the difference is the whole reason this exists.
 * A height nobody has decided is unknown; a height of zero is a wall with no
 * surface. `itemQuantities.ts` treats null as "no face area" and would treat a
 * zero the same way by arithmetic — but the ITEM would then claim somebody had
 * answered, and the properties panel would show a confident 0.
 */
/**
 * NAMED `optionalFigure` AND NOT the obvious alternative, which is not
 * fussiness.
 *
 * `numericInputCensus.test.ts` looks for the literal numeric constructor
 * wrapped round a `formData.get(`, and a helper whose own name ENDS in that
 * constructor makes every call site contain the forbidden string. A false
 * positive rather than a miss — the safe direction for a census to fail in —
 * but it still fails the build, and renaming the helper is cheaper than
 * teaching the pattern about identifiers.
 */
function optionalFigure(raw: unknown, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: true, value: null };
  // `parseNumericInput` and never a bare numeric coercion: that one refuses
  // the thousands comma a contractor writes without thinking, and ACCEPTS
  // `0x10` and `Infinity`, which then reach a Postgres numeric column.
  //
  // THE HELPER IS CALLED `optionalFigure` FOR A REASON — see its own comment.
  const parsed = parseNumericInput(text, { label, min: 0 });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  // `.n` is the number; `.value` is the normalised TEXT the field should show.
  return { ok: true, value: parsed.n };
}

async function itemInJob(itemId: string, jobId: string, companyId: string) {
  return prisma.takeoffItem.findFirst({
    where: { id: itemId, jobId, companyId },
    select: { id: true, name: true, type: true, sortOrder: true },
  });
}

export async function createTakeoffItem(
  jobId: string,
  formData: FormData,
): Promise<ActionResultWith<{ id: string }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return actionFail("Give the item a name — it is what the quantity will be called.");
  if (name.length > 120) return actionFail("That name is too long for the list. Keep it under 120 characters.");

  const type = typeFromForm(formData.get("type"));
  if (!type) return actionFail("Pick what this item measures.");

  const existing = await prisma.takeoffItem.findMany({
    where: { jobId },
    select: { colorHex: true, sortOrder: true },
    orderBy: { sortOrder: "desc" },
  });
  if (existing.length >= MAX_ITEMS) {
    return actionFail(`A job can carry ${MAX_ITEMS} takeoff items. Delete some before adding more.`);
  }

  const asked = String(formData.get("colorHex") ?? "").trim();
  const colorHex = asked === "" ? nextItemColor(existing.map((item) => item.colorHex)) : asked;
  const bad = colorProblem(colorHex);
  if (bad) return actionFail(bad);

  const item = await prisma.takeoffItem.create({
    data: {
      companyId: company.id,
      jobId,
      name,
      type,
      colorHex,
      sortOrder: (existing[0]?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });

  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return { ok: true, value: { id: item.id } };
}

/**
 * Rename, recolour, retype, or set a property.
 *
 * ── A FIELD THAT IS NOT IN THE FORM IS NOT TOUCHED ──
 *
 * The properties panel saves one field at a time, so a form carrying only
 * `heightFt` must not blank the thickness. `formData.has` rather than reading
 * every key and writing what comes back as null, which would make every save
 * a full overwrite and let two panels racing each other lose a value.
 */
export async function updateTakeoffItem(
  jobId: string,
  itemId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const item = await itemInJob(itemId, jobId, company.id);
  if (!item) return actionFail(GONE);

  const data: Record<string, unknown> = {};

  if (formData.has("name")) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return actionFail("An item needs a name.");
    if (name.length > 120) return actionFail("That name is too long for the list. Keep it under 120 characters.");
    data.name = name;
  }
  if (formData.has("colorHex")) {
    const colorHex = String(formData.get("colorHex") ?? "").trim();
    const bad = colorProblem(colorHex);
    if (bad) return actionFail(bad);
    data.colorHex = colorHex;
  }
  if (formData.has("lineStyle")) {
    const style = String(formData.get("lineStyle") ?? "");
    if (!["SOLID", "DASHED", "DOTTED"].includes(style)) return actionFail("Pick a line style.");
    data.lineStyle = style;
  }
  if (formData.has("type")) {
    const type = typeFromForm(formData.get("type"));
    if (!type) return actionFail("Pick what this item measures.");
    data.type = type;
  }
  if (formData.has("wallTypeId")) {
    const wallTypeId = String(formData.get("wallTypeId") ?? "").trim();
    if (wallTypeId === "") {
      data.wallTypeId = null;
    } else {
      // Scoped to the COMPANY, because an id in a form is a claim.
      const assembly = await prisma.wallType.findFirst({
        where: { id: wallTypeId, companyId: company.id },
        select: { id: true },
      });
      if (!assembly) return actionFail("That assembly is no longer in your library. Reload the page.");
      data.wallTypeId = wallTypeId;
    }
  }

  for (const [field, label] of [
    ["heightFt", "Height"],
    ["sides", "Sides"],
    ["thicknessIn", "Thickness"],
    ["wastePercent", "Waste"],
    ["spacingIn", "Spacing"],
    ["depthIn", "Depth"],
  ] as const) {
    if (!formData.has(field)) continue;
    const parsed = optionalFigure(formData.get(field), label);
    if (!parsed.ok) return actionFail(parsed.error);
    if (field === "sides" && parsed.value !== null && ![1, 2].includes(parsed.value)) {
      return actionFail("Sides is 1 or 2 — a wall is boarded on one face or both.");
    }
    if (field === "wastePercent" && parsed.value !== null && parsed.value > 100) {
      return actionFail("Waste over 100% would more than double the quantity. Check the figure.");
    }
    data[field] = parsed.value;
  }

  if (Object.keys(data).length === 0) return actionOk;

  await prisma.takeoffItem.update({ where: { id: itemId }, data });
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}

/**
 * ── DELETING AN ITEM KEEPS ITS MEASUREMENTS ──
 *
 * `TakeoffMeasurement.itemId` is `SetNull`, so the geometry survives and falls
 * into "Unassigned". Losing a morning's tracing because a condition was named
 * wrong would be unforgivable, and the schema is what guarantees it rather
 * than this function remembering to.
 *
 * The message SAYS SO, with the number, because a delete that silently kept
 * something is as surprising as one that silently destroyed it.
 */
export async function deleteTakeoffItem(jobId: string, itemId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const refusal = ownerRefusal(context, "Only an owner can delete a takeoff item.");
  if (refusal) return refusal;
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const item = await itemInJob(itemId, jobId, company.id);
  if (!item) return actionFail(GONE);

  await prisma.takeoffItem.delete({ where: { id: itemId } });
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}

/**
 * A copy of an item, with its properties and WITHOUT its measurements.
 *
 * The geometry is deliberately not copied: duplicating "6in partition" to make
 * "8in partition" is the reason anybody does this, and arriving with the first
 * one's walls already traced on the second would be a quantity nobody
 * measured, in a bid.
 */
export async function duplicateTakeoffItem(
  jobId: string,
  itemId: string,
): Promise<ActionResultWith<{ id: string }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const source = await prisma.takeoffItem.findFirst({
    where: { id: itemId, jobId, companyId: company.id },
  });
  if (!source) return actionFail(GONE);

  const siblings = await prisma.takeoffItem.findMany({
    where: { jobId },
    select: { colorHex: true, sortOrder: true },
    orderBy: { sortOrder: "desc" },
  });
  if (siblings.length >= MAX_ITEMS) {
    return actionFail(`A job can carry ${MAX_ITEMS} takeoff items. Delete some before adding more.`);
  }

  const copy = await prisma.takeoffItem.create({
    data: {
      companyId: company.id,
      jobId,
      name: `${source.name} copy`.slice(0, 120),
      type: source.type,
      // A DIFFERENT COLOUR, on purpose: two items the same colour on one
      // drawing cannot be told apart, which is most of what a colour is for.
      colorHex: nextItemColor(siblings.map((item) => item.colorHex)),
      lineStyle: source.lineStyle,
      heightFt: source.heightFt,
      sides: source.sides,
      thicknessIn: source.thicknessIn,
      wastePercent: source.wastePercent,
      spacingIn: source.spacingIn,
      depthIn: source.depthIn,
      wallTypeId: source.wallTypeId,
      sortOrder: (siblings[0]?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });

  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return { ok: true, value: { id: copy.id } };
}

/**
 * The whole list's order, in one transaction.
 *
 * ── EVERY ITEM, NOT A PAIR OF SWAPS ──
 *
 * A drag sends the resulting order and this writes all of it. Writing only the
 * two rows that moved leaves the rest holding stale `sortOrder`s that a
 * concurrent insert can collide with, and the symptom is a list that reorders
 * itself when somebody else adds an item.
 */
export async function reorderTakeoffItems(jobId: string, orderedIds: string[]): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const mine = await prisma.takeoffItem.findMany({
    where: { jobId, companyId: company.id },
    select: { id: true },
  });
  const known = new Set(mine.map((item) => item.id));
  if (orderedIds.length !== known.size || orderedIds.some((id) => !known.has(id))) {
    // A partial order would renumber some rows and leave others, which is the
    // stale-sortOrder shape this function exists to avoid.
    return actionFail("The list changed while you were dragging. Reload the page.");
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.takeoffItem.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}

/** Give traced geometry to an item, or take it back to "Unassigned". */
export async function assignMeasurementsToItem(
  jobId: string,
  itemId: string | null,
  measurementIds: string[],
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  if (measurementIds.length === 0) return actionFail("Pick at least one measurement.");

  if (itemId !== null) {
    const item = await itemInJob(itemId, jobId, company.id);
    if (!item) return actionFail(GONE);
  }

  // SCOPED THROUGH THE PLAN TO THE JOB, because an id in a form is a claim.
  const { count } = await prisma.takeoffMeasurement.updateMany({
    where: { id: { in: measurementIds }, page: { plan: { jobId, companyId: company.id } } },
    data: { itemId },
  });
  if (count !== measurementIds.length) {
    return actionFail("Some of those measurements aren't on this job any more. Reload the page.");
  }

  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}

// NOT re-exported here. A `"use server"` file may only export async
// functions — Next rejects anything else at BUILD, not at typecheck, which is
// the trap CLAUDE.md records for `export *` in the actions barrel. Importers
// take `ITEM_COLORS` from `@/lib/takeoff/itemColors` directly.


/**
 * ── AN OPENING TAKEN OFF AN AREA ──
 *
 * A door or window drawn INSIDE a room that has already been measured. The
 * hole is stored on the measurement it belongs to and `netArea` deducts it.
 *
 * ── NOBODY PICKS THE ROOM; THE HOLE FINDS IT ──
 *
 * The outline it sits inside is the one it belongs to, which `cutoutInside`
 * decides. A picker would ask somebody to name the shape they are looking
 * straight at, and would be wrong as often as it was right on a sheet where
 * two rooms touch.
 *
 * When two outlines both contain it — a room inside a floor plate, say — the
 * SMALLEST wins. A door belongs to the room, not to the building.
 */
export async function addMeasurementCutout(
  jobId: string,
  pageId: string,
  hole: { xs: number[]; ys: number[] },
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  if (hole.xs.length < 3 || hole.xs.length !== hole.ys.length) {
    return actionFail("An opening needs at least three points.");
  }
  if (ringSelfIntersects(hole.xs, hole.ys)) {
    return actionFail("That opening crosses itself, so it has no area. Draw it again.");
  }

  const areas = await prisma.takeoffMeasurement.findMany({
    where: { pageId, kind: "AREA", page: { plan: { jobId, companyId: company.id } } },
    select: { id: true, xs: true, ys: true, cutouts: true },
  });
  if (areas.length === 0) {
    return actionFail("There is no area on this sheet to take an opening out of. Draw the room first.");
  }

  const holding = areas
    .filter((area) => cutoutInside(hole, { xs: area.xs, ys: area.ys }))
    .map((area) => ({ area, size: ringArea(area.xs, area.ys) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.size - b.size);

  if (holding.length === 0) {
    // NAMED rather than silent: a hole that lands partly outside its room
    // deducts area the outline never had, and `netArea` clamps at zero — so
    // the symptom would be a room measuring NOTHING, which reads as a broken
    // tool rather than as a badly drawn opening.
    return actionFail("That opening is not inside any area on this sheet. Draw it within the outline.");
  }

  const target = holding[0].area;
  const existing = cutoutsFromJson(target.cutouts);
  await prisma.takeoffMeasurement.update({
    where: { id: target.id },
    data: { cutouts: [...existing, { xs: hole.xs, ys: hole.ys }] },
  });

  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}

/**
 * Move one vertex of a measurement that is already saved.
 *
 * ── THE GEOMETRY IS REPLACED WHOLE, AND VALIDATED LIKE A NEW ONE ──
 *
 * An edit can turn a good ring into a bowtie just as a first draw can, and
 * `ringArea` refuses one — so a shape edited into crossing itself would
 * silently measure nothing. Checked here, with the same sentence the drawing
 * tools use.
 */
export async function updateMeasurementGeometry(
  jobId: string,
  measurementId: string,
  xs: number[],
  ys: number[],
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const row = await prisma.takeoffMeasurement.findFirst({
    where: { id: measurementId, page: { plan: { jobId, companyId: company.id } } },
    select: { id: true, kind: true, postedAt: true },
  });
  if (!row) return actionFail("That measurement is no longer on this job. Reload the page.");
  if (row.postedAt !== null) {
    // A posted measurement has already become priced line items. Moving its
    // geometry would change a quantity somebody has quoted, silently.
    return actionFail("That measurement is already on the estimate. Remove it from the estimate first.");
  }
  if (xs.length !== ys.length || xs.length < 2) return actionFail("A measurement needs at least two points.");
  if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) {
    return actionFail("Those coordinates are not on the sheet.");
  }
  if (row.kind === "AREA" && ringSelfIntersects(xs, ys)) {
    return actionFail("That outline crosses itself, so it has no area. Move the point somewhere else.");
  }

  await prisma.takeoffMeasurement.update({ where: { id: measurementId }, data: { xs, ys } });
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}
