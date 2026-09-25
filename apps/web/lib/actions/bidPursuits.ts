"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { Benchmark } from "@/lib/conceptual-estimate";
import { loadConceptualBenchmark } from "@/lib/conceptual-estimate-query";
import {
  actionFail as fail,
  actionOk as ok,
  isUniqueConstraintError,
  ownerRefusal,
  type ActionResult,
  type ActionResultWith,
} from "./shared";
import {
  BidPursuitInputError,
  optionalDateFromString,
  optionalValueFromString,
  stageFromString,
  type BidPursuitStage,
} from "@/lib/bid-pursuits";

/**
 * Writing the company's own pre-bid pipeline — BidPursuit.
 *
 * MANAGE_ESTIMATING, the same gate as /pipeline where these rows are shown
 * and as the `bid_pursuits` Ask tool that reads them. Chasing work before it
 * is bid is an estimator's job.
 *
 * Every action RETURNS its failure rather than throwing: production redacts
 * a thrown Server Action message, and "that invitation is already linked to
 * another pursuit" is a sentence somebody needs to read.
 *
 * NOTHING HERE TOUCHES SalesLead / SalesOpportunity. Those are Prova's own
 * CRM, on the operator company only. See pursuits.prisma.
 */

const NO_PERMISSION =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";
const NOT_FOUND = "That pursuit is no longer on your list.";
const LINKED_STAGE =
  "This pursuit is linked to a logged bid invitation, so it is INVITED. Unlink the invitation first if the invite did not really come from this pursuit.";

/**
 * Why a guarded write matched nothing: the row is gone, or it was linked
 * between our read and our write. Re-read only on the failure path, so the
 * happy path stays one read and one write.
 */
async function whyNothingMatched(id: string, companyId: string): Promise<ActionResult> {
  const now = await prisma.bidPursuit.findFirst({ where: { id, companyId }, select: { bidInvitationId: true } });
  return fail(now?.bidInvitationId ? LINKED_STAGE : NOT_FOUND);
}

/**
 * The WHERE for a write that sets `stage`. The read-then-check above each
 * caller catches the ordinary case with a clear sentence; this closes the
 * window between that read and the write. When the new stage is not
 * INVITED, the write only matches a row that is STILL unlinked — so a
 * link somebody else saved a moment ago makes it match nothing, instead of
 * leaving a pursuit linked to an invitation but not INVITED.
 */
function stageWriteWhere(id: string, companyId: string, stage: BidPursuitStage) {
  return stage === "INVITED" ? { id, companyId } : { id, companyId, bidInvitationId: null };
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function optionalText(formData: FormData, key: string): string | null {
  return text(formData, key) || null;
}

/** The fields the create and edit forms share (`BidPursuitFields`). Throws
 * BidPursuitInputError for anything a person typed wrong; callers turn that
 * into a returned failure. */
function fieldsFrom(formData: FormData) {
  const projectName = text(formData, "projectName");
  if (!projectName) throw new BidPursuitInputError("Give the project a name.");
  return {
    projectName,
    owner: optionalText(formData, "owner"),
    architect: optionalText(formData, "architect"),
    expectedGcs: optionalText(formData, "expectedGcs"),
    // ENTERED, never stamped: somebody's estimate of a future date.
    expectedBidDate: optionalDateFromString(formData.get("expectedBidDate")),
    estimatedValue: optionalValueFromString(formData.get("estimatedValue")),
    stage: stageFromString(formData.get("stage") || "WATCHING"),
    note: optionalText(formData, "note"),
  };
}

export async function createBidPursuit(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;

  let fields: ReturnType<typeof fieldsFrom>;
  try {
    fields = fieldsFrom(formData);
  } catch (err) {
    if (err instanceof BidPursuitInputError) return fail(err.message);
    throw err;
  }

  await prisma.bidPursuit.create({
    data: { ...fields, companyId: company.id, createdByUserId: context.id },
  });

  revalidatePath("/pipeline");
  return ok;
}

export async function updateBidPursuit(id: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;

  let fields: ReturnType<typeof fieldsFrom>;
  try {
    fields = fieldsFrom(formData);
  } catch (err) {
    if (err instanceof BidPursuitInputError) return fail(err.message);
    throw err;
  }

  const existing = await prisma.bidPursuit.findFirst({
    where: { id, companyId: company.id },
    select: { bidInvitationId: true },
  });
  if (!existing) return fail(NOT_FOUND);
  if (existing.bidInvitationId && fields.stage !== "INVITED") return fail(LINKED_STAGE);

  // Scoped in the WHERE, so a row belonging to another company never matches.
  const updated = await prisma.bidPursuit.updateMany({
    where: stageWriteWhere(id, company.id, fields.stage),
    data: fields,
  });
  if (updated.count === 0) return whyNothingMatched(id, company.id);

  revalidatePath("/pipeline");
  return ok;
}

export async function setBidPursuitStage(id: string, stage: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;

  let next: BidPursuitStage;
  try {
    next = stageFromString(stage);
  } catch (err) {
    if (err instanceof BidPursuitInputError) return fail(err.message);
    throw err;
  }

  const existing = await prisma.bidPursuit.findFirst({
    where: { id, companyId: company.id },
    select: { bidInvitationId: true },
  });
  if (!existing) return fail(NOT_FOUND);
  // A link to a logged invitation IS the statement that the invite arrived.
  // Letting the stage say otherwise would store two facts that disagree.
  if (existing.bidInvitationId && next !== "INVITED") return fail(LINKED_STAGE);

  const updated = await prisma.bidPursuit.updateMany({
    where: stageWriteWhere(id, company.id, next),
    data: { stage: next },
  });
  // Deleted, or linked, since the read above — never a silent ok.
  if (updated.count === 0) return whyNothingMatched(id, company.id);

  revalidatePath("/pipeline");
  return ok;
}

/**
 * Link a pursuit to the BidInvitation it became — or, with an empty id,
 * unlink it.
 *
 * Linking moves the stage to INVITED in the same write, because linking IS
 * somebody saying the invite arrived. Unlinking leaves the stage alone: an
 * invite can have arrived by phone without being logged, which is exactly
 * what INVITED-with-no-link means.
 */
export async function linkBidPursuitToInvitation(id: string, bidInvitationId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;

  const pursuit = await prisma.bidPursuit.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
  if (!pursuit) return fail(NOT_FOUND);

  const invitationId = String(bidInvitationId ?? "").trim();
  if (!invitationId) {
    const unlinked = await prisma.bidPursuit.updateMany({
      where: { id, companyId: company.id },
      data: { bidInvitationId: null },
    });
    // Deleted since the read above: say so rather than report an unlink of
    // nothing as done.
    if (unlinked.count === 0) return fail(NOT_FOUND);
    revalidatePath("/pipeline");
    return ok;
  }

  // Re-read through THIS company rather than trusted from the form. A forged
  // id finds nothing and is refused in the same words as a stale one — no
  // "that belongs to someone else" branch, which would be an existence oracle.
  const invitation = await prisma.bidInvitation.findFirst({
    where: { id: invitationId, companyId: company.id },
    select: { id: true },
  });
  if (!invitation) return fail("That bid invitation is not on your account.");

  let linked: { count: number };
  try {
    linked = await prisma.bidPursuit.updateMany({
      where: { id, companyId: company.id },
      data: { bidInvitationId: invitationId, stage: "INVITED" },
    });
  } catch (err) {
    // BY CODE, NOT BY `instanceof` — the instanceof form is false at runtime
    // in this app (shared.ts, measured 2026-08-28; it cost #304 a click test).
    if (isUniqueConstraintError(err)) {
      return fail("That invitation is already linked to another pursuit. One invitation comes from one pursuit.");
    }
    throw err;
  }
  if (linked.count === 0) return fail(NOT_FOUND);

  revalidatePath("/pipeline");
  return ok;
}

/** Owner-only, like every destructive action on a list page. A pursuit is
 * not an evidence record, but it is somebody's months of chasing. */
export async function deleteBidPursuit(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NO_PERMISSION);
  const { company } = context;
  const refusal = ownerRefusal(context, "Only the account owner can delete a pursuit. Mark it Dropped instead.");
  if (refusal) return refusal;

  const removed = await prisma.bidPursuit.deleteMany({ where: { id, companyId: company.id } });
  if (removed.count === 0) return fail(NOT_FOUND);

  revalidatePath("/pipeline");
  return ok;
}

/**
 * What this company's finished work ran at, per square foot — ON DEMAND.
 *
 * A READ, not a write, and deliberately an action rather than a page loader.
 * `pipelineQueryCensus.test.ts` exists because saving on /pipeline re-renders
 * the route from the root, so anything in that page's load path runs again on
 * every save. This benchmark reads up to 200 finished jobs with their line
 * items, cost entries, invoices and time entries — far too much to spend on
 * every render for a calculator most people will never open.
 *
 * So it is fetched when somebody opens the calculator and not before. The
 * census caught this: the first version of it was a fourth loader on that
 * page.
 *
 * Returns the benchmark itself rather than a sentence. Its SHAPE is what
 * makes a range un-printable when it does not exist — nulls, not zeros — and
 * flattening it to a string here would throw that away.
 */
export async function conceptualBenchmark(): Promise<ActionResultWith<Benchmark>> {
  const context = await requireCompanyContext();
  // BOTH capabilities, and the guard census is why the first version had only
  // one of them.
  //
  // MANAGE_ESTIMATING because this sits behind /pipeline, which withholds on
  // it — an action looser than the page it lives on answers people who cannot
  // open that page at all. AND VIEW_JOB_COSTS because the figures ARE job
  // costs: somebody who can see the pipeline but not job money must not learn
  // what finished work cost by way of a calculator.
  //
  // Checked before any prisma call, in that order, because the census asserts
  // the page's own capability is what refuses first.
  if (!can(context, "MANAGE_ESTIMATING")) {
    return {
      ok: false,
      error: "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.",
    };
  }
  if (!can(context, "VIEW_JOB_COSTS")) {
    return {
      ok: false,
      error: "Job costs aren't part of your job function. The account owner sets who sees what, on the Team page.",
    };
  }
  return { ok: true, value: await loadConceptualBenchmark(context.company.id) };
}
