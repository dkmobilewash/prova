-- Why a bid was declined, when it was decided, and what was actually said.
--
-- `BidInvitationStatus.DECLINED` has been a bare status since the model was
-- written: no reason, no date. So the app could report eight declined bids and
-- never say why — and the answers are different businesses. Eight for capacity
-- means hire; eight for contract terms means one GC's paper is costing the
-- relationship. Same count, different decision.
--
-- ALL THREE ADDITIVE AND NULLABLE, no defaults and no backfill, so the running
-- build cannot see them and every existing row keeps the meaning it had. NULL
-- is correct rather than merely preserved: nobody recorded a reason for a bid
-- declined before this existed, and that is exactly what NULL says.
--
-- The nullable shape is load-bearing rather than lenient. A required reason
-- gets its first option picked to get past the screen, and data that looks
-- complete and is fiction is worse than blank — `lib/bid-decline.ts` counts the
-- unrecorded ones as their own number and says so in the summary.
--
-- NO CHECK CONSTRAINT tying these to status = 'DECLINED'. It would be correct
-- and would also mean a bid that is declined, reasoned, then re-opened because
-- the GC extended the date either loses the reason or fails to save. The reason
-- is a fact about a decision somebody made; the status is where the bid is now.
--
-- No index. These are read by loading a company's declined bids — already
-- filtered by companyId and status — and grouping them in memory.
CREATE TYPE "BidDeclineReason" AS ENUM (
  'CAPACITY',
  'SCOPE_MISMATCH',
  'SCHEDULE',
  'BONDING',
  'CONTRACT_TERMS',
  'DRAWINGS_INCOMPLETE',
  'PRICE_RISK',
  'RELATIONSHIP',
  'OTHER'
);

ALTER TABLE "BidInvitation" ADD COLUMN "declineReason" "BidDeclineReason";
ALTER TABLE "BidInvitation" ADD COLUMN "declinedOn" TIMESTAMP(3);
ALTER TABLE "BidInvitation" ADD COLUMN "declineNote" TEXT;
