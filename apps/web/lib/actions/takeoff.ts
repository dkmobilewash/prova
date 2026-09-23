"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { isBlank, labelFromKey, parseNumericInput } from "@/lib/numeric-input";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { Opening, TakeoffLine } from "@/lib/takeoff";
import { recipeLines, type RecipeArgs, type RecipeInput } from "@/lib/takeoff-recipes";
import { documentUrlProblem } from "@/lib/document-uploads";
import { parseFeetInches } from "@/lib/feet-inches";
import {
  calibrationNotices,
  calibrationRefusal,
  recipeInputsFromMeasurements,
  ringSelfIntersects,
  verticesProblem,
  type StoredMeasurement,
  type WallBridge,
} from "@/lib/takeoff-plan";
import {
  InputError,
  actionFail,
  actionOk,
  assertEditableDirectly,
  assertJobInCompany,
  numberFromForm,
  optionalNumberFromForm,
  runAction,
  type ActionResult,
} from "./shared";

/**
 * The Estimate tab's refusal, in the house voice. The estimate tab and the
 * bid wizard's pricing step both withhold their content on VIEW_JOB_COSTS, so
 * every write they post asserts that same capability — not MANAGE_ESTIMATING,
 * which would newly refuse an ACCOUNTING member who holds VIEW_JOB_COSTS and
 * can reach these controls today (issue #383).
 */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * Creates line items from a takeoff recipe — walls, ceilings, paint, flooring
 * or fixture counts — dispatched by the `recipe` field.
 *
 * THE QUANTITIES ARE RECOMPUTED HERE, from the raw measurements, and never
 * taken from the form. The screen shows a live preview (which runs the same
 * pure `recipeLines` over the same inputs), but a quantity posted from a
 * client is a number a client chose, and these end up in a bid.
 *
 * Lines are created UNPRICED, exactly like the wall/ceiling path this
 * generalises: a takeoff produces quantities, not rates, and filling in a
 * unit price nobody entered is the guess this codebase refuses everywhere
 * else — the estimator prices them, or pulls a price across from the catalog.
 */
export async function addTakeoffLines(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const recipeId = String(formData.get("recipe") ?? "wall");
  const label = String(formData.get("label") ?? "").trim();

  // A FIGURE THIS CANNOT READ IS NAMED, rather than becoming a zero. Every
  // measurement used to go through `Number(...)` and fall back to 0 on
  // anything it disliked, so a length of `2,800` — the thousands comma a
  // contractor writes without thinking — produced no quantities and the
  // message below blamed "the measurements". Five recipes inherited that
  // when #418 generalised the two. Parsing is `lib/numeric-input.ts` now,
  // the same one the Qty box beside this form uses.
  const problems: string[] = [];
  const lines = parseTakeoffLines(recipeId, formData, problems).filter((line) => line.quantity > 0);
  if (problems.length > 0) return actionFail(problems[0]);
  if (lines.length === 0) {
    // RETURNED, not thrown: production redacts a thrown Server Action message
    // to a digest, so throwing here would put "an error occurred" on screen
    // for a person who simply left a field blank.
    return actionFail("Those measurements produce no quantities — check the numbers.");
  }

  await prisma.$transaction(createLineItemRows(jobId, label, lines));

  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
}

/**
 * The one writer both takeoff paths use — the typed form above, and the traced
 * plan below.
 *
 * SHARED SO THEY CANNOT DRIFT. The two differ in where the measurements came
 * from and in nothing else: what reaches a `JobLineItem` is a description, a
 * unit and a quantity, and no price, cost, hours, trade or catalog link. A
 * second copy of this is how one of them quietly starts writing a
 * `budgetedUnitCost` nobody entered.
 */
function createLineItemRows(jobId: string, label: string, lines: TakeoffLine[]) {
  return lines.map((line) =>
    prisma.jobLineItem.create({
      data: {
        jobId,
        // The label names WHERE it was measured. Without it a bid with four
        // takeoffs on it has four lines called "Paint" and no way to tell
        // which room any of them came from.
        description: label ? `${label} — ${line.label}` : line.label,
        unit: line.unit,
        quantity: line.quantity,
      },
    }),
  );
}

/**
 * Turns a form post into material lines, recomputed server-side. Mirrors the
 * client preview, which runs the same `recipeLines` over the same inputs —
 * the only difference is where the numbers were read from.
 */
function parseTakeoffLines(
  recipeId: string,
  formData: FormData,
  problems: string[],
): TakeoffLine[] {
  /** A field name as it reads on the form, for a refusal somebody acts on. */
  const LABELS: Record<string, string> = {
    lengthFt: "Length",
    widthFt: "Width",
    heightFt: "Height",
    areaSqFt: "Area",
    perimeterFt: "Perimeter",
    spacingIn: "Stud spacing",
    wastePercent: "Waste",
    coats: "Coats",
    coverageSqFtPerGal: "Coverage",
    openingWidth: "An opening width",
    openingHeight: "An opening height",
    fixtureCount: "A fixture count",
  };

  /** Blank stays 0 — unchanged, and still refused upstream as "no
   * quantities". A figure that is not blank and not readable is RECORDED,
   * so the refusal can name the field instead of the measurements. */
  const num = (key: string): number => read(formData.get(key), key) ?? 0;

  /** A recipe ARGUMENT: blank still reads as undefined so the recipe's own
   * default wins (waste 10%, two coats, 16" stud spacing) rather than a
   * hidden override the form never showed.
   *
   * WHAT CHANGED, and it is a judgement worth seeing: a value that is not
   * blank but cannot be read used to ALSO fall back to the default, so
   * typing `1,0` into Waste quietly bid at 10% instead. Blank still means
   * "use the default"; a typo now says so. */
  const optionalNum = (key: string): number | undefined => {
    const value = read(formData.get(key), key);
    return value === null || value <= 0 ? undefined : value;
  };

  /** null for blank or unreadable; the unreadable case appends a sentence. */
  function read(raw: FormDataEntryValue | null, key: string): number | null {
    if (isBlank(raw)) return null;
    const parsed = parseNumericInput(raw, { label: LABELS[key] ?? labelFromKey(key), min: 0 });
    if (!parsed.ok) {
      problems.push(parsed.error);
      return null;
    }
    return parsed.n;
  }

  switch (recipeId) {
    case "wall": {
      // Openings arrive as parallel arrays. A pair with either side missing
      // is dropped rather than treated as zero: a half-typed opening is an
      // unfinished thought, and deducting it as 0 x height would silently do
      // nothing while looking like it counted.
      const widths = formData.getAll("openingWidth").map((v) => read(v, "openingWidth") ?? NaN);
      const heights = formData.getAll("openingHeight").map((v) => read(v, "openingHeight") ?? NaN);
      const openings = widths
        .map((widthFt, i) => ({ widthFt, heightFt: heights[i] }))
        .filter(
          (o) => Number.isFinite(o.widthFt) && Number.isFinite(o.heightFt) && o.widthFt > 0 && o.heightFt > 0,
        );
      const spacingIn = optionalNum("spacingIn");
      const args: RecipeArgs = {
        wastePercent: optionalNum("wastePercent"),
        spacingFt: spacingIn !== undefined ? spacingIn / 12 : undefined,
      };
      return recipeLines(
        "wall",
        [
          {
            kind: "wall",
            wall: {
              lengthFt: num("lengthFt"),
              heightFt: num("heightFt"),
              sides: String(formData.get("sides")) === "1" ? 1 : 2,
              openings,
            },
          },
        ],
        args,
      );
    }
    case "ceiling":
      return recipeLines(
        "ceiling",
        [{ kind: "ceiling", ceiling: { lengthFt: num("lengthFt"), widthFt: num("widthFt") } }],
        { wastePercent: optionalNum("wastePercent") },
      );
    case "paint":
      return recipeLines("paint", [{ kind: "area", squareFeet: num("areaSqFt") }], {
        coats: optionalNum("coats"),
        coverageSqFtPerGal: optionalNum("coverageSqFtPerGal"),
      });
    case "flooring": {
      const inputs: RecipeInput[] = [{ kind: "area", squareFeet: num("areaSqFt") }];
      const perimeter = num("perimeterFt");
      if (perimeter > 0) inputs.push({ kind: "linear", feet: perimeter });
      return recipeLines("flooring", inputs, { wastePercent: optionalNum("wastePercent") });
    }
    case "fixture-count": {
      // The recipe decides what a valid count is (non-empty name, positive
      // count); here we only coerce the form fields into primitives.
      const names = formData.getAll("fixtureName").map((v) => String(v).trim());
      const counts = formData.getAll("fixtureCount").map((v) => read(v, "fixtureCount") ?? NaN);
      return recipeLines(
        "fixture-count",
        names.map((item, i) => ({ kind: "count" as const, item, count: counts[i] })),
        {},
      );
    }
    default:
      return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// ON-SCREEN PLAN TAKEOFF
//
// The same capability as everything above — the Takeoff tab withholds its
// content on VIEW_JOB_COSTS, so every write it posts asserts VIEW_JOB_COSTS —
// and the same discipline: the server recomputes, and a figure the browser
// sent is never the figure that is saved.
//
// WHAT THE FORMS CARRY, AND WHAT THEY DO NOT. Coordinates arrive as JSON
// because they are machine output — pointer positions this app's own viewer
// serialised, not figures a person typed — and every value is checked for
// being finite and inside the page-width box before anything is stored. The
// two things a PERSON types, a calibration distance and a wall height, go
// through the app's one number parser like every other typed figure.
//
// No form here carries a length, an area or a quantity. Those are derived from
// the stored geometry and the stored calibration, every time.
// ───────────────────────────────────────────────────────────────────────────

/** A plan the browser may measure: this company's, on this job. Tenancy lives
 * in the `where` rather than in a check afterwards — an id from another
 * company matches nothing, which is the refusal. */
const planScope = (planId: string, jobId: string, companyId: string) => ({
  id: planId,
  jobId,
  companyId,
});

/** Coordinates off the wire, as one JSON field holding two arrays. Shape is
 * checked here; whether the values are usable is `verticesProblem`'s job. */
function pointsFromForm(formData: FormData): { xs: number[]; ys: number[] } | null {
  const raw = formData.get("points");
  if (typeof raw !== "string" || !raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { xs, ys } = parsed as { xs?: unknown; ys?: unknown };
  if (!Array.isArray(xs) || !Array.isArray(ys)) return null;
  if (!xs.every((v) => typeof v === "number") || !ys.every((v) => typeof v === "number")) return null;
  return { xs: xs as number[], ys: ys as number[] };
}

/**
 * Records a plan PDF the browser has already uploaded to blob storage.
 *
 * The upload itself cannot go through a Server Action — Next caps an action
 * body at 1MB and a drawing is far past that — so the browser uploads under a
 * one-shot token and calls this with the URL. `documentUrlProblem` re-checks
 * both halves: that it is OUR store, and that the path is this job's plan
 * prefix. A URL is not proof of anything on its own (#195).
 */
export async function recordTakeoffPlan(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company, id: userId } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const fileUrl = String(formData.get("fileUrl") ?? "").trim();
  const fileName = String(formData.get("fileName") ?? "").trim();
  const problem = documentUrlProblem(fileUrl, "plan-takeoff", jobId, process.env);
  if (problem) return actionFail(problem);

  await prisma.takeoffPlan.create({
    data: {
      companyId: company.id,
      jobId,
      fileUrl,
      fileName: fileName || null,
      uploadedByUserId: userId,
    },
  });

  revalidatePath(`/jobs/${jobId}/takeoff`);
  return actionOk;
}

/** Removes a plan and everything traced on it. The blob itself is left alone:
 * a dangling file costs storage, and a delete that half-succeeded costs a
 * drawing somebody was working from. */
export async function deleteTakeoffPlan(jobId: string, planId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;

  const deleted = await prisma.takeoffPlan.deleteMany({ where: planScope(planId, jobId, company.id) });
  if (deleted.count === 0) return actionFail("That plan is no longer on this job. Reload the page.");

  revalidatePath(`/jobs/${jobId}/takeoff`);
  return actionOk;
}

/**
 * Sets the scale on one sheet, by APPENDING a calibration.
 *
 * Nothing is ever updated here. A measurement points at the calibration it was
 * drawn to, so a new row leaves every existing quantity exactly where it was —
 * which is the difference between correcting a scale and silently rewriting a
 * week of somebody's takeoff.
 */
export async function saveTakeoffCalibration(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company, id: userId } = context;

  const planId = String(formData.get("planId") ?? "");
  const plan = await prisma.takeoffPlan.findFirst({ where: planScope(planId, jobId, company.id) });
  if (!plan) return actionFail("That plan is no longer on this job. Reload the page.");

  return runAction(async () => {
    const pageNumber = numberFromForm(formData, "pageNumber", { integer: true, min: 1 }).n;
    const pageWidthPt = optionalNumberFromForm(formData, "pageWidthPt", { min: 1 })?.n ?? null;
    const pageLabel = String(formData.get("pageLabel") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim();

    // The dimension the estimator read off the drawing — `24'-6"` — through
    // the feet-and-inches reader, which hands anything without a foot or inch
    // mark to the app's one number parser.
    const declared = parseFeetInches(formData.get("declaredDistanceFeet"), {
      label: "The distance on the drawing",
      min: 0.01,
    });
    if (!declared.ok) throw new InputError(declared.error);

    const points = pointsFromForm(formData);
    if (!points || points.xs.length !== 2 || points.ys.length !== 2) {
      return actionFail("Drag along a dimension on the drawing to set the scale.");
    }
    const line = {
      x1: points.xs[0],
      y1: points.ys[0],
      x2: points.xs[1],
      y2: points.ys[1],
      declaredDistanceFeet: declared.n,
    };

    // The same refusals the dialog showed, re-run here. The screen may be
    // minutes old, and a calibration it refused must not become savable by
    // posting the form again.
    const refusal = calibrationRefusal(calibrationNotices(line, pageWidthPt, null));
    if (refusal) return actionFail(refusal);

    const page = await prisma.takeoffPlanPage.upsert({
      where: { planId_pageNumber: { planId, pageNumber } },
      create: {
        planId,
        pageNumber,
        label: pageLabel || null,
        pageWidthPt,
      },
      update: {
        ...(pageLabel ? { label: pageLabel } : {}),
        ...(pageWidthPt === null ? {} : { pageWidthPt }),
      },
    });

    await prisma.takeoffScaleCalibration.create({
      data: {
        pageId: page.id,
        x1: line.x1,
        y1: line.y1,
        x2: line.x2,
        y2: line.y2,
        declaredDistanceFeet: declared.value,
        note: note || null,
        createdByUserId: userId,
      },
    });

    revalidatePath(`/jobs/${jobId}/takeoff`);
    return actionOk;
  });
}

/** Saves one traced shape against the sheet's current scale. */
export async function saveTakeoffMeasurement(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company, id: userId } = context;

  const pageId = String(formData.get("pageId") ?? "");
  const page = await prisma.takeoffPlanPage.findFirst({
    where: { id: pageId, plan: { jobId, companyId: company.id } },
    include: { calibrations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!page) return actionFail("That sheet is no longer on this job. Reload the page.");

  // THE STRUCTURAL GUARD, restated in words a person can act on: no
  // calibration, no row to point at, no measurement.
  const calibration = page.calibrations[0];
  if (!calibration) return actionFail("Set the scale on this sheet before measuring it.");

  const kind = String(formData.get("kind") ?? "");
  if (kind !== "LINEAR" && kind !== "AREA" && kind !== "COUNT") {
    return actionFail("Pick a measuring tool first.");
  }

  const points = pointsFromForm(formData);
  if (!points) return actionFail("That shape didn't come through. Draw it again.");
  const shapeProblem = verticesProblem(kind, points.xs, points.ys);
  if (shapeProblem) return actionFail(shapeProblem);

  const label = String(formData.get("label") ?? "").trim();
  if (kind === "COUNT" && !label) {
    return actionFail("Name what you're counting — that name becomes the line item.");
  }

  // A ring that crosses itself has no area, and saying so now beats letting it
  // sit in the list looking like a measurement until posting time.
  if (kind === "AREA" && ringSelfIntersects(points.xs, points.ys)) {
    return actionFail("That outline crosses itself, so it has no area. Draw it again without the crossing.");
  }

  await prisma.takeoffMeasurement.create({
    data: {
      pageId: page.id,
      calibrationId: calibration.id,
      kind,
      xs: points.xs,
      ys: points.ys,
      label: label || null,
      createdByUserId: userId,
    },
  });

  revalidatePath(`/jobs/${jobId}/takeoff`);
  return actionOk;
}

export async function deleteTakeoffMeasurement(jobId: string, measurementId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;

  const deleted = await prisma.takeoffMeasurement.deleteMany({
    where: { id: measurementId, page: { plan: { jobId, companyId: company.id } } },
  });
  if (deleted.count === 0) return actionFail("That measurement is already gone. Reload the page.");

  revalidatePath(`/jobs/${jobId}/takeoff`);
  return actionOk;
}

/**
 * Moves measurements onto the sheet's newest calibration.
 *
 * EXPLICIT, because the whole point of the calibration FK is that nothing
 * moves by itself. The screen shows every before-and-after figure first; this
 * rewrites `calibrationId` and touches no geometry, so the shapes stay exactly
 * where they were drawn and only the scale they are read at changes.
 *
 * A measurement already posted to the estimate is deliberately left behind:
 * its quantity is on a line item now, and correcting that is an estimate edit
 * rather than a takeoff one.
 */
export async function rescaleTakeoffMeasurements(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;

  const pageId = String(formData.get("pageId") ?? "");
  const page = await prisma.takeoffPlanPage.findFirst({
    where: { id: pageId, plan: { jobId, companyId: company.id } },
    include: { calibrations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!page) return actionFail("That sheet is no longer on this job. Reload the page.");
  const newest = page.calibrations[0];
  if (!newest) return actionFail("This sheet has no scale set yet.");

  const moved = await prisma.takeoffMeasurement.updateMany({
    where: { pageId: page.id, calibrationId: { not: newest.id }, postedAt: null },
    data: { calibrationId: newest.id },
  });
  if (moved.count === 0) {
    return actionFail("Every measurement still on this sheet already reads at the current scale.");
  }

  revalidatePath(`/jobs/${jobId}/takeoff`);
  return actionOk;
}

/**
 * THE PAYOFF: selected measurements become estimate line items.
 *
 * THE FORM CARRIES IDS, NOT NUMBERS. Every quantity is derived here from the
 * stored geometry and the stored calibration, by the same pure module the
 * screen used to show it. There is nowhere in this signature for a figure a
 * browser chose to arrive — the same posture `addTakeoffLines` takes above,
 * and it matters more here because a traced shape LOOKS like a measurement,
 * and a number that came off a screen gets trusted.
 */
export async function postTakeoffMeasurements(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const ids = formData.getAll("measurementId").map(String).filter(Boolean);
  if (ids.length === 0) return actionFail("Pick at least one measurement to add.");

  const rows = await prisma.takeoffMeasurement.findMany({
    where: { id: { in: ids }, page: { plan: { jobId, companyId: company.id } } },
    include: { calibration: true },
  });
  if (rows.length !== ids.length) {
    return actionFail("Some of those measurements aren't on this job any more. Reload the page.");
  }
  const alreadyPosted = rows.filter((row) => row.postedAt !== null);
  if (alreadyPosted.length > 0) {
    // No create action in this app is idempotent, and posting the same four
    // runs twice doubles a bid with nothing on screen to say so.
    return actionFail(
      alreadyPosted.length === 1
        ? "One of those measurements has already been added to the estimate."
        : `${alreadyPosted.length} of those measurements have already been added to the estimate.`,
    );
  }

  return runAction(async () => {
    const recipeId = String(formData.get("recipe") ?? "");
    const label = String(formData.get("label") ?? "").trim();

    const stored: StoredMeasurement[] = rows.map((row) => ({
      kind: row.kind,
      xs: row.xs,
      ys: row.ys,
      label: row.label,
      calibration: {
        x1: row.calibration.x1,
        y1: row.calibration.y1,
        x2: row.calibration.x2,
        y2: row.calibration.y2,
        declaredDistanceFeet: row.calibration.declaredDistanceFeet.toNumber(),
      },
    }));

    const wall = recipeId === "wall" ? wallBridgeFromForm(formData) : null;
    const inputs = recipeInputsFromMeasurements(recipeId, stored, wall);
    if (!inputs.ok) return actionFail(inputs.error);

    const lines = recipeLines(recipeId, inputs.inputs, takeoffArgsFromForm(recipeId, formData)).filter(
      (line) => line.quantity > 0,
    );
    if (lines.length === 0) {
      return actionFail("Those measurements produce no quantities — check the sheet's scale.");
    }

    await prisma.$transaction([
      ...createLineItemRows(jobId, label, lines),
      prisma.takeoffMeasurement.updateMany({ where: { id: { in: ids } }, data: { postedAt: new Date() } }),
    ]);

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/takeoff`);
    return actionOk;
  });
}

/** The two things a wall needs that a drawing does not carry. Openings reuse
 * the parallel-array rule the typed form already uses: a half-filled pair is
 * dropped rather than counted as a zero-sized hole. */
function wallBridgeFromForm(formData: FormData): WallBridge {
  const heightFt = numberFromForm(formData, "heightFt", { min: 0.01 }).n;
  const sides = String(formData.get("sides") ?? "2") === "1" ? 1 : 2;

  const widths = formData.getAll("openingWidth");
  const heights = formData.getAll("openingHeight");
  const openings: Opening[] = [];
  for (let i = 0; i < Math.max(widths.length, heights.length); i += 1) {
    if (isBlank(widths[i]) || isBlank(heights[i])) continue;
    const width = parseNumericInput(widths[i], { label: labelFromKey("openingWidth"), min: 0 });
    const height = parseNumericInput(heights[i], { label: labelFromKey("openingHeight"), min: 0 });
    if (!width.ok) throw new InputError(width.error);
    if (!height.ok) throw new InputError(height.error);
    openings.push({ widthFt: width.n, heightFt: height.n });
  }
  return { heightFt, sides, openings };
}

/** The shop-varying numbers a recipe takes, read the way the typed form reads
 * them: blank means "use the recipe's own default", never zero. */
function takeoffArgsFromForm(recipeId: string, formData: FormData): RecipeArgs {
  const optional = (key: string, options?: { min?: number }) =>
    optionalNumberFromForm(formData, key, options)?.n ?? undefined;

  if (recipeId === "wall") {
    const spacingIn = optional("spacingIn", { min: 1 });
    return {
      wastePercent: optional("wastePercent", { min: 0 }),
      spacingFt: spacingIn === undefined ? undefined : spacingIn / 12,
    };
  }
  if (recipeId === "paint") {
    return {
      coats: optional("coats", { min: 1 }),
      coverageSqFtPerGal: optional("coverageSqFtPerGal", { min: 1 }),
    };
  }
  if (recipeId === "flooring") {
    return { wastePercent: optional("wastePercent", { min: 0 }) };
  }
  return {};
}
