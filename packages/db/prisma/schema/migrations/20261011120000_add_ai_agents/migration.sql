-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('BID_WATCHER', 'BID_RESEARCH', 'ESTIMATE_CHECK', 'RECOMMENDATIONS');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED', 'PAUSED_CAP', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BidOutcomeReason" AS ENUM ('PRICE', 'RELATIONSHIP', 'SCOPE', 'SCHEDULE', 'QUALIFICATIONS', 'OTHER');

-- CreateTable
CREATE TABLE "AskThread" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "cites" JSONB,
    "proposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agent" "AgentKind" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "bidInvitationId" TEXT,
    "requestedByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" TEXT,
    "note" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentFinding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agent" "AgentKind" NOT NULL,
    "bidInvitationId" TEXT,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "fixHref" TEXT,
    "dedupeKey" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidOutcome" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bidInvitationId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" "BidOutcomeReason" NOT NULL,
    "winningPrice" DECIMAL(12,2),
    "winnerName" TEXT,
    "note" TEXT,
    "decidedOn" TIMESTAMP(3),
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRecommendation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "href" TEXT,
    "sources" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAgentSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "watcherEnabled" BOOLEAN NOT NULL DEFAULT true,
    "researchOnNewBid" BOOLEAN NOT NULL DEFAULT true,
    "checkerBeforeSend" BOOLEAN NOT NULL DEFAULT true,
    "recommendationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dueSoonDays" INTEGER NOT NULL DEFAULT 5,
    "monthlySpendCapUsd" DECIMAL(8,2),
    "notifyUserIds" TEXT[],
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAgentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AskThread_companyId_userId_lastMessageAt_idx" ON "AskThread"("companyId", "userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AskThread_companyId_subjectType_subjectId_idx" ON "AskThread"("companyId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AskMessage_threadId_createdAt_idx" ON "AskMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_companyId_startedAt_idx" ON "AgentRun"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_companyId_status_idx" ON "AgentRun"("companyId", "status");

-- CreateIndex
CREATE INDEX "AgentRun_bidInvitationId_idx" ON "AgentRun"("bidInvitationId");

-- CreateIndex
CREATE INDEX "AgentFinding_companyId_createdAt_idx" ON "AgentFinding"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentFinding_companyId_agent_dismissedAt_idx" ON "AgentFinding"("companyId", "agent", "dismissedAt");

-- CreateIndex
CREATE INDEX "AgentFinding_bidInvitationId_idx" ON "AgentFinding"("bidInvitationId");

-- CreateIndex
CREATE INDEX "AgentFinding_runId_idx" ON "AgentFinding"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentFinding_companyId_dedupeKey_key" ON "AgentFinding"("companyId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BidOutcome_bidInvitationId_key" ON "BidOutcome"("bidInvitationId");

-- CreateIndex
CREATE INDEX "BidOutcome_companyId_idx" ON "BidOutcome"("companyId");

-- CreateIndex
CREATE INDEX "AiRecommendation_companyId_status_score_idx" ON "AiRecommendation"("companyId", "status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "AiRecommendation_companyId_kind_subjectType_subjectId_key" ON "AiRecommendation"("companyId", "kind", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAgentSettings_companyId_key" ON "CompanyAgentSettings"("companyId");

-- AddForeignKey
ALTER TABLE "AskThread" ADD CONSTRAINT "AskThread_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskThread" ADD CONSTRAINT "AskThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskMessage" ADD CONSTRAINT "AskMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AskThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_bidInvitationId_fkey" FOREIGN KEY ("bidInvitationId") REFERENCES "BidInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentFinding" ADD CONSTRAINT "AgentFinding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentFinding" ADD CONSTRAINT "AgentFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentFinding" ADD CONSTRAINT "AgentFinding_bidInvitationId_fkey" FOREIGN KEY ("bidInvitationId") REFERENCES "BidInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentFinding" ADD CONSTRAINT "AgentFinding_dismissedByUserId_fkey" FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidOutcome" ADD CONSTRAINT "BidOutcome_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidOutcome" ADD CONSTRAINT "BidOutcome_bidInvitationId_fkey" FOREIGN KEY ("bidInvitationId") REFERENCES "BidInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidOutcome" ADD CONSTRAINT "BidOutcome_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRecommendation" ADD CONSTRAINT "AiRecommendation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRecommendation" ADD CONSTRAINT "AiRecommendation_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAgentSettings" ADD CONSTRAINT "CompanyAgentSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAgentSettings" ADD CONSTRAINT "CompanyAgentSettings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

