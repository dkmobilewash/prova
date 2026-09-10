-- Issue #106 finding 2 (folds in #217) and finding 5.
--
-- Three additive, nullable-only changes, no backfill needed for the two
-- token columns (see billing.prisma / company.prisma comments for why
-- leaving existing rows NULL is deliberate, not an oversight) and a
-- BACKFILLED counter for the third, same shape as InvoiceCounter.

-- Contact.portalRevokedAt: kills a portal link without deleting or
-- rotating it. NULL means "not revoked" for every existing contact.
ALTER TABLE "Contact" ADD COLUMN "portalRevokedAt" TIMESTAMP(3);

-- SignatureRequest.revokedAt / .expiresAt: same idea for the esign token.
-- Both NULL on every existing row -- an already-outstanding PENDING
-- request keeps working exactly as before rather than being retroactively
-- expired the moment this migration runs.
ALTER TABLE "SignatureRequest" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "SignatureRequest" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- ContractDocumentVersionCounter: versionNumber stops being
-- MAX(versionNumber) + 1. See the model's comment in billing.prisma.
CREATE TABLE "ContractDocumentVersionCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractDocumentVersionCounter_pkey" PRIMARY KEY ("jobId")
);

ALTER TABLE "ContractDocumentVersionCounter" ADD CONSTRAINT "ContractDocumentVersionCounter_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every job that already has a contract document starts from the highest
-- version it actually has, exactly like InvoiceCounter's backfill --
-- without this every such job would start at lastNumber 0, issue 1, and
-- collide with its own history on @@unique([jobId, versionNumber]) the
-- first time anyone uploaded an amendment.
INSERT INTO "ContractDocumentVersionCounter" ("jobId", "lastNumber", "updatedAt")
SELECT "jobId", MAX("versionNumber"), CURRENT_TIMESTAMP
FROM "ContractDocument"
GROUP BY "jobId";
