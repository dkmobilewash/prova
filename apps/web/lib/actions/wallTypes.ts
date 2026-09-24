"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { syncWallScheduleLines, type WallSyncSummary } from "@/lib/estimating/wall-schedule";
import { NOT_ESTIMATE_STAGE } from "@/lib/estimating/draft-lines";
import { openingsFromJson, WALL_COMPONENT_BASES, type WallComponentBasis } from "@/lib/wall-assemblies";
import {
  actionFail,
  actionOk,
  decimalFromForm,
  InputError,
  isUniqueConstraintError,
  nullableDecimalFromForm,
  ownerRefusal,
  runAction,
  type ActionResult,
  type ActionResultWith,
} from "./shared";

/**
 * Wall types (the company's partition schedule) and each job's wall runs.
 *
 * TWO GATES, because these live behind two doors:
 *   - the LIBRARY on /wall-types answers to MANAGE_ESTIMATING, like /catalog;
 *   - a job's RUNS are edited on the Estimate tab and write estimate lines, so
 *     they answer to VIEW_JOB_COSTS, the capability that tab withholds on —
 *     the same call issue #383 made for every other estimate-tab write.
 *
 * Every action RETURNS its refusal. Numbers go through `decimalFromForm`,
 * which raises `InputError` for "1,2,50" and the like, and `runAction` turns
 * that into a sentence — including from inside a transaction, where throwing
 * is what aborts it.
 */

const NO_ESTIMATING =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";
const NO_TYPE = "That wall type is no longer in your schedule.";
const NO_JOB = "That job isn't on your account any more.";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function revalidateLibrary() {
  revalidatePath("/wall-types");
}

/* ------------------------------------------------------------ wall types */

function wallTypeFields(formData: FormData) {
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  if (!code) throw new InputError("Give the wall type its tag from the drawings — W1, P-4A.");
  if (!name) throw new InputError("Describe the wall type — what it is built from.");
  const sides = text(formData, "sides") === "1" ? 1 : 2;
  return {
    code,
    name,
    sides,
    defaultHeightFt: nullableDecimalFromForm(formData, "defaultHeightFt", { label: "Default height", min: 0.5, max: 100 }),
    studSpacingIn: decimalFromForm(formData, "studSpacingIn", { label: "Stud spacing", min: 4, max: 48 }),
    notes: text(formData, "notes") || null,
  };
}

const DUPLICATE_CODE = (code: string) => `You already have a wall type tagged ${code}. Tags come off the drawings, so each one is used once.`;

export async function createWallType(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  return runAction(async () => {
    const fields = wallTypeFields(formData);
    try {
      await prisma.wallType.create({ data: { ...fields, companyId: context.company.id } });
    } catch (err) {
      if (isUniqueConstraintError(err)) return actionFail(DUPLICATE_CODE(fields.code));
      throw err;
    }
    revalidateLibrary();
    return actionOk;
  });
}

export async function updateWallType(wallTypeId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  return runAction(async () => {
    const fields = wallTypeFields(formData);
    let updated: { count: number };
    try {
      updated = await prisma.wallType.updateMany({ where: { id: wallTypeId, companyId: context.company.id }, data: fields });
    } catch (err) {
      if (isUniqueConstraintError(err)) return actionFail(DUPLICATE_CODE(fields.code));
      throw err;
    }
    if (updated.count === 0) return actionFail(NO_TYPE);
    revalidateLibrary();
    return actionOk;
  });
}

export async function deleteWallType(wallTypeId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const refusal = ownerRefusal(context, "Only the account owner can delete a wall type. Rename it instead.");
  if (refusal) return refusal;

  const type = await prisma.wallType.findFirst({
    where: { id: wallTypeId, companyId: context.company.id },
    select: { id: true, code: true, _count: { select: { runs: true } } },
  });
  if (!type) return actionFail(NO_TYPE);
  // The runs are the measured record of an estimate. Deleting the type under
  // them would leave walls nobody can price, so refuse and say how many.
  if (type._count.runs > 0) {
    return actionFail(
      `${type.code} is on ${type._count.runs} wall ${type._count.runs === 1 ? "run" : "runs"}. Remove ${type._count.runs === 1 ? "that run" : "those runs"} from their jobs first.`,
    );
  }
  await prisma.wallType.delete({ where: { id: type.id } });
  revalidateLibrary();
  return actionOk;
}

/* ------------------------------------------------------------ components */

async function componentFields(formData: FormData, companyId: string) {
  const description = text(formData, "description");
  if (!description) throw new InputError("Name the material or the work — ⅝″ Type X, 3⅝″ track.");
  const basisRaw = text(formData, "basis");
  if (!(WALL_COMPONENT_BASES as readonly string[]).includes(basisRaw)) {
    throw new InputError("Pick what this is counted by — per foot of wall, per square foot, per stud.");
  }

  // Both ids arrive from a <select>, so each is a claim: re-read through THIS
  // company, and refuse rather than silently drop an id that is not ours.
  const catalogEntryId = text(formData, "catalogEntryId") || null;
  if (catalogEntryId) {
    const entry = await prisma.lineItemCatalogEntry.findFirst({ where: { id: catalogEntryId, companyId }, select: { id: true } });
    if (!entry) throw new InputError("That price-book entry is no longer in your catalog.");
  }
  const craftClassificationId = text(formData, "craftClassificationId") || null;
  if (craftClassificationId) {
    const craft = await prisma.craftClassification.findFirst({ where: { id: craftClassificationId, companyId }, select: { id: true } });
    if (!craft) throw new InputError("That craft is no longer set up on your account.");
  }

  return {
    description,
    unit: text(formData, "unit") || null,
    basis: basisRaw as WallComponentBasis,
    factor: decimalFromForm(formData, "factor", { label: "Factor", min: 0.0001, max: 1000 }),
    wastePercent: nullableDecimalFromForm(formData, "wastePercent", { label: "Waste", min: 0, max: 100, unit: "%" }) ?? "0",
    roundUp: formData.get("roundUp") === "on",
    productionRate: nullableDecimalFromForm(formData, "productionRate", { label: "Production rate", min: 0.0001, max: 100000 }),
    catalogEntryId,
    craftClassificationId,
  };
}

async function ownedWallType(wallTypeId: string, companyId: string) {
  return prisma.wallType.findFirst({ where: { id: wallTypeId, companyId }, select: { id: true } });
}

async function ownedComponent(componentId: string, companyId: string) {
  return prisma.wallTypeComponent.findFirst({ where: { id: componentId, wallType: { companyId } }, select: { id: true } });
}

export async function addWallTypeComponent(wallTypeId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  return runAction(async () => {
    if (!(await ownedWallType(wallTypeId, context.company.id))) return actionFail(NO_TYPE);
    const fields = await componentFields(formData, context.company.id);
    const last = await prisma.wallTypeComponent.count({ where: { wallTypeId } });
    await prisma.wallTypeComponent.create({ data: { ...fields, wallTypeId, sortOrder: last } });
    revalidateLibrary();
    return actionOk;
  });
}

export async function updateWallTypeComponent(componentId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  return runAction(async () => {
    if (!(await ownedComponent(componentId, context.company.id))) return actionFail("That part of the wall type is already gone.");
    const fields = await componentFields(formData, context.company.id);
    await prisma.wallTypeComponent.update({ where: { id: componentId }, data: fields });
    revalidateLibrary();
    return actionOk;
  });
}

export async function removeWallTypeComponent(componentId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  if (!(await ownedComponent(componentId, context.company.id))) return actionFail("That part of the wall type is already gone.");
  // Estimate lines generated from it keep standing as ordinary lines (the FK
  // is SET NULL) — a component leaving the library does not rewrite a bid.
  await prisma.wallTypeComponent.delete({ where: { id: componentId } });
  revalidateLibrary();
  return actionOk;
}

/**
 * Two common wall types, so the page is usable on day one rather than after a
 * month of setup — the competitive audit's honest claim against the incumbents.
 *
 * DELIBERATELY UNPRICED AND WITHOUT PRODUCTION RATES. The quantities follow
 * from the assembly (a stud is a stud); a price or a crew rate is this
 * company's own number, and inventing one would put a stranger's figure into a
 * bid. Default height is left blank for the same reason: each run says its own.
 */
const STARTER_TYPES = [
  {
    code: "W1",
    name: "3⅝″ 20ga steel studs at 16″ o.c., one layer ⅝″ Type X each side",
    extra: [] as { description: string; unit: string; basis: WallComponentBasis; factor: string }[],
  },
  {
    code: "W2",
    name: "3⅝″ 20ga steel studs at 16″ o.c., one layer ⅝″ Type X each side, R-13 batt",
    extra: [{ description: "R-13 batt insulation", unit: "sq ft", basis: "FACE_SQFT" as WallComponentBasis, factor: "1" }],
  },
];

const STARTER_COMPONENTS: { description: string; unit: string; basis: WallComponentBasis; factor: string; wastePercent?: string; roundUp?: boolean }[] = [
  { description: "3⅝″ 20ga studs", unit: "ea", basis: "STUDS", factor: "1", roundUp: true },
  { description: "3⅝″ 20ga track, top and bottom", unit: "lin ft", basis: "LINEAR_FT", factor: "2" },
  { description: "⅝″ Type X board, 4x8 sheets", unit: "sheets", basis: "BOARDED_SQFT", factor: "0.03125", wastePercent: "10", roundUp: true },
  { description: "Hang, tape and finish ⅝″ board", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1" },
];

type StarterResult = ActionResultWith<{ added: string[] }>;

export async function addStarterWallTypes(): Promise<StarterResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return { ok: false, error: NO_ESTIMATING };
  const companyId = context.company.id;

  const taken = new Set(
    (await prisma.wallType.findMany({ where: { companyId }, select: { code: true } })).map((type) => type.code),
  );
  const toAdd = STARTER_TYPES.filter((type) => !taken.has(type.code));
  if (toAdd.length === 0) {
    return { ok: false, error: "You already have wall types tagged W1 and W2, so nothing was added." };
  }

  await prisma.$transaction(async (tx) => {
    for (const [index, type] of toAdd.entries()) {
      await tx.wallType.create({
        data: {
          companyId,
          code: type.code,
          name: type.name,
          sides: 2,
          studSpacingIn: "16",
          sortOrder: index,
          notes: "Starter type — unpriced. Link each part to your price book and add your crew's rate.",
          components: {
            create: [...STARTER_COMPONENTS, ...type.extra].map((component, order) => ({ ...component, sortOrder: order })),
          },
        },
      });
    }
  });

  revalidateLibrary();
  return { ok: true, value: { added: toAdd.map((type) => type.code) } };
}

/* -------------------------------------------------------------- job runs */

async function estimateJob(jobId: string, companyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { status: true } });
  if (!job) return { ok: false, error: NO_JOB };
  // After award the estimate moves only by change order — the runs are the
  // record the contract was priced from, so they lock with it.
  if (job.status !== "ESTIMATE") return { ok: false, error: NOT_ESTIMATE_STAGE };
  return { ok: true };
}

function openingsFromForm(formData: FormData) {
  // A row edit carries the run's existing openings back as JSON; the add form
  // sends typed pairs. Either way they are re-validated, never trusted.
  const kept = formData.get("keptOpenings");
  if (typeof kept === "string" && kept) {
    try {
      return openingsFromJson(JSON.parse(kept));
    } catch {
      throw new InputError("The run's openings could not be read. Reload the page and try again.");
    }
  }
  const widths = formData.getAll("openingWidth").map((v) => String(v).trim());
  const heights = formData.getAll("openingHeight").map((v) => String(v).trim());
  return widths
    .map((w, i) => ({ widthFt: Number(w), heightFt: Number(heights[i]) }))
    .filter((o) => Number.isFinite(o.widthFt) && Number.isFinite(o.heightFt) && o.widthFt > 0 && o.heightFt > 0);
}

async function runFields(formData: FormData, companyId: string) {
  const wallTypeId = text(formData, "wallTypeId");
  if (!wallTypeId || !(await ownedWallType(wallTypeId, companyId))) {
    throw new InputError("Pick the wall type from your schedule.");
  }
  return {
    wallTypeId,
    label: text(formData, "label") || "Wall run",
    lengthFt: decimalFromForm(formData, "lengthFt", { label: "Length", min: 0.01, max: 100000 }),
    heightFt: nullableDecimalFromForm(formData, "heightFt", { label: "Height", min: 0.5, max: 100 }),
    openings: openingsFromForm(formData),
  };
}

function revalidateJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/estimate`);
}

type RunResult = ActionResultWith<WallSyncSummary>;

export async function addWallRun(jobId: string, formData: FormData): Promise<RunResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return { ok: false, error: JOB_COSTS_ONLY };
  const companyId = context.company.id;
  const gate = await estimateJob(jobId, companyId);
  if (!gate.ok) return gate;
  try {
    const fields = await runFields(formData, companyId);
    const summary = await prisma.$transaction(async (tx) => {
      const count = await tx.wallRun.count({ where: { jobId } });
      await tx.wallRun.create({ data: { ...fields, companyId, jobId, sortOrder: count } });
      return syncWallScheduleLines(tx, companyId, jobId);
    });
    revalidateJob(jobId);
    return { ok: true, value: summary };
  } catch (err) {
    if (err instanceof InputError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function updateWallRun(jobId: string, runId: string, formData: FormData): Promise<RunResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return { ok: false, error: JOB_COSTS_ONLY };
  const companyId = context.company.id;
  const gate = await estimateJob(jobId, companyId);
  if (!gate.ok) return gate;
  try {
    const fields = await runFields(formData, companyId);
    const summary = await prisma.$transaction(async (tx) => {
      const updated = await tx.wallRun.updateMany({ where: { id: runId, jobId, companyId }, data: fields });
      if (updated.count === 0) throw new InputError("That wall run is already gone.");
      return syncWallScheduleLines(tx, companyId, jobId);
    });
    revalidateJob(jobId);
    return { ok: true, value: summary };
  } catch (err) {
    if (err instanceof InputError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function deleteWallRun(jobId: string, runId: string): Promise<RunResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return { ok: false, error: JOB_COSTS_ONLY };
  const companyId = context.company.id;
  const gate = await estimateJob(jobId, companyId);
  if (!gate.ok) return gate;
  try {
    const summary = await prisma.$transaction(async (tx) => {
      const removed = await tx.wallRun.deleteMany({ where: { id: runId, jobId, companyId } });
      if (removed.count === 0) throw new InputError("That wall run is already gone.");
      return syncWallScheduleLines(tx, companyId, jobId);
    });
    revalidateJob(jobId);
    return { ok: true, value: summary };
  } catch (err) {
    if (err instanceof InputError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Re-apply the CURRENT wall types to this job's runs.
 *
 * Editing the library never reaches an existing estimate by itself — the same
 * rule as a proposal's clauses: a bid a GC may already hold does not move
 * because somebody tidied the schedule. This is the one deliberate door by
 * which it does, pressed on the job, where its effect is shown.
 */
export async function refreshWallSchedule(jobId: string): Promise<RunResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return { ok: false, error: JOB_COSTS_ONLY };
  const companyId = context.company.id;
  const gate = await estimateJob(jobId, companyId);
  if (!gate.ok) return gate;
  const summary = await prisma.$transaction((tx) => syncWallScheduleLines(tx, companyId, jobId));
  revalidateJob(jobId);
  return { ok: true, value: summary };
}
