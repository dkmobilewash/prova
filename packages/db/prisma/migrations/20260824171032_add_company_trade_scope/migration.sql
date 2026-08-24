-- CreateTable
CREATE TABLE "CompanyTradeScope" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tradeScope" "TradeScope" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "activeSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyTradeScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyTradeScope_companyId_idx" ON "CompanyTradeScope"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTradeScope_companyId_tradeScope_key" ON "CompanyTradeScope"("companyId", "tradeScope");

-- AddForeignKey
ALTER TABLE "CompanyTradeScope" ADD CONSTRAINT "CompanyTradeScope_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

