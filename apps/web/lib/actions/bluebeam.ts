"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { BluebeamNotConfiguredError, BluebeamNotConnectedError, BluebeamReconnectError } from "@/lib/bluebeam/connection";
import { linkJobToBluebeamStudio, pushDocumentToBluebeamSession, refreshBluebeamStudioSession } from "@/lib/bluebeam/session";
import { BluebeamApiError } from "@prova/integrations";
import { actionFail, actionOk, isUniqueConstraintError, ownerRefusal, type ActionResult } from "./shared";

/**
 * The Bluebeam card on /settings/integrations: link a job to a new Studio
 * Session, push a PDF into it, refresh its markup status, unlink,
 * disconnect. Same shape as lib/actions/companycam.ts, and for the same
 * reasons — see that file's own comments for the fuller version.
 *
 * GUARDS, all RETURNED (production redacts thrown Server Action
 * messages), every one before anything is read:
 *   1. MANAGE_COMPLIANCE, the capability /settings/integrations demands;
 *   2. owner only, like every other integration control on that page.
 *
 * NOTHING BLUEBEAM SENDS IS TRUSTED BLINDLY: the job id in every form
 * comes from this company's own job list, checked with `companyId` on
 * every read.
 */

const NOT_YOUR_FUNCTION = "Integrations aren't part of your job function. Ask the account owner.";

function explain(error: unknown): string | null {
  if (error instanceof BluebeamNotConnectedError || error instanceof BluebeamReconnectError || error instanceof BluebeamNotConfiguredError) {
    return error.message;
  }
  if (error instanceof BluebeamApiError) return `Couldn't reach Bluebeam just now. ${error.message}`;
  if (error instanceof Error && /^This job (already has|has no)/.test(error.message)) return error.message;
  if (error instanceof Error && error.message === "That file isn't a PDF.") return error.message;
  if (error instanceof Error && error.message.startsWith("That file is empty or too large")) return error.message;
  return null;
}

function field(formData: unknown, key: string): string {
  if (!(formData instanceof FormData)) return "";
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Create a new Studio Session for a job and link it. One session per
 * job — there is no "pick an existing session" step, because Bluebeam's
 * API creates sessions rather than listing ones a company already has. */
export async function linkJobToBluebeam(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can link a job to Bluebeam Studio.");
  if (refusal) return refusal;

  const jobId = field(formData, "jobId");
  if (!jobId) return actionFail("Pick a job.");

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: context.company.id }, select: { id: true, name: true } });
  if (!job) return actionFail("That job isn't in this company.");

  try {
    await linkJobToBluebeamStudio(context.company.id, job.id, job.name, context.id);
  } catch (error) {
    if (isUniqueConstraintError(error)) return actionFail("That job was just linked. Reload the page.");
    const sentence = explain(error);
    if (sentence) return actionFail(sentence);
    throw error;
  }

  revalidatePath("/settings/integrations");
  return actionOk;
}

/** Push one local PDF into the job's linked Studio Session. Nothing about
 * the file is stored in C Stream — see lib/bluebeam/session.ts. */
export async function pushBluebeamDocument(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can push a document to Bluebeam.");
  if (refusal) return refusal;

  const jobId = field(formData, "jobId");
  if (!jobId) return actionFail("Which job?");
  const file = formData instanceof FormData ? formData.get("file") : null;
  if (!(file instanceof File) || file.size === 0) return actionFail("Choose a PDF to send.");

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: context.company.id }, select: { id: true } });
  if (!job) return actionFail("That job isn't in this company.");

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return actionFail("Couldn't read that file. Try again.");
  }

  try {
    await pushDocumentToBluebeamSession(context.company.id, job.id, { name: file.name || "document.pdf", bytes, contentType: "application/pdf" });
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return actionFail(sentence);
    throw error;
  }

  revalidatePath("/settings/integrations");
  return actionOk;
}

/** Pull the session's file count and markup status summary. Read-only. */
export async function refreshBluebeamSessionAction(jobId: unknown): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can refresh a Bluebeam session.");
  if (refusal) return refusal;
  if (typeof jobId !== "string" || !jobId) return actionFail("Which job?");

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: context.company.id }, select: { id: true } });
  if (!job) return actionFail("That job isn't in this company.");

  try {
    await refreshBluebeamStudioSession(context.company.id, job.id);
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return actionFail(sentence);
    throw error;
  }

  revalidatePath("/settings/integrations");
  return actionOk;
}

/** Remove a job's link. Nothing in Bluebeam changes — the Studio Session
 * stays exactly as it was, the owner can still open it directly. */
export async function unlinkBluebeamSession(linkId: unknown): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can unlink a Bluebeam session.");
  if (refusal) return refusal;
  if (typeof linkId !== "string" || !linkId) return actionFail("Which link?");

  const removed = await prisma.bluebeamStudioSession.deleteMany({ where: { id: linkId, companyId: context.company.id } });
  if (removed.count === 0) return actionFail("That link is already gone.");

  revalidatePath("/settings/integrations");
  return actionOk;
}

/** Forget the credential. Links stay, but nothing can be pushed or
 * refreshed until someone reconnects. No call is made to Bluebeam; the
 * owner removes the grant there if they want it gone. */
export async function disconnectBluebeam(): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can disconnect an integration.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const existing = await prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "BLUEBEAM" } },
    select: { id: true },
  });
  if (!existing) return actionFail("Bluebeam is not connected.");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.integrationConnection.update({
      where: { id: existing.id },
      data: { status: "NOT_CONNECTED", disconnectedAt: now, encryptedAccessToken: null, encryptedRefreshToken: null, scopes: [] },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId: existing.id,
        direction: "PUSH",
        status: "SUCCESS",
        message: "Disconnected from Bluebeam. Linked jobs stay linked; nothing new can be pushed or refreshed.",
        occurredAt: now,
      },
    });
  });

  revalidatePath("/settings/integrations");
  return actionOk;
}
