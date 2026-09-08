import { prisma } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";

/**
 * The body of "start a job", lifted out of the Server Action so two callers
 * can share it: `createJob` (the /jobs/new form, which then redirects) and
 * the Ask command `create_estimate_job` (which needs the id back, and must
 * not redirect — a `redirect()` throws, and inside the tool loop a throw
 * reads as "the lookup failed" after the row has landed).
 *
 * Takes a plain object and returns a plain result. No FormData, no
 * `requireCompanyContext`, no `revalidatePath`, no `redirect`, nothing that
 * reads a request: the caller supplies the company it already verified and
 * does its own revalidation, so this can also run from a database test.
 *
 * One transaction, so a job never exists without its contact and a contact
 * is never minted for a job that then failed. The contact-in-company check
 * is stated here rather than inherited, because there is nothing to
 * inherit: the action used to create a fresh Contact per call and never
 * looked one up.
 */
export type CreateEstimateJobInput = {
  jobName: string;
  scope?: string | null;
  /** An existing GC by id (asserted to be this company's), or a new one. */
  contact: { id: string } | { name: string; email?: string | null };
};

export type CreateEstimateJobResult = {
  jobId: string;
  contactId: string;
  contactCreated: boolean;
  /** True when `refuseDuplicateName` found a job of this name for this GC
   * already; `jobId` is then the existing job's and nothing was written. */
  alreadyExisted: boolean;
};

export type CreateEstimateJobOptions = {
  /** Treat a job of the same name (case-insensitive) for the same GC as the
   * job asked for, rather than creating a second one. The Ask command sets
   * this — a re-asked sentence must not make a twin. The form does not, so
   * /jobs/new behaves exactly as it always has. */
  refuseDuplicateName?: boolean;
};

export async function createEstimateJob(
  companyId: string,
  input: CreateEstimateJobInput,
  options: CreateEstimateJobOptions = {},
): Promise<ActionResultWith<CreateEstimateJobResult>> {
  const jobName = input.jobName.trim();
  if (!jobName) {
    return { ok: false, error: "Give the job a name." };
  }
  const scope = input.scope?.trim() || null;

  return prisma.$transaction(async (tx) => {
    let contactId: string;
    let contactCreated = false;

    if ("id" in input.contact) {
      // A contact id is a client-supplied string wherever it came from;
      // without the companyId check this would attach another tenant's GC,
      // and with it that GC's terms and history, to our job.
      const existing = await tx.contact.findFirst({
        where: { id: input.contact.id, companyId },
        select: { id: true },
      });
      if (!existing) {
        return {
          ok: false,
          error: "That GC isn't on your account. Pick one from the list, or add a new one.",
        };
      }
      contactId = existing.id;
    } else {
      const name = input.contact.name.trim();
      if (!name) {
        return {
          ok: false,
          error: "Pick the GC this job is for, or enter a name to add a new one.",
        };
      }
      const created = await tx.contact.create({
        data: {
          companyId,
          name,
          email: input.contact.email?.trim() || null,
        },
        select: { id: true },
      });
      contactId = created.id;
      contactCreated = true;
    }

    // Inside the transaction, so two confirmations racing on the same
    // sentence cannot both pass the check and both insert. Only meaningful
    // for an existing contact: a contact created two lines up has no jobs.
    if (options.refuseDuplicateName && !contactCreated) {
      const duplicate = await tx.job.findFirst({
        where: { companyId, contactId, name: { equals: jobName, mode: "insensitive" } },
        select: { id: true },
      });
      if (duplicate) {
        return {
          ok: true,
          value: { jobId: duplicate.id, contactId, contactCreated: false, alreadyExisted: true },
        };
      }
    }

    const job = await tx.job.create({
      data: { companyId, contactId, name: jobName, scope },
      select: { id: true },
    });
    return {
      ok: true,
      value: { jobId: job.id, contactId, contactCreated, alreadyExisted: false },
    };
  });
}
