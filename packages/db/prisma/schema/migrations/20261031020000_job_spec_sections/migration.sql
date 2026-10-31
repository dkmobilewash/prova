-- A spec section can belong to a job that never had a bid in Prova.
--
-- NOT PURELY ADDITIVE: "bidInvitationId" loses NOT NULL. Approved by Diego
-- 2026-10-30 and announced in #prova-build. Safe beside a running build, which
-- reads the column and has never written a null; no existing row changes.
ALTER TABLE "BidSpecSection" ALTER COLUMN "bidInvitationId" DROP NOT NULL;
ALTER TABLE "BidSpecSection" ADD COLUMN "jobId" TEXT;

-- Every existing row passes, because every existing row has an invitation.
ALTER TABLE "BidSpecSection" ADD CONSTRAINT "BidSpecSection_has_an_owner"
  CHECK ("bidInvitationId" IS NOT NULL OR "jobId" IS NOT NULL);

CREATE INDEX "BidSpecSection_jobId_idx" ON "BidSpecSection"("jobId");

ALTER TABLE "BidSpecSection" ADD CONSTRAINT "BidSpecSection_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
