-- CreateEnum
CREATE TYPE "QuickBooksSyncOutcome" AS ENUM ('SUCCEEDED', 'FAILED', 'VERIFY_MISMATCH', 'SKIPPED');

-- CreateTable
CREATE TABLE "QuickBooksEntityLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "qboId" TEXT NOT NULL,
    "qboSyncToken" TEXT,
    "lastPushedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksEntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksAccountMapping" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "qboAccountId" TEXT NOT NULL,
    "qboAccountName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksSyncAttempt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outcome" "QuickBooksSyncOutcome" NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "qboId" TEXT,
    "attemptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickBooksSyncAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuickBooksEntityLink_companyId_idx" ON "QuickBooksEntityLink"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksEntityLink_companyId_entityType_entityId_key" ON "QuickBooksEntityLink"("companyId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksEntityLink_companyId_entityType_qboId_key" ON "QuickBooksEntityLink"("companyId", "entityType", "qboId");

-- CreateIndex
CREATE INDEX "QuickBooksAccountMapping_companyId_idx" ON "QuickBooksAccountMapping"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksAccountMapping_companyId_purpose_key" ON "QuickBooksAccountMapping"("companyId", "purpose");

-- CreateIndex
CREATE INDEX "QuickBooksSyncAttempt_companyId_createdAt_idx" ON "QuickBooksSyncAttempt"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "QuickBooksSyncAttempt_companyId_entityType_entityId_idx" ON "QuickBooksSyncAttempt"("companyId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "QuickBooksEntityLink" ADD CONSTRAINT "QuickBooksEntityLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksAccountMapping" ADD CONSTRAINT "QuickBooksAccountMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksSyncAttempt" ADD CONSTRAINT "QuickBooksSyncAttempt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksSyncAttempt" ADD CONSTRAINT "QuickBooksSyncAttempt_attemptedByUserId_fkey" FOREIGN KEY ("attemptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
