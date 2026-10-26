"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseGcAdjustment } from "@/lib/estimating/gc-price";
import {
  mergeBidProjects,
  saveInvitationPriceAdjustment as saveAdjustmentCore,
  recordPrimeAward as recordPrimeAwardCore,
  saveBidProjectDetails,
  splitBidInvitation,
  startEstimateFromProject as startEstimateCore,
} from "@/lib/estimating/bid-project";
import { actionFail, actionOk, type ActionResult } from "./shared";

/**
 * Bid projects: one piece of work, many GC invitations, one estimate.
 *
 * MANAGE_ESTIMATING, the gate /bids itself withholds on and every other
 * bid-desk action in estimating.ts checks. The writes are
 * lib/estimating/bid-project.ts; this file is the parse, permission and
 * revalidate layer, so each action RETURNS its refusal (production redacts a
 * thrown Server Action message to a digest).
 *
 * Nothing here is owner-only: merging, splitting and recording an award are
 * the estimator's ordinary bookkeeping on their own bids, and none of it
 * deletes evidence — an invitation, its send record and its outcome all
 * survive a merge or a split untouched. (`ownerRefusal` is for destructive
 * actions; if one is ever added here it belongs on that.)
 */

const ESTIMATING_ONLY =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** A date input's YYYY-MM-DD at UTC midnight, or null when blank. A string
 * that is not a date is a refusal, not a silent null. */
function dateOrNull(formData: FormData, key: string): Date | null | "invalid" {
  const raw = text(formData, key);
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(raw) ? "invalid" : parsed;
}

function revalidateBids(): void {
  revalidatePath("/bids");
  revalidatePath("/pipeline");
}

/**
 * "This is the same job as…": folds `bidProjectId` (the project the invitation
 * is on) into the project picked in the form. All of its invitations move.
 */
export async function mergeIntoProject(bidProjectId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);

  const intoId = text(formData, "intoProjectId");
  if (!intoId) return actionFail("Pick the project this is the same job as.", { intoProjectId: "Pick a project." });

  const merged = await mergeBidProjects(context.company.id, bidProjectId, intoId);
  if (!merged.ok) return actionFail(merged.error);
  revalidateBids();
  return actionOk;
}

/** "Not the same job": gives the invitation a project of its own again. */
export async function splitFromProject(bidInvitationId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);

  const split = await splitBidInvitation(context.company.id, bidInvitationId);
  if (!split.ok) return actionFail(split.error);
  revalidateBids();
  return actionOk;
}

/**
 * Starts the project's one estimate, pre-filled, and opens it. On success this
 * REDIRECTS (into the bid stepper's pricing step, as `createJob` does), which
 * never returns; a refusal comes back as a sentence.
 */
export async function startEstimateFromProject(bidProjectId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);

  const started = await startEstimateCore(context.company.id, bidProjectId);
  if (!started.ok) return actionFail(started.error);

  revalidateBids();
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  redirect(`/jobs/new/${started.value.jobId}/items`);
}

/** Names the winner of the PRIME contract (an entered fact), or clears it. */
export async function recordPrimeAward(bidProjectId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);

  const awardedOn = dateOrNull(formData, "awardedOn");
  if (awardedOn === "invalid") return actionFail("That date isn't valid.", { awardedOn: "That date isn't valid." });

  const awarded = await recordPrimeAwardCore(context.company.id, bidProjectId, {
    contactId: text(formData, "contactId") || null,
    name: text(formData, "name") || null,
    awardedOn,
  });
  if (!awarded.ok) return actionFail(awarded.error);
  revalidateBids();
  revalidatePath("/jobs");
  return actionOk;
}

/**
 * What this GC is quoted, as a difference from the project's one estimate: a
 * dollar amount or a percent (signed; minus is a discount) and a short reason,
 * or "no adjustment" to clear it. The price is never stored — see
 * `lib/estimating/gc-price.ts`.
 */
export async function saveGcPriceAdjustment(bidInvitationId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);

  const parsed = parseGcAdjustment({
    kind: text(formData, "kind"),
    value: text(formData, "value"),
    reason: text(formData, "reason"),
  });
  if (!parsed.ok) return actionFail(parsed.error, { [parsed.field]: parsed.error });

  const saved = await saveAdjustmentCore(context.company.id, bidInvitationId, parsed);
  if (!saved.ok) return actionFail(saved.error);
  revalidateBids();
  return actionOk;
}

/** Edits the project's name, location, owner, architect and bid date. */
export async function saveBidProject(bidProjectId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(ESTIMATING_ONLY);

  const bidDueDate = dateOrNull(formData, "bidDueDate");
  if (bidDueDate === "invalid") return actionFail("That date isn't valid.", { bidDueDate: "That date isn't valid." });
  const name = text(formData, "name");
  if (!name) return actionFail("Give the project a name.", { name: "Give the project a name." });

  const saved = await saveBidProjectDetails(context.company.id, bidProjectId, {
    name,
    siteAddress: text(formData, "siteAddress"),
    siteCity: text(formData, "siteCity"),
    owner: text(formData, "owner"),
    architect: text(formData, "architect"),
    bidDueDate,
  });
  if (!saved.ok) return actionFail(saved.error);
  revalidateBids();
  return actionOk;
}
