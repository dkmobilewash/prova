-- CreateTable
CREATE TABLE "AskUsage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "model" TEXT NOT NULL,
    "passes" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL,
    "cacheWriteTokens" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AskUsage_companyId_createdAt_idx" ON "AskUsage"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AskUsage_userId_createdAt_idx" ON "AskUsage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AskUsage" ADD CONSTRAINT "AskUsage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskUsage" ADD CONSTRAINT "AskUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
