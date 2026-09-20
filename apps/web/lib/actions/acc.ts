"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { AccNotConfiguredError, AccNotConnectedError, AccReconnectError } from "@/lib/acc/connection";
import { listLinkableAccProjects, refreshAccLink, type LinkableAccount } from "@/lib/acc/feed";
import { AccApiError, AccForbiddenError } from "@prova/integrations";
import { actionFail, actionOk, isUniqueConstraintError, ownerRefusal, type ActionResult, type ActionResultWith } from "./shared";

/**
 * The ACC card on /settings/integrations: list what can be linked, link an
 * ACC project to a job, unlink, disconnect. Same shape as
 * lib/actions/procore.ts — read that file's header first.
 *
 * GUARDS, all RETURNED (production redacts thrown Server Action messages),
 * every one before anything is read:
 *   1. MANAGE_COMPLIANCE, the capability /settings/integrations demands
 *      (action-capability-guards.test.ts holds page and action to it);
 *   2. owner only, like connecting.
 *
 * NOTHING THE BROWSER SENDS IS TRUSTED ABOUT ACC. A link names an ACC
 * account and project by id; the action asks Autodesk again, with this
 * company's token, whether this login can see that project, and takes the
 * names from Autodesk's answer rather than from the form. The job id is
 * looked up inside the session's company only.
 *
 * READ-ONLY toward ACC: listing and linking only read. See
 * packages/integrations/src/acc.ts.
 */

const NOT_YOUR_FUNCTION = "Integrations aren't part of your job function. Ask the account owner.";

function explain(error: unknown): string | null {
  if (
    error instanceof AccNotConnectedError ||
    error instanceof AccReconnectError ||
    error instanceof AccNotConfiguredError ||
    error instanceof AccForbiddenError
  ) {
    return error.message;
  }
  if (error instanceof AccApiError) return `Couldn't read from Autodesk Construction Cloud just now. ${error.message}`;
  return null;
}

function field(formData: unknown, key: string): string {
  if (!(formData instanceof FormData)) return "";
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** The ACC accounts and projects this company's ACC login can see, for the
 * Link picker. Writes nothing. */
export async function listAccProjectsForLinking(): Promise<ActionResultWith<LinkableAccount[]>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return { ok: false, error: NOT_YOUR_FUNCTION };
  const refusal = ownerRefusal(context, "Only the account owner can link Autodesk Construction Cloud projects.");
  if (refusal) return refusal;
  try {
    return { ok: true, value: await listLinkableAccProjects(context.company.id) };
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return { ok: false, error: sentence };
    throw error;
  }
}

/**
 * Link one ACC project to one of this company's jobs, then read it for the
 * first time. The link is saved even if that first read fails — the status
 * line says why, and Refresh tries again.
 */
export async function linkAccProject(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can link Autodesk Construction Cloud projects.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const jobId = field(formData, "jobId");
  const accAccountId = field(formData, "accAccountId");
  const accProjectId = field(formData, "accProjectId");
  if (!jobId || !accAccountId || !accProjectId) return actionFail("Pick an ACC project and a job.");

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { id: true, name: true } });
  if (!job) return actionFail("That job isn't in this company.");

  // Ask Autodesk, not the form, whether this login can see that project.
  let accounts: LinkableAccount[];
  try {
    accounts = await listLinkableAccProjects(companyId);
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return actionFail(sentence);
    throw error;
  }
  const account = accounts.find((a) => a.id === accAccountId);
  const project = account?.projects.find((p) => p.id === accProjectId);
  if (!account || !project) {
    return actionFail("Your ACC login can't see that project any more. Reload this page and pick again.");
  }

  const taken = await prisma.accProjectLink.findFirst({
    where: { companyId, OR: [{ jobId: job.id }, { accProjectId: project.id }] },
    select: { jobId: true, accProjectId: true },
  });
  if (taken?.jobId === job.id) return actionFail(`${job.name} already has an ACC project. Unlink it first.`);
  if (taken) return actionFail(`${project.name} is already linked to another job. Unlink it there first.`);

  let linkId: string;
  try {
    const link = await prisma.accProjectLink.create({
      data: {
        companyId,
        jobId: job.id,
        accAccountId: account.id,
        accAccountName: account.name,
        accProjectId: project.id,
        accProjectName: project.name,
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
    await refreshAccLink(companyId, linkId);
  } catch (error) {
    // The link stands; the first read is retried by Refresh or on open.
    const sentence = explain(error);
    if (!sentence) throw error;
    await prisma.accProjectLink.updateMany({
      where: { id: linkId, companyId },
      data: { lastRefreshedAt: new Date(), lastRefreshStatus: "FAILURE", lastRefreshMessage: sentence },
    });
  }

  revalidatePath("/settings/integrations");
  revalidatePath("/rfis");
  revalidatePath("/submittals");
  return actionOk;
}

/** Remove a link and its cached GC records. Nothing in ACC changes, and
 * none of this company's own RFIs or submittals are touched — the cache is
 * the only thing deleted. */
export async function unlinkAccProject(linkId: unknown): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can unlink an ACC project.");
  if (refusal) return refusal;
  if (typeof linkId !== "string" || !linkId) return actionFail("Which link?");

  const removed = await prisma.accProjectLink.deleteMany({ where: { id: linkId, companyId: context.company.id } });
  if (removed.count === 0) return actionFail("That link is already gone.");

  revalidatePath("/settings/integrations");
  revalidatePath("/rfis");
  revalidatePath("/submittals");
  return actionOk;
}

/**
 * Forget the credential. Links and what was last read stay (clearly dated),
 * but nothing refreshes until someone reconnects. No call is made to
 * Autodesk; the owner removes the grant there if they want it gone.
 */
export async function disconnectAcc(): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can disconnect an integration.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const existing = await prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "ACC" } },
    select: { id: true },
  });
  if (!existing) return actionFail("Autodesk Construction Cloud is not connected.");

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
        message: "Disconnected from Autodesk Construction Cloud. Linked projects keep what was last read, and stop refreshing.",
        occurredAt: now,
      },
    });
  });

  revalidatePath("/settings/integrations");
  return actionOk;
}
