import { prisma, type TradeScope } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";

/**
 * The body of "log a bid invitation", lifted out of the Server Action so
 * two callers can share it: `createBidInvitation` (the contact page's
 * form, which keeps its throw) and the Ask command `log_bid_invitation`,
 * which needs the id back and its refusals as sentences — production
 * redacts a thrown Server Action message, and a card cannot show a
 * sentence that never arrives.
 *
 * Same arrangement as create-job.ts and job-schedule.ts beside it: a plain
 * object in, a plain result out. No FormData, no `requireCompanyContext`,
 * no `revalidatePath`. The caller supplies the company it already verified
 * and does its own revalidation, so this can also run from a database
 * test. The contact is asserted in-company HERE, in the write itself,
 * because this is the boundary a card's server-held payload crosses.
 *
 * `reuseOpenDuplicate` is the Ask command's option, like create-job.ts's
 * `refuseDuplicateName`: a re-asked sentence, or two cards resolved before
 * either was tapped, must not log the same invitation twice. An
 * invitation from the same contact for the same project (case-insensitive)
 * that is still INVITED or SUBMITTED is that invitation, and the existing
 * row's id comes back with `alreadyExisted`. The form does not set it, so
 * the contact page behaves exactly as it always has — a GC re-inviting on
 * a project that was LOST is a new row either way, since a closed bid is
 * never "the same invitation".
 */
export const PROJECT_NAME_REQUIRED = "Project name is required";
export const CONTACT_NOT_FOUND = "Contact not found";

/** The two statuses under which an invitation is still open. The Ask
 * read tool bid_status uses the same pair. */
const OPEN_STATUSES = ["INVITED", "SUBMITTED"] as const;

export type CreateBidInvitationInput = {
  contactId: string;
  projectName: string;
  /** A calendar day at UTC midnight, or unset. */
  dueDate?: Date | null;
  notes?: string | null;
  tradeScope?: TradeScope | null;
  /** Already validated as a decimal string. The form does not send one
   * and the card never does; it is here so the action's behaviour is
   * unchanged for a client that posts it. */
  bidAmount?: string | null;
};

export type CreateBidInvitationResult = {
  bidInvitationId: string;
  contactName: string;
  /** True when `reuseOpenDuplicate` found an open invitation from this
   * contact for this project already; `bidInvitationId` is then that
   * row's and nothing was written. */
  alreadyExisted: boolean;
};

export type CreateBidInvitationOptions = {
  reuseOpenDuplicate?: boolean;
};

export async function createBidInvitationRecord(
  companyId: string,
  input: CreateBidInvitationInput,
  options: CreateBidInvitationOptions = {},
): Promise<ActionResultWith<CreateBidInvitationResult>> {
  // The action's own rule, in the action's own words, before any read.
  const projectName = input.projectName.trim();
  if (!projectName) return { ok: false, error: PROJECT_NAME_REQUIRED };

  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, companyId },
    select: { id: true, name: true },
  });
  if (!contact) return { ok: false, error: CONTACT_NOT_FOUND };

  if (options.reuseOpenDuplicate) {
    const open = await prisma.bidInvitation.findFirst({
      where: {
        companyId,
        contactId: contact.id,
        projectName: { equals: projectName, mode: "insensitive" },
        status: { in: [...OPEN_STATUSES] },
      },
      select: { id: true },
    });
    if (open) {
      return { ok: true, value: { bidInvitationId: open.id, contactName: contact.name, alreadyExisted: true } };
    }
  }

  const created = await prisma.bidInvitation.create({
    data: {
      companyId,
      contactId: contact.id,
      projectName,
      dueDate: input.dueDate ?? null,
      notes: input.notes?.trim() || null,
      tradeScope: input.tradeScope ?? null,
      bidAmount: input.bidAmount ?? null,
    },
    select: { id: true },
  });

  return { ok: true, value: { bidInvitationId: created.id, contactName: contact.name, alreadyExisted: false } };
}
