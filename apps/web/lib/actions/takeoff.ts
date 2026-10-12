"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { isBlank, labelFromKey, parseNumericInput } from "@/lib/numeric-input";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { Opening, TakeoffLine } from "@/lib/takeoff";
import { recipeCostCategory, recipeLines, type RecipeArgs, type RecipeInput } from "@/lib/takeoff-recipes";
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
import { zoneNotices, zoneScales } from "@/lib/takeoff-zones";
import { syncWallScheduleLines } from "@/lib/estimating/wall-schedule";
import { planMeasuredWallRun, WALL_TYPE_GONE } from "@/lib/estimating/measured-wall-run";
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
import { optionalDateFromString } from "@/lib/bid-pursuits";
import { deleteDocument } from "@/lib/blob";
import { onePackageOnly, describeForPackage } from "@/lib/takeoff/packages";

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

  await prisma.$transaction(createLineItemRows(jobId, label, lines, recipeCostCategory(recipeId)));

  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
}

/**
 * The one writer both takeoff paths use — the typed form above, and the traced
 * plan below.
 *
 * SHARED SO THEY CANNOT DRIFT. The two differ in where the measurements came
 * from and in nothing else: what reaches a `JobLineItem` is a description, a
 * unit, a quantity and the recipe's cost type, and no price, cost, hours, trade
 * or catalog link. A second copy of this is how one of them quietly starts
 * writing a `budgetedUnitCost` nobody entered.
 *
 * THE COST TYPE JOINED THAT LIST IN #513, and it is the one field here that is
 * not a measurement. It is included because it is not a GUESS: every recipe
 * declares its own (`takeoff-recipes.ts`), a recipe turns a measurement into
 * quantities of stuff, and labor on this app lives in hours on the line rather
 * than in a line of its own. Without it takeoff was the one automated path
 * still producing uncoded lines — and an uncoded line is marked up at nothing,
 * so a bid taken off a plan carried no markup at all.
 *
 * Still no price and no cost: that is #515's question, not this one.
 */
function createLineItemRows(
  jobId: string,
  label: string,
  lines: TakeoffLine[],
  costCategory: ReturnType<typeof recipeCostCategory>,
  /**
   * The pricing package these quantities came from, or null for the base bid.
   *
   * NAMED ON THE DESCRIPTION and nothing more, which is the honest half of this
   * feature: the estimate is not keyed by package, because `BidLine` hangs off
   * `BidInvitation` and a takeoff hangs off a `Job` with no link between them
   * before award. So an alternate's lines are findable and movable by a person,
   * and nothing here claims the estimate knows. See `lib/takeoff/packages.ts`.
   */
  packageLabel: string | null = null,
) {
  return lines.map((line) =>
    prisma.jobLineItem.create({
      data: {
        jobId,
        // The label names WHERE it was measured. Without it a bid with four
        // takeoffs on it has four lines called "Paint" and no way to tell
        // which room any of them came from.
        description: describeForPackage(label ? `${label} — ${line.label}` : line.label, packageLabel),
        unit: line.unit,
        quantity: line.quantity,
        costCategory,
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

/**
 * Removes a plan and everything traced on it, INCLUDING the uploaded file.
 *
 * ── THIS COMMENT ARGUED THE OPPOSITE, AND THE ARGUMENT WAS HALF RIGHT ──
 *
 * It read: "The blob itself is left alone: a dangling file costs storage, and a
 * delete that half-succeeded costs a drawing somebody was working from."
 *
 * The second half is a real hazard and it is why the order below matters. The
 * first half understates it by a lot. A plan set is uploaded `access: "public"`
 * like every other document here, so what was left behind is not storage — it
 * is a GC's drawings at a permanent unauthenticated address, with no row left in
 * the database that would let anybody find it again to remove it. That is the
 * same defect #559 reported against the quote reader, and `TakeoffPlan.fileUrl`
 * is a REQUIRED column, so it happened on every plan delete rather than on a
 * failure path.
 *
 * ── THE ORDER IS WHAT ANSWERS THE OLD COMMENT'S WORRY ──
 *
 * The URL is read first, the ROW goes second, the file goes last. A
 * half-succeeded delete can now only strand a file, never leave a row pointing
 * at a file that is gone — which is the "drawing somebody was working from"
 * case, and the one worth protecting. `deleteBidAddendum` and
 * `deleteContractDocument` already do it in exactly this order.
 */
export async function deleteTakeoffPlan(jobId: string, planId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;

  // Read BEFORE the delete: `deleteMany` returns a count, not the row, so after
  // it runs there is nothing left to learn the URL from.
  const plan = await prisma.takeoffPlan.findFirst({
    where: planScope(planId, jobId, company.id),
    select: { fileUrl: true },
  });

  const deleted = await prisma.takeoffPlan.deleteMany({ where: planScope(planId, jobId, company.id) });
  if (deleted.count === 0) return actionFail("That plan is no longer on this job. Reload the page.");

  // Only once the row is confirmed gone. Failures are swallowed by
  // `deleteDocument`, so a store that will not delete cannot turn a completed
  // delete into an error for somebody who just removed a plan.
  if (plan?.fileUrl) await deleteDocument(plan.fileUrl);

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
      // "Click once at each end", not "Drag" — #631 corrected three of these
      // in `takeoff-plan.ts` and MISSED this one, because the census it added
      // reads `calibrationNotices`'s output and this refusal is the action's
      // own. The census's SCOPE was wrong while its pattern was fine, which is
      // the failure mode CLAUDE.md says no size assertion can see: nothing is
      // ever missing from a directory you do not walk.
      return actionFail("Click once at each end of a dimension on the drawing to set the scale.");
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
    //
    // `printedScale` is null ON PURPOSE and it costs nothing: the title-block
    // comparison is a WARN, `calibrationRefusal` reads only refusals, so
    // loading the proposal here would change no outcome. A disagreement with
    // the title block must not block a save — a detail at its own scale is
    // ordinary — and the estimator was shown it on the screen that posted.
    const refusal = calibrationRefusal(calibrationNotices(line, pageWidthPt, null, null));
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
  // WHICH PRICING PACKAGE THIS BELONGS TO. Empty is the BASE BID — the safe
  // default both ways round, since a form that omits the field and an estimator
  // who did not think about it both put the quantity in the number sent to the
  // GC. The opposite default would bid LOW, and a low bid is work won at a loss
  // and then built. See `lib/takeoff/packages.ts`.
  const packageLabel = String(formData.get("packageLabel") ?? "").trim();

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
      packageLabel: packageLabel || null,
      createdByUserId: userId,
    },
  });

  revalidatePath(`/jobs/${jobId}/takeoff`);
  return actionOk;
}

/**
 * SAVING A WHOLE GROUP OF FOUND WALLS AT ONCE.
 *
 * ── WHY THIS IS NOT `saveTakeoffMeasurement` IN A LOOP ──
 *
 * The wall finder returns a hundred-odd runs on a real floor plan, and one real
 * sheet measured here returned 542. A hundred Server Actions is a hundred round
 * trips, a hundred `revalidatePath` calls, and a half-written group if the tab
 * is closed in the middle — a person would be left with "some of my walls", and
 * no way to tell which.
 *
 * So the whole group lands in ONE transaction: every wall or none.
 *
 * ── WHAT IT DOES NOT RELAX ──
 *
 * Every guard the single save applies, this applies, because a measurement that
 * arrived in a batch is a measurement. The sheet must belong to the company,
 * the page must be calibrated (no calibration, no row to point at), and every
 * shape goes through `verticesProblem` — a detected wall is a proposal from a
 * geometry library, not a trusted input, and the one that fails is NAMED rather
 * than the whole batch failing anonymously.
 *
 * LINEAR only, deliberately. The finder returns centrelines; nothing in it can
 * produce an area or a count, so accepting those here would be a door nothing
 * opens.
 */
export async function saveTakeoffMeasurements(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company, id: userId } = context;

  const pageId = String(formData.get("pageId") ?? "");
  const page = await prisma.takeoffPlanPage.findFirst({
    where: { id: pageId, plan: { jobId, companyId: company.id } },
    include: { calibrations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!page) return actionFail("That sheet is no longer on this job. Reload the page.");

  const calibration = page.calibrations[0];
  if (!calibration) return actionFail("Set the scale on this sheet before measuring it.");

  const label = String(formData.get("label") ?? "").trim();
  // WHICH PRICING PACKAGE THESE BELONG TO. Empty is the BASE BID, which is the
  // safe default both ways round: a form that omits the field, and an estimator
  // who did not think about it, both put the quantities in the number sent to
  // the GC. The opposite default would bid LOW, and a low bid is work won at a
  // loss and then built. See `lib/takeoff/packages.ts`.
  const packageLabel = String(formData.get("packageLabel") ?? "").trim();

  // One `shape` field per wall, each a JSON `{xs, ys}`. A flat pair of arrays
  // could not say where one run ends and the next begins.
  // LINEAR unless asked otherwise. The wall finder sends runs and says
  // nothing; the room finder sends rings and says AREA. COUNT is deliberately
  // not accepted — nothing produces a batch of them, and a kind nothing sends
  // is a branch nothing tests.
  const askedKind = String(formData.get("kind") ?? "LINEAR");
  if (askedKind !== "LINEAR" && askedKind !== "AREA") {
    return actionFail("Those measurements didn't come through. Find them again.");
  }
  const kind = askedKind;
  const noun = kind === "AREA" ? "Room" : "Wall";

  const raw = formData.getAll("shape").map(String);
  if (raw.length === 0) return actionFail("Nothing was selected to add.");

  const shapes: { xs: number[]; ys: number[] }[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw[i]);
    } catch {
      return actionFail("Those lines didn't come through. Find the walls again.");
    }
    const shape = parsed as { xs?: unknown; ys?: unknown };
    if (!Array.isArray(shape.xs) || !Array.isArray(shape.ys)) {
      return actionFail("Those lines didn't come through. Find the walls again.");
    }
    const xs = shape.xs.map(Number);
    const ys = shape.ys.map(Number);
    if (xs.some((n) => !Number.isFinite(n)) || ys.some((n) => !Number.isFinite(n))) {
      return actionFail("Those lines didn't come through. Find the walls again.");
    }
    // NAMED, not counted. "Wall 14 of 47 didn't come through" tells somebody
    // which one to look at; "one of these is wrong" tells them to start again.
    const problem = verticesProblem(kind, xs, ys);
    if (problem) return actionFail(`${noun} ${i + 1} of ${raw.length} couldn't be added: ${problem}`);
    // The same guard the single save applies, for the same reason: a ring
    // that crosses itself has no area anybody can price. It matters more here
    // because these rings are TRACED rather than drawn — nobody watched this
    // one being made, so nothing else would notice.
    if (kind === "AREA" && ringSelfIntersects(xs, ys)) {
      return actionFail(`${noun} ${i + 1} of ${raw.length} couldn't be added: that outline crosses itself.`);
    }
    shapes.push({ xs, ys });
  }

  // `createManyAndReturn` rather than `createMany`, because an optional
  // `wallTypeId` turns this into the priced path and that needs the ids. The
  // ordinary path ignores them, so nothing is paid for it.
  const created = await prisma.takeoffMeasurement.createManyAndReturn({
    data: shapes.map((shape) => ({
      pageId: page.id,
      calibrationId: calibration.id,
      kind,
      xs: shape.xs,
      ys: shape.ys,
      label: label || null,
      packageLabel: packageLabel || null,
      createdByUserId: userId,
    })),
    select: { id: true, kind: true, xs: true, ys: true, label: true },
  });

  // ── AND IF THE DRAWING SAID WHICH WALL TYPE, POST IT PRICED ──
  //
  // THE LAST LINK, and the reason the rest of this feature was worth anything.
  // Before this, accepting a detected group wrote plain measurements and the
  // estimator then selected them, chose a wall type and a height, and posted a
  // run — for every group, on every sheet, having already been shown that the
  // drawing tags the group W1. `wallTypeMatch.ts` makes that match and it is
  // the CALLER's, because this action must not decide what a wall is.
  //
  // It reuses `postMeasuredWallRun`, which carries every refusal
  // `planMeasuredWallRun` can produce — a type with no layers, a run with no
  // height, a contracted job. Writing a second path here would be a second
  // authority on what a priced wall run is, which is the trap this file's
  // neighbours keep recording.
  const wallTypeId = String(formData.get("wallTypeId") ?? "").trim();
  if (wallTypeId !== "") {
    const stored: StoredMeasurement[] = created.map((row) => ({
      kind: row.kind,
      xs: row.xs,
      ys: row.ys,
      label: row.label,
      // THE SAME calibration every one of these was just created against, so
      // the geometry is read back at the scale it was drawn to — the
      // append-only rule `takeoff.prisma` argues for, applied here by using the
      // row rather than re-reading "the newest".
      calibration: {
        x1: calibration.x1,
        y1: calibration.y1,
        x2: calibration.x2,
        y2: calibration.y2,
        declaredDistanceFeet: calibration.declaredDistanceFeet.toNumber(),
      },
    }));
    const posted = await postMeasuredWallRun({
      companyId: company.id,
      jobId,
      label,
      wallTypeId,
      stored,
      measurementIds: created.map((row) => row.id),
      formData,
    });
    // THE MEASUREMENTS STAY IF THE RUN REFUSES, and they are not orphaned by
    // it: they are on the sheet, in the list, and postable by hand — which is
    // exactly where the old flow left every accepted group. The refusal names
    // what went wrong, so this is a step back to the previous behaviour rather
    // than a half-written state nobody can see.
    if (!posted.ok) {
      revalidatePath(`/jobs/${jobId}/takeoff`);
      return posted;
    }
    return posted;
  }

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
    // EVERY calibration, not `take: 1`. The refusal below cannot be decided
    // from the newest one alone, and this is the same posture the save action
    // takes: "the screen may be minutes old, and a calibration it refused
    // must not become savable by posting the form again."
    include: { calibrations: { orderBy: { createdAt: "desc" } } },
  });
  if (!page) return actionFail("That sheet is no longer on this job. Reload the page.");
  const newest = page.calibrations[0];
  if (!newest) return actionFail("This sheet has no scale set yet.");

  // A SHEET WITH TWO REAL SCALES MUST NOT BE RESCALED, because this action
  // repoints geometry without changing it: a detail traced at 1-1/2" moved
  // onto a 1/8" calibration reads twelve times too big, silently, on figures
  // headed for a bid. The UI withdraws the button for this case; this is the
  // half that survives a stale form, and production redacts a thrown message
  // so it must be a returned refusal rather than an exception.
  const zones = zoneScales(
    page.calibrations.map((c) => ({
      id: c.id,
      x1: c.x1,
      y1: c.y1,
      x2: c.x2,
      y2: c.y2,
      declaredDistanceFeet: c.declaredDistanceFeet.toNumber(),
    })),
    page.pageWidthPt,
  );
  if (zoneNotices(zones).length > 0) {
    return actionFail(
      "This sheet is calibrated at more than one scale, so there is no single current scale to move these to. " +
        "Each measurement already reads at the scale it was traced against.",
    );
  }

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

  // ── ONE PRICING PACKAGE AT A TIME, AND THIS ONE REFUSES ──
  //
  // Nearly every other check in this product names a problem and lets the
  // estimator proceed. This one refuses, and the difference is what happens
  // after the press: a mixed post produces line items that are individually
  // correct and collectively a base bid with an alternate folded into it, and
  // nothing on a posted line says which package it came from — so it cannot be
  // undone by looking. A refusal costs one press; the alternative costs the
  // job. See `lib/takeoff/packages.ts`.
  const onePackage = onePackageOnly(rows.map((row) => ({ id: row.id, packageLabel: row.packageLabel })));
  if (!onePackage.ok) return actionFail(onePackage.reason);

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

    // ISSUE #515. A wall measurement can be posted two ways now, and the
    // difference is the whole point of that issue: as a WALL RUN against a wall
    // type, which arrives priced, attributed and traceable — or as recipe
    // output, which arrives as bare quantities somebody then prices by hand.
    // The wall-type path is preferred and is what the form offers first; the
    // typed-height path stays because a company with no wall types defined
    // still has to be able to post what it measured.
    const wallTypeId = recipeId === "wall" ? String(formData.get("wallTypeId") ?? "").trim() : "";
    if (wallTypeId) {
      return postMeasuredWallRun({
        companyId: company.id,
        jobId,
        label,
        wallTypeId,
        stored,
        measurementIds: ids,
        formData,
      });
    }

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
      ...createLineItemRows(jobId, label, lines, recipeCostCategory(recipeId), onePackage.label),
      prisma.takeoffMeasurement.updateMany({ where: { id: { in: ids } }, data: { postedAt: new Date() } }),
    ]);

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/takeoff`);
    return actionOk;
  });
}

/**
 * A measured run posted as a `WallRun` against a wall type, rather than as
 * recipe output (issue #515).
 *
 * WHAT THIS BUYS, and why the seam was worth closing. A wall run created from
 * the Wall types page arrives complete: `syncWallScheduleLines` gives every
 * component line its description, quantity, labour hours, unit price, budgeted
 * unit cost, craft classification, catalog link, production rate and — since
 * #513 — its cost category. A plan takeoff posted as recipe output arrived
 * carrying description, unit and quantity and nothing else. So the newest and
 * most impressive way to get quantities into a bid was also the one that
 * dropped you back into hand-pricing every row, while the path that needs no
 * PDF at all arrived priced.
 *
 * NOTHING IS ADDED TO THE CAPTURE LAYER, which is what `takeoff.prisma` argues
 * for at length: a wall is a LINEAR measurement somebody elected to treat as a
 * wall at posting time, so the decision belongs here and not in the geometry.
 * The length comes from the traced runs; the height, sides and spacing come
 * from the wall type.
 *
 * AND THE TAKEOFF INHERITS `refreshWallSchedule` FOR FREE. Because this creates
 * a real `WallRun`, a recalibration or a corrected height re-derives the lines
 * through the same reconcile every other wall run uses, rather than stranding a
 * second set beside the first.
 */
async function postMeasuredWallRun(args: {
  companyId: string;
  jobId: string;
  label: string;
  wallTypeId: string;
  stored: StoredMeasurement[];
  measurementIds: string[];
  formData: FormData;
}): Promise<ActionResult> {
  const { companyId, jobId, label, wallTypeId, stored, measurementIds, formData } = args;

  // The two rows the decision needs. Read here; DECIDED in
  // `planMeasuredWallRun`, which is pure and carries every refusal — the
  // pattern `bid-recap.ts` and `takeoff.ts` already follow, and the reason the
  // refusals are testable without a database.
  const wallType = await prisma.wallType.findFirst({
    where: { id: wallTypeId, companyId },
    select: { id: true, code: true, defaultHeightFt: true, sides: true },
  });
  if (!wallType) return actionFail(WALL_TYPE_GONE);

  const plan = planMeasuredWallRun({
    wallType: {
      code: wallType.code,
      defaultHeightFt: wallType.defaultHeightFt != null ? wallType.defaultHeightFt.toNumber() : null,
      sides: wallType.sides,
    },
    layerCount: await prisma.wallTypeComponent.count({ where: { wallTypeId: wallType.id } }),
    typedHeightFt: optionalNumberFromForm(formData, "heightFt", { min: 0.01 })?.n ?? null,
    label,
  });
  if (!plan.ok) return actionFail(plan.error);

  const bridge: WallBridge = {
    heightFt: plan.heightFt,
    sides: plan.sides,
    openings: wallOpeningsFromForm(formData),
  };
  const inputs = recipeInputsFromMeasurements("wall", stored, bridge);
  if (!inputs.ok) return actionFail(inputs.error);
  const first = inputs.inputs[0];
  if (!first || first.kind !== "wall") {
    return actionFail("Those measurements do not make a wall — pick at least one traced run.");
  }

  await prisma.$transaction(async (tx) => {
    const run = await tx.wallRun.create({
      data: {
        companyId,
        jobId,
        wallTypeId: wallType.id,
        // Named after what the estimator called the selection, falling back to
        // the type's own code so a run is never nameless on the schedule.
        label: plan.label,
        lengthFt: first.wall.lengthFt.toFixed(2),
        heightFt: plan.heightFt.toFixed(2),
        openings: bridge.openings,
      },
    });
    // The same whole-job reconcile every other wall run goes through, so these
    // lines are indistinguishable from ones typed on the Wall types page.
    await syncWallScheduleLines(tx, companyId, jobId);
    await tx.takeoffMeasurement.updateMany({
      where: { id: { in: measurementIds } },
      // WHICH RUN, not just that it went somewhere. `postedAt` alone is a
      // one-way door: delete this run and its estimate line goes with it while
      // the measurement still reads "already on the estimate" and this action
      // still refuses it — nothing on the estimate and no way to put it back.
      // `deleteWallRun` undoes both fields together; without the id it has
      // nothing to find.
      data: { postedAt: new Date(), wallRunId: run.id },
    });
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/takeoff`);
  revalidatePath(`/jobs/${jobId}/estimate`);
  return actionOk;
}

/** Openings reuse the parallel-array rule the typed form already uses: a
 * half-filled pair is dropped rather than counted as a zero-sized hole. Shared,
 * because a wall posted against a wall type deducts the same openings as one
 * posted with a typed height — the height is the only thing that differs. */
function wallOpeningsFromForm(formData: FormData): Opening[] {
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
  return openings;
}

/** The two things a wall needs that a drawing does not carry, typed by hand.
 * The wall-type path below supplies both from the type instead. */
function wallBridgeFromForm(formData: FormData): WallBridge {
  const heightFt = numberFromForm(formData, "heightFt", { min: 0.01 }).n;
  const sides = String(formData.get("sides") ?? "2") === "1" ? 1 : 2;
  return { heightFt, sides, openings: wallOpeningsFromForm(formData) };
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

/**
 * Records WHICH issue of the drawings a plan was measured against.
 *
 * Separate from `recordTakeoffPlan` on purpose: the label and date are read
 * off the title block once the sheet is open in the viewer, which is after
 * the upload has already happened. Asking for them at upload time would mean
 * asking before anybody can see them.
 *
 * Blanking either field is allowed and puts the plan back to UNKNOWABLE —
 * which is honest. Somebody who realises they recorded the wrong revision
 * should be able to say so, and a plan asserted to be current on a wrong date
 * is worse than one that admits it does not know.
 */
export async function recordTakeoffPlanRevision(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  return runAction(async () => {
    const planId = String(formData.get("planId") ?? "").trim();
    if (!planId) return actionFail("Which drawing? Reload the page.");

    const revisionLabel = String(formData.get("revisionLabel") ?? "").trim();

    // ENTERED, not stamped, and this one matters more than most: the whole
    // feature compares this date against what has been issued since, so a
    // stamped "today" would make every plan permanently current.
    const sheetIssuedOn = optionalDateFromString(formData.get("sheetIssuedOn"));

    const updated = await prisma.takeoffPlan.updateMany({
      where: { id: planId, jobId, companyId: company.id },
      data: {
        revisionLabel: revisionLabel || null,
        sheetIssuedOn,
      },
    });
    if (updated.count === 0) return actionFail("That drawing is no longer on this job. Reload the page.");

    revalidatePath(`/jobs/${jobId}/takeoff`);
    return actionOk;
  });
}
