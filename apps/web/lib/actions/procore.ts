"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  ProcoreNotConfiguredError,
  ProcoreNotConnectedError,
  ProcoreReconnectError,
} from "@/lib/procore/connection";
import { listLinkableProjects, refreshProcoreLink, type LinkableCompany } from "@/lib/procore/feed";
import { ProcoreApiError, ProcoreForbiddenError } from "@prova/integrations";
import { actionFail, actionOk, isUniqueConstraintError, ownerRefusal, type ActionResult, type ActionResultWith } from "./shared";

/**
 * The Procore card on /settings/integrations: list what can be linked,
 * link a Procore project to a job, unlink, disconnect.
 *
 * GUARDS, all RETURNED (production redacts thrown Server Action messages),
 * every one before anything is read:
 *   1. MANAGE_COMPLIANCE, the capability /settings/integrations demands
 *      (action-capability-guards.test.ts holds page and action to it);
 *   2. owner only, like connecting.
 *
 * NOTHING THE BROWSER SENDS IS TRUSTED ABOUT PROCORE. A link names a
 * Procore company and project by id; the action asks Procore again, with
 * this company's token, whether this login can see that project, and takes
 * the names from Procore's answer rather than from the form. The job id is
 * looked up inside the session's company only.
 *
 * READ-ONLY toward Procore: listing and linking only read. See
 * packages/integrations/src/procore.ts.
 */

const NOT_YOUR_FUNCTION = "Integrations aren't part of your job function. Ask the account owner.";

function explain(error: unknown): string | null {
  if (
    error instanceof ProcoreNotConnectedError ||
    error instanceof ProcoreReconnectError ||
    error instanceof ProcoreNotConfiguredError ||
    error instanceof ProcoreForbiddenError
  ) {
    return error.message;
  }
  if (error instanceof ProcoreApiError) return `Couldn't read from Procore just now. ${error.message}`;
  return null;
}

function field(formData: unknown, key: string): string {
  if (!(formData instanceof FormData)) return "";
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** The Procore companies and projects this company's Procore login can
 * see, for the Link picker. Writes nothing. */
export async function listProcoreProjectsForLinking(): Promise<ActionResultWith<LinkableCompany[]>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return { ok: false, error: NOT_YOUR_FUNCTION };
  const refusal = ownerRefusal(context, "Only the account owner can link Procore projects.");
  if (refusal) return refusal;
  try {
    return { ok: true, value: await listLinkableProjects(context.company.id) };
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return { ok: false, error: sentence };
    throw error;
  }
}

/**
 * Link one Procore project to one of this company's jobs, then read it for
 * the first time. The link is saved even if that first read fails — the
 * status line says why, and Refresh tries again.
 */
export async function linkProcoreProject(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can link Procore projects.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const jobId = field(formData, "jobId");
  const procoreCompanyId = field(formData, "procoreCompanyId");
  const procoreProjectId = field(formData, "procoreProjectId");
  if (!jobId || !procoreCompanyId || !procoreProjectId) return actionFail("Pick a Procore project and a job.");

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, name: true } });
  if (!job) return actionFail("That job isn't in this company.");

  // Ask Procore, not the form, whether this login can see that project.
  let companies: LinkableCompany[];
  try {
    companies = await listLinkableProjects(companyId);
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return actionFail(sentence);
    throw error;
  }
  const procoreCompany = companies.find((c) => c.id === procoreCompanyId);
  const project = procoreCompany?.projects.find((p) => p.id === procoreProjectId);
  if (!procoreCompany || !project) {
    return actionFail("Your Procore login can't see that project any more. Reload this page and pick again.");
  }

  const taken = await prisma.procoreProjectLink.findFirst({
    where: { companyId, OR: [{ jobId: job.id }, { procoreProjectId: project.id }] },
    select: { jobId: true, procoreProjectId: true },
  });
  if (taken?.jobId === job.id) return actionFail(`${job.name} already has a Procore project. Unlink it first.`);
  if (taken) return actionFail(`${project.name} is already linked to another job. Unlink it there first.`);

  let linkId: string;
  try {
    const link = await prisma.procoreProjectLink.create({
      data: {
        companyId,
        jobId: job.id,
        procoreCompanyId: procoreCompany.id,
        procoreCompanyName: procoreCompany.name,
        procoreProjectId: project.id,
        procoreProjectName: project.name,
        linkedByUserId: context.id,
      },
      select: { id: true },
    });
    linkId = link.id;
  } catch (error) {
    // Two presses racing past the check above onto the unique indexes.
    if (isUniqueConstraintError(error)) return actionFail("That link was just made. Reload the page.");
    throw error;
  }

  try {
    await refreshProcoreLink(companyId, linkId);
  } catch (error) {
    // The link stands; the first read is retried by Refresh or on open.
    const sentence = explain(error);
    if (!sentence) throw error;
    await prisma.procoreProjectLink.updateMany({
      where: { id: linkId, companyId },
      data: { lastRefreshedAt: new Date(), lastRefreshStatus: "FAILURE", lastRefreshMessage: sentence },
    });
  }

  revalidatePath("/settings/integrations");
  revalidatePath("/rfis");
  revalidatePath("/submittals");
  revalidatePath("/drawings");
  return actionOk;
}

/** Remove a link and its cached GC records. Nothing in Procore changes,
 * and none of this company's own RFIs, submittals or drawings are touched
 * — the cache is the only thing deleted. */
export async function unlinkProcoreProject(linkId: unknown): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can unlink a Procore project.");
  if (refusal) return refusal;
  if (typeof linkId !== "string" || !linkId) return actionFail("Which link?");

  const removed = await prisma.procoreProjectLink.deleteMany({ where: { id: linkId, companyId: context.company.id } });
  if (removed.count === 0) return actionFail("That link is already gone.");

  revalidatePath("/settings/integrations");
  revalidatePath("/rfis");
  revalidatePath("/submittals");
  revalidatePath("/drawings");
  return actionOk;
}

/**
 * Forget the credential. Links and what was last read stay (clearly dated),
 * but nothing refreshes until someone reconnects. No call is made to
 * Procore; the owner removes the grant there if they want it gone.
 */
export async function disconnectProcore(): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can disconnect an integration.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const existing = await prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "PROCORE" } },
    select: { id: true },
  });
  if (!existing) return actionFail("Procore is not connected.");

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
        message: "Disconnected from Procore. Linked projects keep what was last read, and stop refreshing.",
        occurredAt: now,
      },
    });
  });

  revalidatePath("/settings/integrations");
  return actionOk;
}
