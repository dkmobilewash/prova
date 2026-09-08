-- What the Ask box proposed, and what became of it — the row a command
-- writes BEFORE anything else is written, claimed by the person's tap.
--
-- ADDITIVE ONLY. One new table, one new enum, two indexes, two foreign
-- keys. No DROP, nothing made NOT NULL on an existing table, no default
-- changed, no backfill, no existing row read or rewritten.
--
-- `createdByUserId` is nullable with ON DELETE SET NULL, the convention
-- every other actor column follows: removing a team member (which hard-
-- deletes the User row) must not delete the record of what they asked for.
-- `companyId` is RESTRICT like every other company-owned table.
--
-- Announced in #prova-build before this was pushed, per the working
-- agreement. Generated with `prisma migrate diff --from-schema-datamodel
-- <main's schema> --to-schema-datamodel prisma/schema --script`, not by
-- hand, because this branch has no database to run `migrate dev` against.
-- CreateEnum
CREATE TYPE "AskProposalOutcome" AS ENUM ('OK', 'REFUSED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AskProposal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "command" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "resolved" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "toolUseId" TEXT NOT NULL,
    "toolUseIdsInContext" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "outcome" "AskProposalOutcome",
    "outcomeNote" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AskProposal_companyId_createdAt_idx" ON "AskProposal"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AskProposal_createdByUserId_idx" ON "AskProposal"("createdByUserId");

-- AddForeignKey
ALTER TABLE "AskProposal" ADD CONSTRAINT "AskProposal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskProposal" ADD CONSTRAINT "AskProposal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

