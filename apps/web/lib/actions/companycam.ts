"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  CompanyCamNotConfiguredError,
  CompanyCamNotConnectedError,
  CompanyCamReconnectError,
} from "@/lib/companycam/connection";
import {
  listLinkableCompanyCamProjects,
  runCompanyCamImport,
  type CompanyCamImportSummary,
} from "@/lib/companycam/import";
import { CompanyCamApiError, type CompanyCamProject } from "@prova/integrations";
import {
  actionFail,
  actionOk,
  isUniqueConstraintError,
  ownerRefusal,
  type ActionResult,
  type ActionResultWith,
} from "./shared";

/**
 * The CompanyCam card on /settings/integrations: list what can be linked,
 * link a CompanyCam project to a job, import its photos, unlink,
 * disconnect.
 *
 * GUARDS, all RETURNED (production redacts thrown Server Action
 * messages), every one before anything is read:
 *   1. MANAGE_COMPLIANCE, the capability /settings/integrations demands
 *      (action-capability-guards.test.ts holds page and action to it);
 *   2. owner only, like connecting.
 *
 * NOTHING THE BROWSER SENDS IS TRUSTED ABOUT COMPANYCAM. A link names a
 * CompanyCam project by id; the action asks CompanyCam again, with this
 * company's token, whether this account can see that project, and takes
 * the name from CompanyCam's answer rather than from the form. The job id
 * is looked up inside the session's company only.
 *
 * READ-ONLY toward CompanyCam: listing, linking and importing only read.
 * See packages/integrations/src/companycam.ts.
 */

const NOT_YOUR_FUNCTION = "Integrations aren't part of your job function. Ask the account owner.";

function explain(error: unknown): string | null {
  if (
    error instanceof CompanyCamNotConnectedError ||
    error instanceof CompanyCamReconnectError ||
    error instanceof CompanyCamNotConfiguredError
  ) {
    return error.message;
  }
  if (error instanceof CompanyCamApiError) return `Couldn't read from CompanyCam just now. ${error.message}`;
  return null;
}

function field(formData: unknown, key: string): string {
  if (!(formData instanceof FormData)) return "";
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Named rather than inlined into the signature below on purpose —
 * lib/action-capability-guards.test.ts's `bodyOfAction` finds an action's
 * body by walking braces from the FIRST `{` after its name, and an inline
 * object type in the return annotation would end the "body" before the
 * guard (see ask.ts's `AssistantConnectionResult` for the same fix). */
type CompanyCamPickerResult = { projects: CompanyCamProject[]; truncated: boolean };

/** The CompanyCam projects this company's account can see, for the Link
 * picker. Writes nothing. */
export async function listCompanyCamProjectsForLinking(): Promise<ActionResultWith<CompanyCamPickerResult>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return { ok: false, error: NOT_YOUR_FUNCTION };
  const refusal = ownerRefusal(context, "Only the account owner can link CompanyCam projects.");
  if (refusal) return refusal;
  try {
    return { ok: true, value: await listLinkableCompanyCamProjects(context.company.id) };
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return { ok: false, error: sentence };
    throw error;
  }
}

/** Link one CompanyCam project to one of this company's jobs. Importing
 * is a separate press, so linking never surprises anyone with a long
 * download. */
export async function linkCompanyCamProject(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can link CompanyCam projects.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const jobId = field(formData, "jobId");
  const companycamProjectId = field(formData, "companycamProjectId");
  if (!jobId || !companycamProjectId) return actionFail("Pick a CompanyCam project and a job.");

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, name: true } });
  if (!job) return actionFail("That job isn't in this company.");

  // Ask CompanyCam, not the form, whether this account can see that
  // project.
  let projects: CompanyCamProject[];
  try {
    projects = (await listLinkableCompanyCamProjects(companyId)).projects;
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return actionFail(sentence);
    throw error;
  }
  const project = projects.find((p) => p.id === companycamProjectId);
  if (!project) {
    return actionFail("Your CompanyCam account can't see that project any more. Reload this page and pick again.");
  }

  const taken = await prisma.companyCamProjectLink.findFirst({
    where: { companyId, OR: [{ jobId: job.id }, { companycamProjectId: project.id }] },
    select: { jobId: true, companycamProjectId: true },
  });
  if (taken?.jobId === job.id) return actionFail(`${job.name} already has a CompanyCam project. Unlink it first.`);
  if (taken) return actionFail(`${project.name} is already linked to another job. Unlink it there first.`);

  try {
    await prisma.companyCamProjectLink.create({
      data: {
        companyId,
        jobId: job.id,
        companycamProjectId: project.id,
        companycamProjectName: project.name,
        linkedByUserId: context.id,
      },
    });
  } catch (error) {
    // Two presses racing past the check above onto the unique indexes.
    if (isUniqueConstraintError(error)) return actionFail("That link was just made. Reload the page.");
    throw error;
  }

  revalidatePath("/settings/integrations");
  return actionOk;
}

/**
 * One press of "Import photos": up to a batch of NEW photos from the
 * linked project into the job's gallery. Returns the summary so the card
 * can say exactly what happened — including "more remain".
 */
export async function importCompanyCamPhotos(linkId: unknown): Promise<ActionResultWith<CompanyCamImportSummary>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return { ok: false, error: NOT_YOUR_FUNCTION };
  const refusal = ownerRefusal(context, "Only the account owner can import CompanyCam photos.");
  if (refusal) return refusal;
  if (typeof linkId !== "string" || !linkId) return { ok: false, error: "Which link?" };

  const link = await prisma.companyCamProjectLink.findFirst({
    where: { id: linkId, companyId: context.company.id },
    select: { id: true, jobId: true },
  });
  if (!link) return { ok: false, error: "That link is gone. Reload the page." };

  let summary: CompanyCamImportSummary;
  try {
    summary = await runCompanyCamImport(context.company.id, link.id);
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return { ok: false, error: sentence };
    throw error;
  }

  revalidatePath("/settings/integrations");
  revalidatePath("/photos");
  revalidatePath(`/jobs/${link.jobId}`);
  return { ok: true, value: summary };
}

/** Remove a link. Nothing in CompanyCam changes, and the photos already
 * imported STAY — they are the job's own records now, not a cache. */
export async function unlinkCompanyCamProject(linkId: unknown): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can unlink a CompanyCam project.");
  if (refusal) return refusal;
  if (typeof linkId !== "string" || !linkId) return actionFail("Which link?");

  const removed = await prisma.companyCamProjectLink.deleteMany({
    where: { id: linkId, companyId: context.company.id },
  });
  if (removed.count === 0) return actionFail("That link is already gone.");

  revalidatePath("/settings/integrations");
  return actionOk;
}

/**
 * Forget the credential. Links and imported photos stay, but nothing can
 * be imported until someone reconnects. No call is made to CompanyCam;
 * the owner removes the grant there if they want it gone.
 */
export async function disconnectCompanyCam(): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can disconnect an integration.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const existing = await prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "COMPANYCAM" } },
    select: { id: true },
  });
  if (!existing) return actionFail("CompanyCam is not connected.");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.integrationConnection.update({
      where: { id: existing.id },
      data: {
        status: "NOT_CONNECTED",
        disconnectedAt: now,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        scopes: [],
      },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId: existing.id,
        direction: "PULL",
        status: "SUCCESS",
        message: "Disconnected from CompanyCam. Imported photos stay on their jobs; nothing new can be imported.",
        occurredAt: now,
      },
    });
  });

  revalidatePath("/settings/integrations");
  return actionOk;
}
