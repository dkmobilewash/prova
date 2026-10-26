"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { asCostCategory, type CostCategory } from "@/lib/cost-category";
import { restoreRemovedWallLines, syncWallScheduleLines, type WallSyncSummary } from "@/lib/estimating/wall-schedule";
import { wallTypesFromSchedule, type PartitionScheduleRow } from "@/lib/estimating/partitionTypes";
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
    // #513. A wall type is the one place a cost type is knowable up front —
    // board and studs are material, hang-and-finish is labor — and every run of
    // this type on every job then inherits it. An unrecognised value is REFUSED
    // rather than silently nulled, which is the defect #525 fixed in
    // `setLineCostCategory`; an empty string is the select's "no cost type".
    costCategory: costCategoryFromForm(formData),
    catalogEntryId,
    craftClassificationId,
  };
}

/**
 * The component's cost type, or null, refusing anything unrecognised.
 *
 * Membership from `asCostCategory` (lib/cost-category.ts), not a local
 * `includes`: #526 landed the same day to end eight hand-written copies of this
 * enum — a ninth is what produced a NaN bid total — so this is not the place to
 * start a tenth. What that helper cannot do is tell a CLEARED field from a bad
 * one, since both are "not a category", and those two need different answers.
 */
function costCategoryFromForm(formData: FormData): CostCategory | null {
  const raw = String(formData.get("costCategory") ?? "").trim();
  if (raw === "") return null;
  const parsed = asCostCategory(raw);
  if (parsed === null) throw new InputError(`"${raw}" is not a cost type.`);
  return parsed;
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
/**
 * ── THE STARTER LIBRARY ──
 *
 * Editable DEFAULTS, not a specification. Every factor here is a common
 * convention rather than anybody's measured productivity, which is why the
 * screen that offers them says so and why nothing re-applies them: a company
 * that changes a factor has made a decision, and a later "refresh the
 * starters" would quietly take it back.
 *
 * ── THE WALL TYPES KEEP THEIR OWN SHARED PARTS; THE OTHER TRADES DO NOT ──
 *
 * `STARTER_COMPONENTS` is the stud-and-board list every partition shares.
 * A ceiling, a slab and a coat of paint share nothing with it, so they carry
 * their parts outright. The alternative — a single list with most rows
 * switched off per type — is the shape where a row nobody wanted gets priced
 * because somebody forgot a flag.
 *
 * ── NO PRICES ──
 *
 * Not one of these carries a unit price, deliberately. A part with no catalog
 * entry makes an UNPRICED estimate line, which an estimator fills in from
 * their own supplier — and a seeded price is a number that looks researched,
 * gets bid, and is nobody's.
 */
type StarterPart = {
  description: string;
  unit: string;
  basis: WallComponentBasis;
  factor: string;
  wastePercent?: string;
  roundUp?: boolean;
};

const STARTER_COMPONENTS: StarterPart[] = [
  { description: "3⅝″ 20ga studs", unit: "ea", basis: "STUDS", factor: "1", roundUp: true },
  { description: "3⅝″ 20ga track, top and bottom", unit: "lin ft", basis: "LINEAR_FT", factor: "2" },
  { description: "⅝″ Type X board, 4x8 sheets", unit: "sheets", basis: "BOARDED_SQFT", factor: "0.03125", wastePercent: "10", roundUp: true },
  { description: "Hang, tape and finish ⅝″ board", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1" },
];

const STARTER_TYPES: { code: string; name: string; parts: StarterPart[] }[] = [
  {
    code: "W1",
    name: "3⅝″ 20ga steel studs at 16″ o.c., one layer ⅝″ Type X each side",
    parts: STARTER_COMPONENTS,
  },
  {
    code: "W2",
    name: "3⅝″ 20ga steel studs at 16″ o.c., one layer ⅝″ Type X each side, R-13 batt",
    parts: [
      ...STARTER_COMPONENTS,
      { description: "R-13 batt insulation", unit: "sq ft", basis: "FACE_SQFT", factor: "1" },
    ],
  },
  {
    code: "W3",
    name: "2x4 wood studs at 16″ o.c., one layer ½″ board each side",
    parts: [
      { description: "2x4 studs", unit: "ea", basis: "STUDS", factor: "1", roundUp: true },
      { description: "2x4 plate, one bottom and two top", unit: "lin ft", basis: "LINEAR_FT", factor: "3" },
      { description: "½″ board, 4x8 sheets", unit: "sheets", basis: "BOARDED_SQFT", factor: "0.03125", wastePercent: "10", roundUp: true },
      { description: "Hang, tape and finish ½″ board", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1" },
    ],
  },
  {
    code: "EW1",
    name: "Exterior 6″ 18ga stud wall, sheathed and insulated, board inside",
    parts: [
      { description: "6″ 18ga studs", unit: "ea", basis: "STUDS", factor: "1", roundUp: true },
      { description: "6″ 18ga track, top and bottom", unit: "lin ft", basis: "LINEAR_FT", factor: "2" },
      { description: "½″ exterior sheathing", unit: "sq ft", basis: "FACE_SQFT", factor: "1", wastePercent: "10" },
      { description: "R-21 batt insulation", unit: "sq ft", basis: "FACE_SQFT", factor: "1" },
      { description: "⅝″ Type X board, inside face only", unit: "sq ft", basis: "FACE_SQFT", factor: "1", wastePercent: "10" },
      { description: "Hang, tape and finish inside face", unit: "sq ft", basis: "FACE_SQFT", factor: "1" },
    ],
  },
  {
    code: "FIN5",
    name: "Drywall finish — Level 5 skim over board already hung",
    parts: [
      { description: "Level 5 skim coat", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1" },
      { description: "Joint compound for skim", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1", wastePercent: "5" },
    ],
  },
  {
    code: "ACT1",
    name: "Acoustic ceiling — 2x4 lay-in grid and tile",
    parts: [
      // AREA_SQFT and PERIMETER_FT, which a wall run cannot produce at all —
      // this type exists for a TAKEOFF ITEM traced as an area.
      { description: "2x4 acoustic tile", unit: "sq ft", basis: "AREA_SQFT", factor: "1", wastePercent: "5" },
      { description: "Main tee and cross tee", unit: "lin ft", basis: "AREA_SQFT", factor: "1.1" },
      { description: "Wall angle", unit: "lin ft", basis: "PERIMETER_FT", factor: "1", wastePercent: "5" },
      { description: "Hang grid and lay tile", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "FLR1",
    name: "Flooring — underlayment, finish floor and base",
    parts: [
      { description: "Finish flooring", unit: "sq ft", basis: "AREA_SQFT", factor: "1", wastePercent: "10" },
      { description: "Underlayment", unit: "sq ft", basis: "AREA_SQFT", factor: "1", wastePercent: "5" },
      { description: "Base", unit: "lin ft", basis: "PERIMETER_FT", factor: "1", wastePercent: "10" },
      { description: "Install flooring", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "PT1",
    name: "Painting — one prime and two finish coats",
    parts: [
      { description: "Primer", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
      { description: "Finish paint, two coats", unit: "sq ft", basis: "AREA_SQFT", factor: "2" },
      { description: "Prime and paint", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "SLB1",
    name: "Concrete slab on grade — set the item's depth in inches",
    parts: [
      // VOLUME_CY reads the ITEM'S depth: `area × depth ÷ 27`. A slab with no
      // depth produces nothing rather than a guessed four inches, which is
      // the rule this whole codebase follows about numbers nobody supplied.
      { description: "Concrete", unit: "cu yd", basis: "VOLUME_CY", factor: "1", wastePercent: "5", roundUp: true },
      { description: "Welded wire mesh", unit: "sq ft", basis: "AREA_SQFT", factor: "1", wastePercent: "10" },
      { description: "Edge form", unit: "lin ft", basis: "PERIMETER_FT", factor: "1" },
      { description: "Place and finish slab", unit: "sq ft", basis: "AREA_SQFT", factor: "1" },
    ],
  },
  {
    code: "FTG1",
    name: "Concrete footing — set the item's depth in inches",
    parts: [
      { description: "Concrete", unit: "cu yd", basis: "VOLUME_CY", factor: "1", wastePercent: "5", roundUp: true },
      { description: "Form both sides", unit: "sq ft", basis: "LINEAR_FT", factor: "2" },
      { description: "Rebar", unit: "lin ft", basis: "LINEAR_FT", factor: "3" },
      { description: "Place and finish footing", unit: "lin ft", basis: "LINEAR_FT", factor: "1" },
    ],
  },
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
    // NAMES WHAT IS ACTUALLY THERE rather than the two it used to seed. The
    // starter set has ten entries now, and a message naming W1 and W2 would
    // be wrong for anybody who already has an ACT1.
    return {
      ok: false,
      error: `You already have every starter assembly (${STARTER_TYPES.map((type) => type.code).join(", ")}), so nothing was added.`,
    };
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
            create: type.parts.map((component, order) => ({ ...component, sortOrder: order })),
          },
        },
      });
    }
  });

  revalidateLibrary();
  return { ok: true, value: { added: toAdd.map((type) => type.code) } };
}

/**
 * ── THE PARTITION SCHEDULE, TURNED INTO WALL TYPES ──
 *
 * `SCHEDULE_ROWS` has already read the table off the sheet and a person has
 * already looked at the rows on screen. This writes the ones it can into the
 * company's library, WITH A THICKNESS — which is the field that lets a wall
 * measured off a drawing find the assembly that prices it.
 *
 * ── IT SKIPS A CODE YOU ALREADY HAVE, AND NEVER OVERWRITES ONE ──
 *
 * `WallType` is company-scoped and unique on its code, while a partition
 * schedule belongs to ONE job. `A1` on this set is 4⅞in and `A1` on the next
 * job may be 6in, so a code already in the library is a genuine conflict and
 * not a duplicate to be tidied away. Updating it in place would silently
 * re-price every other job that uses it.
 *
 * So a taken code is REPORTED and left alone, the same shape
 * `addStarterWallTypes` takes, and the person edits it themselves if they meant
 * to. The conflict is one sentence; a wrong re-price is a bid.
 *
 * ── NO COMPONENTS, AND THAT IS NOT AN OMISSION ──
 *
 * A schedule says what a wall IS. It does not say what your supplier charges
 * for the board or what your crew hangs in an hour, and a type created with
 * invented components would read as priced while costing nothing real. These
 * arrive with the thickness, the height and the schedule's own words, and the
 * person adds their own parts — the state `addStarterWallTypes` also leaves
 * behind, deliberately.
 */
type ScheduleImport = ActionResultWith<{ added: string[]; taken: string[]; unread: number }>;

export async function addWallTypesFromSchedule(
  jobId: string,
  proposalId: string,
): Promise<ScheduleImport> {
  const context = await requireCompanyContext();
  // ── PRESSED ON A JOB, WRITES THE COMPANY LIBRARY ──
  //
  // `MANAGE_ESTIMATING`, like every other write on /wall-types, and NOT the
  // `VIEW_JOB_COSTS` the takeoff tab withholds on. What this adds is company
  // reference data that outlives the job it was read from, so an accountant
  // who can open the tab is not the person who decides what A1 means.
  //
  // Recorded in `action-capability-guards.test.ts`'s MIXED_DOORS, because that
  // census derives the capability from the PAGE and would otherwise read this
  // as locking out a real person. The button follows the same rule — see
  // `AddWallTypesFromSchedule`, which is not rendered for somebody this would
  // refuse, so nobody meets the refusal by pressing it.
  if (!can(context, "MANAGE_ESTIMATING")) return { ok: false, error: NO_ESTIMATING };
  const companyId = context.company.id;

  // Scoped through the PLAN and the JOB, so a proposal id from another tenant
  // reads as missing rather than as a schedule.
  const proposal = await prisma.planScheduleProposal.findFirst({
    where: { id: proposalId, kind: "PARTITION", plan: { job: { id: jobId, companyId } } },
    select: { rows: true },
  });
  if (proposal === null) return { ok: false, error: NO_SCHEDULE };

  const rows = partitionRowsFromJson(proposal.rows);
  const proposed = wallTypesFromSchedule(rows);
  if (proposed.length === 0) {
    return {
      ok: false,
      error:
        "None of the rows on that schedule gave a wall thickness that could be read, so nothing was added. " +
        "Add the types by hand — the thickness is what lets a measured wall find its price.",
    };
  }

  const taken = new Set(
    (await prisma.wallType.findMany({ where: { companyId }, select: { code: true } })).map((type) =>
      type.code.toUpperCase(),
    ),
  );
  const toAdd = proposed.filter((type) => !taken.has(type.code.toUpperCase()));
  const clashes = proposed.filter((type) => taken.has(type.code.toUpperCase())).map((type) => type.code);
  if (toAdd.length === 0) {
    return { ok: false, error: ALREADY_HAVE(clashes) };
  }

  const sortFrom = await prisma.wallType.count({ where: { companyId } });
  await prisma.$transaction(async (tx) => {
    for (const [index, type] of toAdd.entries()) {
      await tx.wallType.create({
        data: {
          companyId,
          code: type.code,
          name: type.name,
          thicknessIn: type.thicknessIn.toFixed(2),
          defaultHeightFt: type.defaultHeightFt === null ? null : type.defaultHeightFt.toFixed(2),
          sides: 2,
          studSpacingIn: "16",
          sortOrder: sortFrom + index,
          notes: type.notes,
        },
      });
    }
  });

  revalidateLibrary();
  revalidatePath(`/jobs/${jobId}/takeoff`);
  return {
    ok: true,
    value: { added: toAdd.map((type) => type.code), taken: clashes, unread: rows.length - proposed.length },
  };
}

const NO_SCHEDULE = "That partition schedule isn't on this job any more.";

const ALREADY_HAVE = (codes: string[]) =>
  `You already have wall types tagged ${codes.join(", ")}, so nothing was added. A tag means different things on ` +
  `different jobs, so C Stream will not change one you already use — open Wall types and edit them yourself if ` +
  `this set's version is the one you want.`;

/**
 * The stored rows, re-read rather than trusted.
 *
 * `rows` is a `Json` column, so a row written by an older build — or by a
 * reader whose shape has since changed — is not evidence of anything. The same
 * posture `loadScheduleProposals` takes on the way out, and for the same
 * reason: this one feeds a THICKNESS, and a malformed row that slipped through
 * as a string would land in the library as a wall.
 */
function partitionRowsFromJson(raw: unknown): PartitionScheduleRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PartitionScheduleRow[] = [];
  for (const row of raw) {
    if (typeof row !== "object" || row === null) continue;
    const cell = (key: string): string | null => {
      const value = (row as Record<string, unknown>)[key];
      return typeof value === "string" && value.trim() !== "" ? value : null;
    };
    const mark = cell("mark");
    if (mark === null) continue;
    out.push({ mark, description: cell("description"), size: cell("size"), notes: cell("notes") });
  }
  return out;
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
      // ── THE MEASUREMENTS GO BACK TO UNPOSTED, FIRST ──
      //
      // Deleting this run deletes its estimate line. A measurement posted into
      // it would otherwise keep saying "already on the estimate" for a line
      // that no longer exists, and `postMeasuredWallRun` refuses anything
      // already posted — so the estimator is left with a traced wall they
      // cannot price and nothing on the estimate to show for it.
      //
      // Before the delete, because the FK is SetNull: afterwards there is no
      // `wallRunId` left to find them by.
      //
      // `wallRunId: null` is REDUNDANT and kept deliberately: the FK is
      // ON DELETE SET NULL, so Postgres clears it a line later whatever this
      // says. Mutation confirms it — dropping it leaves all twelve tests
      // green, which makes it the one change here no test can see. It stays
      // because the clearing is then stated where it is read rather than
      // inferred from a constraint two files away, and `postedAt` — the half
      // that matters — is asserted either way.
      await tx.takeoffMeasurement.updateMany({
        where: { wallRunId: runId },
        data: { postedAt: null, wallRunId: null },
      });
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
 * Puts back the wall lines a person deleted (typically to reprice them), at
 * today's price book prices. See `restoreRemovedWallLines`.
 */
export async function restoreWallLines(jobId: string): Promise<ActionResultWith<{ restored: number }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return { ok: false, error: JOB_COSTS_ONLY };
  if (!can(context, "MANAGE_ESTIMATING")) return { ok: false, error: NO_ESTIMATING };
  const companyId = context.company.id;
  const gate = await estimateJob(jobId, companyId);
  if (!gate.ok) return gate;
  const { restored } = await prisma.$transaction((tx) => restoreRemovedWallLines(tx, companyId, jobId));
  revalidateJob(jobId);
  return { ok: true, value: { restored } };
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
