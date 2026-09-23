"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { JobberApiError } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { IMPORT_COLLIDED, IMPORT_TX_OPTIONS, isWriteConflict } from "@/lib/import-shared";
import { dateFromDay } from "@/lib/spreadsheet-import";
import { jobberSummarySentence, planJobberImport, type JobberPlan } from "@/lib/jobber-import";
import {
  JobberNotConfiguredError,
  JobberNotConnectedError,
  JobberReconnectError,
  pullFromJobber,
} from "@/lib/jobber/connection";
import { actionFail, actionOk, isUniqueConstraintError, ownerRefusal, type ActionResult, type ActionResultWith } from "./shared";

/**
 * The Jobber import on /settings/integrations: preview, confirm, disconnect.
 *
 * NOTHING THE BROWSER SENDS DECIDES WHAT IS WRITTEN. Neither action takes a
 * single row from the page. Preview pulls from Jobber and plans against this
 * company's rows; Confirm pulls AGAIN and plans again, the read of what
 * already exists inside the Serializable transaction that writes (see
 * lib/import-shared.ts) — the same arrangement as the spreadsheet import,
 * with Jobber in place of the pasted text. It also means a big Jobber
 * account never travels browser -> server, so the 1 MB Server Action body
 * limit cannot bite.
 *
 * GUARDS, all RETURNED (production redacts a thrown Server Action message),
 * every one before anything is read:
 *   1. MANAGE_COMPLIANCE, the capability /settings/integrations demands —
 *      the page's door and the action's door must agree
 *      (action-capability-guards.test.ts).
 *   2. Owner only, like the Integrations page and the spreadsheet import.
 *   3. MANAGE_JOBS, the capability that owns clients and jobs.
 *   4. Jobber set up on this install, and connected for this company.
 *
 * Every read and write is scoped to the SESSION's company. Jobber ids are
 * matched within this company only — another company that imported the
 * same Jobber account has its own rows, and they are never read.
 */

type PreviewResult = ActionResultWith<JobberPlan>;

export type JobberImportSummary = {
  clientsAdded: number;
  jobsAdded: number;
  alreadyThere: number;
  message: string;
};

function refuse(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const NOT_YOUR_FUNCTION = "Integrations aren't part of your job function. Ask the account owner.";

/** Guards 2 and 3. Guard 1 is written in each action's own body, where
 * action-capability-guards.test.ts reads it. */
function guard(
  context: Awaited<ReturnType<typeof requireCompanyContext>>,
): { companyId: string } | { ok: false; error: string } {
  const refusal = ownerRefusal(context, "Only the account owner can import from Jobber.");
  if (refusal) return refusal;
  if (!can(context, "MANAGE_JOBS")) {
    return refuse("Adding clients and jobs isn't part of your job function. Ask the account owner.");
  }
  return { companyId: context.company.id };
}

/** Jobber-side failures as sentences. Anything else is a genuine bug and is
 * rethrown, so it is redacted in production as a bug should be. */
function explain(error: unknown): string | null {
  if (
    error instanceof JobberNotConnectedError ||
    error instanceof JobberReconnectError ||
    error instanceof JobberNotConfiguredError
  ) {
    return error.message;
  }
  if (error instanceof JobberApiError) {
    return `Couldn't read from Jobber just now. ${error.message}`;
  }
  return null;
}

async function readExisting(companyId: string, client: Pick<typeof prisma, "contact" | "job"> = prisma) {
  const [contacts, jobs] = await Promise.all([
    client.contact.findMany({
      where: { companyId },
      select: { id: true, name: true, jobberId: true },
      orderBy: { createdAt: "asc" },
    }),
    client.job.findMany({ where: { companyId }, select: { name: true, contactId: true, jobberId: true } }),
  ]);
  return { contacts, jobs };
}

/** Pull and plan. Writes nothing — not a row, not a log line. */
export async function previewJobberImport(): Promise<PreviewResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return refuse(NOT_YOUR_FUNCTION);
  const guarded = guard(context);
  if ("ok" in guarded) return guarded;
  try {
    const pull = await pullFromJobber(guarded.companyId);
    const existing = await readExisting(guarded.companyId);
    return { ok: true, value: planJobberImport(pull, existing) };
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return refuse(sentence);
    throw error;
  }
}

/** Pull again, plan again inside the transaction, write what the plan
 * creates — every job as an ESTIMATE — and log it. */
export async function confirmJobberImport(): Promise<ActionResultWith<JobberImportSummary>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return refuse(NOT_YOUR_FUNCTION);
  const guarded = guard(context);
  if ("ok" in guarded) return guarded;
  const { companyId } = guarded;

  let pull;
  try {
    pull = await pullFromJobber(companyId);
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return refuse(sentence);
    throw error;
  }

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const existing = await readExisting(companyId, tx);
      const plan = planJobberImport(pull, existing);

      const contactIdByJobberClient = new Map<string, string>();
      if (plan.clients.create.length > 0) {
        const created = await tx.contact.createManyAndReturn({
          data: plan.clients.create.map((row) => ({
            companyId,
            name: row.name,
            email: row.email,
            phone: row.phone,
            address: row.address,
            jobberId: row.jobberId,
          })),
          select: { id: true, jobberId: true },
        });
        for (const contact of created) {
          if (contact.jobberId) contactIdByJobberClient.set(contact.jobberId, contact.id);
        }
      }

      if (plan.jobs.create.length > 0) {
        await tx.job.createMany({
          data: plan.jobs.create.map((row) => {
            const contactId =
              row.client.kind === "existing" ? row.client.contactId : contactIdByJobberClient.get(row.client.jobberClientId);
            if (!contactId) throw new Error(`No contact resolved for Jobber ${row.reference}`);
            return {
              companyId,
              contactId,
              name: row.name,
              scope: row.scope,
              // Always. Contracting is markJobContracted's decision, with
              // evidence — see lib/jobber-import.ts.
              status: "ESTIMATE" as const,
              startDate: row.startDate ? dateFromDay(row.startDate) : null,
              endDate: row.endDate ? dateFromDay(row.endDate) : null,
              projectLocation: row.site,
              jobberId: row.jobberId,
            };
          }),
        });
      }

      const alreadyThere = plan.clients.existing.length + plan.jobs.existing.length;
      const message = jobberSummarySentence(plan.clients.create.length, plan.jobs.create.length, alreadyThere);

      // The log row and the summary it feeds, together or not at all.
      const now = new Date();
      const connection = await tx.integrationConnection.findUnique({
        where: { companyId_provider: { companyId, provider: "JOBBER" } },
        select: { id: true },
      });
      if (connection) {
        await tx.integrationConnection.update({
          where: { id: connection.id },
          data: { lastSyncedAt: now, lastSyncStatus: "SUCCESS" },
        });
        await tx.integrationSyncLog.create({
          data: { connectionId: connection.id, direction: "PULL", status: "SUCCESS", message, occurredAt: now },
        });
      }

      return {
        clientsAdded: plan.clients.create.length,
        jobsAdded: plan.jobs.create.length,
        alreadyThere,
        message,
      };
    }, IMPORT_TX_OPTIONS);

    revalidatePath("/settings/integrations");
    revalidatePath("/settings/import");
    revalidatePath("/dashboard");
    revalidatePath("/contacts");
    revalidatePath("/schedule");
    return { ok: true, value: summary };
  } catch (error) {
    if (isWriteConflict(error)) return refuse(IMPORT_COLLIDED);
    if (isUniqueConstraintError(error)) {
      // Two imports racing past Serializable onto the (companyId, jobberId)
      // unique index — the index is the last line, and it held.
      return refuse(IMPORT_COLLIDED);
    }
    throw error;
  }
}

/**
 * Forget the credential. Nothing imported is touched — those are this
 * company's clients and jobs now — and the log is kept. The Jobber-side
 * grant is left for the owner to remove in Jobber; this app makes no call to
 * Jobber that changes anything there.
 */
export async function disconnectJobber(): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can disconnect an integration.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const existing = await prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "JOBBER" } },
    select: { id: true },
  });
  if (!existing) return actionFail("Jobber is not connected.");

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
        direction: "PUSH",
        status: "SUCCESS",
        message: "Disconnected from Jobber. Everything already imported stays in C Stream.",
        occurredAt: now,
      },
    });
  });

  revalidatePath("/settings/integrations");
  return actionOk;
}
