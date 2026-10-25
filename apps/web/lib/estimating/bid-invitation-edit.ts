import { prisma, type TradeScope } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";
import { bidDatesProblem, type BidDatesInput } from "@/lib/bid-dates";

/**
 * Editing a logged bid's details: project name, trade, amount, notes and the
 * four dates (due day, due time, job walk, RFI cutoff).
 *
 * A separate file from `bid-invitation.ts` (the create path) on purpose —
 * other work is editing that one — and shaped the same way: a plain object in,
 * a plain result out, no FormData, no `requireCompanyContext`, no
 * `revalidatePath`, so a database test can call it directly.
 *
 * WHAT THIS DOES NOT TOUCH: the GC (`contactId`), the status, the decline
 * fields and the won-job link. The GC is who the invitation is FROM — an
 * identity field, locked after creation like every evidence record's — and the
 * status/decline fields have their own writer (`updateBidInvitationStatus`)
 * with their own rules about what moving off DECLINED clears.
 *
 * WHY THE DUE DATE IS EDITABLE AT ALL: addenda move bid dates constantly. The
 * "Due soon" list, the MISSED flag and the gone-cold flag are all DERIVED from
 * `dueDate` at read time (never stored — CLAUDE.md), so correcting the one
 * column corrects every flag with no second write to forget.
 *
 * Every field is REPLACED, not merged: the form always sends all of them, and
 * clearing a field is how a person says an addendum withdrew a walk.
 */
export const BID_NOT_FOUND = "Bid invitation not found";
export const PROJECT_NAME_REQUIRED = "Project name is required";

export type UpdateBidDetailsInput = BidDatesInput & {
  projectName: string;
  tradeScope: TradeScope | null;
  /** Already validated as a decimal string, or null to clear. */
  bidAmount: string | null;
  notes: string | null;
};

export async function updateBidInvitationDetailsRecord(
  companyId: string,
  bidInvitationId: string,
  input: UpdateBidDetailsInput,
): Promise<ActionResultWith<{ contactId: string }>> {
  const projectName = input.projectName.trim();
  if (!projectName) return { ok: false, error: PROJECT_NAME_REQUIRED };
  const problem = bidDatesProblem(input);
  if (problem) return { ok: false, error: problem };

  const bid = await prisma.bidInvitation.findFirst({
    where: { id: bidInvitationId, companyId },
    select: { id: true, contactId: true },
  });
  if (!bid) return { ok: false, error: BID_NOT_FOUND };

  await prisma.bidInvitation.update({
    where: { id: bid.id },
    data: {
      projectName,
      tradeScope: input.tradeScope,
      bidAmount: input.bidAmount,
      notes: input.notes?.trim() || null,
      dueDate: input.dueDate,
      dueMinute: input.dueMinute,
      walkDate: input.walkDate,
      walkMinute: input.walkMinute,
      rfiCutoffDate: input.rfiCutoffDate,
    },
  });
  return { ok: true, value: { contactId: bid.contactId } };
}
