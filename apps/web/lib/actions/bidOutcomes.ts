"use server";

import { revalidatePath } from "next/cache";
import { prisma, type BidOutcomeReason } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { declineFieldsFor } from "@/lib/bid-decline";
import { actionFail, actionOk, type ActionResult } from "./shared";

/**
 * WIN/LOSS LEARNING: what happened to a bid and why, as the person heard
 * it from the GC. Writes the BidOutcome row AND moves the invitation to WON
 * or LOST in one transaction, so the status column and the outcome cannot
 * disagree. The only business write the AI agents' work adds; it is reached
 * from an explicit form submit or the Ask confirm card (`record_bid_outcome`),
 * never from an agent.
 *
 * Marking WON does nothing else, exactly as `updateBidInvitationStatus`
 * does nothing else: linking the job stays `linkBidToJob`, a person's pick.
 * The bid amount is left as it is. A DECLINED bid is refused — it was never
 * submitted, so it cannot have been won or lost.
 */

export type RecordBidOutcomeInput = {
  bidInvitationId: string;
  result: "WON" | "LOST";
  reason: BidOutcomeReason;
  winningPrice?: number | null;
  winnerName?: string | null;
  note?: string | null;
  /** yyyy-mm-dd, the day the GC told us. Stored at UTC midnight. */
  decidedOn?: string | null;
};

const REASONS: readonly BidOutcomeReason[] = ["PRICE", "RELATIONSHIP", "SCOPE", "SCHEDULE", "QUALIFICATIONS", "OTHER"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

export async function recordBidOutcome(input: RecordBidOutcomeInput): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail("Recording a bid outcome isn't part of your job function. The account owner sets who sees what, on the Team page.");
  }
  const raw = (input ?? {}) as Partial<RecordBidOutcomeInput>;
  if (typeof raw.bidInvitationId !== "string" || !raw.bidInvitationId) return actionFail("Which bid is this outcome for?");
  if (raw.result !== "WON" && raw.result !== "LOST") return actionFail("Say whether the bid was won or lost.", { result: "Won or lost?" });
  if (!REASONS.includes(raw.reason as BidOutcomeReason)) return actionFail("Pick a reason: price, relationship, scope, schedule, qualifications or other.", { reason: "Pick a reason." });
  const winningPrice = raw.winningPrice == null || (raw.winningPrice as unknown) === "" ? null : Number(raw.winningPrice);
  if (winningPrice !== null && !(Number.isFinite(winningPrice) && winningPrice > 0)) return actionFail("The winning price must be a positive amount.", { winningPrice: "Enter a positive amount." });
  if (raw.decidedOn && !ISO_DAY.test(raw.decidedOn)) return actionFail("The decision date must be a calendar day.", { decidedOn: "Enter a date." });

  const bid = await prisma.bidInvitation.findFirst({
    where: { id: raw.bidInvitationId, companyId: context.companyId },
    select: { id: true, status: true, contactId: true },
  });
  if (!bid) return actionFail("That bid isn't on your account.");
  if (bid.status === "DECLINED") return actionFail("This bid was declined, so it can't be won or lost. Reopen it on the bids page first.");

  const fields = {
    result: raw.result,
    reason: raw.reason as BidOutcomeReason,
    winningPrice: winningPrice === null ? null : winningPrice.toFixed(2),
    winnerName: text(raw.winnerName, 200),
    note: text(raw.note, 2000),
    decidedOn: raw.decidedOn ? new Date(`${raw.decidedOn}T00:00:00.000Z`) : null,
    recordedByUserId: context.id,
  };
  await prisma.$transaction([
    prisma.bidOutcome.upsert({
      where: { bidInvitationId: bid.id },
      create: { companyId: context.companyId, bidInvitationId: bid.id, ...fields },
      update: fields,
    }),
    prisma.bidInvitation.update({
      where: { id: bid.id },
      data: { status: raw.result, ...declineFieldsFor({ status: raw.result, reason: null, note: null, on: null }) },
    }),
  ]);

  revalidatePath("/bids");
  revalidatePath(`/contacts/${bid.contactId}`);
  revalidatePath("/ai/bids/[id]", "page");
  revalidatePath("/ai/activity");
  return actionOk;
}
