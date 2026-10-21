-- "Add these wall types to your library": the per-company opt-in, the stage
-- that reads a set's partition legend, the table that holds the reading for
-- review, and the table that keeps what plan-text reading worked out.
--
-- ADDITIVE ONLY. Two enum values, one array column with an empty default,
-- two new tables. Nothing the running build reads changes shape, so the gap
-- between this landing and the next deploy going live cannot break a request
-- (CLAUDE.md, the expand-then-contract entry).
--
-- The enum values are added first and used by nothing below: Postgres refuses
-- a new enum value USED in the same transaction it was added in, and the new
-- tables default `status` to an existing value (PROPOSED).

ALTER TYPE "AiFeature" ADD VALUE 'PLAN_TEXT_READ';
ALTER TYPE "PlanIngestStage" ADD VALUE 'WALL_LEGEND';
-- NOT HERE: `TakeoffWallProposalSource` gains no `PROPAGATED` value yet.
-- `wallProposal.ts` narrows that enum to its three members in `ProposalRow`,
-- so the value alone breaks `workspaceLoad.ts` until the finder writes and
-- reads it — one change, in the finder's lane, with its own migration.

-- Off until chosen: the opposite of `disabledFeatures`, for features that are
-- new. Empty for every company, which is "off" for all of them.
ALTER TABLE "CompanyAiSettings" ADD COLUMN     "optedInFeatures" "AiFeature"[] DEFAULT ARRAY[]::"AiFeature"[];

-- CreateTable
CREATE TABLE "PlanLegendProposal" (
    "id" TEXT NOT NULL,
    "ingestJobId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "sheetTitle" TEXT,
    "textRead" JSONB NOT NULL,
    "sightRead" JSONB,
    "merged" JSONB NOT NULL,
    "crops" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" "PlanSheetConfidence" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "PlanSheetProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanLegendProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoffPlanTextRead" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffPlanTextRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanLegendProposal_planId_pageNumber_createdAt_idx" ON "PlanLegendProposal"("planId", "pageNumber", "createdAt");

-- CreateIndex
CREATE INDEX "PlanLegendProposal_planId_status_idx" ON "PlanLegendProposal"("planId", "status");

-- CreateIndex
CREATE INDEX "PlanLegendProposal_acceptedByUserId_idx" ON "PlanLegendProposal"("acceptedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanLegendProposal_ingestJobId_pageNumber_key" ON "PlanLegendProposal"("ingestJobId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TakeoffPlanTextRead_planId_pageNumber_kind_key" ON "TakeoffPlanTextRead"("planId", "pageNumber", "kind");

-- AddForeignKey
ALTER TABLE "PlanLegendProposal" ADD CONSTRAINT "PlanLegendProposal_ingestJobId_fkey" FOREIGN KEY ("ingestJobId") REFERENCES "PlanIngestJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanLegendProposal" ADD CONSTRAINT "PlanLegendProposal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TakeoffPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanLegendProposal" ADD CONSTRAINT "PlanLegendProposal_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffPlanTextRead" ADD CONSTRAINT "TakeoffPlanTextRead_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TakeoffPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
