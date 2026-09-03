-- CreateTable
CREATE TABLE "AlertAcknowledgement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozedUntil" TIMESTAMP(3),

    CONSTRAINT "AlertAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertAcknowledgement_companyId_idx" ON "AlertAcknowledgement"("companyId");

-- CreateIndex
CREATE INDEX "AlertAcknowledgement_userId_idx" ON "AlertAcknowledgement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertAcknowledgement_userId_alertKey_key" ON "AlertAcknowledgement"("userId", "alertKey");

-- AddForeignKey
ALTER TABLE "AlertAcknowledgement" ADD CONSTRAINT "AlertAcknowledgement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertAcknowledgement" ADD CONSTRAINT "AlertAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
