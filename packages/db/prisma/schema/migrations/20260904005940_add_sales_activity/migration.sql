-- CreateEnum
CREATE TYPE "SalesActivityType" AS ENUM ('CALL', 'EMAIL', 'DEMO', 'MEETING', 'NOTE');

-- CreateTable
CREATE TABLE "SalesActivity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "SalesActivityType" NOT NULL,
    "occurredOn" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "followUpOn" TIMESTAMP(3),
    "opportunityId" TEXT,
    "loggedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesActivity_leadId_idx" ON "SalesActivity"("leadId");

-- CreateIndex
CREATE INDEX "SalesActivity_companyId_idx" ON "SalesActivity"("companyId");

-- CreateIndex
CREATE INDEX "SalesActivity_followUpOn_idx" ON "SalesActivity"("followUpOn");

-- CreateIndex
CREATE INDEX "SalesActivity_opportunityId_idx" ON "SalesActivity"("opportunityId");

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_loggedByUserId_fkey" FOREIGN KEY ("loggedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
