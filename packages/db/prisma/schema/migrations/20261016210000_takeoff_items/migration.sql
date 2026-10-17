-- ─────────────────────────────────────────────────────────────────────────
-- TAKEOFF ITEMS: the condition every estimating tool is built around
-- ─────────────────────────────────────────────────────────────────────────
--
-- Additive only. Nothing is dropped and nothing is rewritten, so the running
-- build is unaffected by every statement below until the deploy that reads
-- them lands — the expand half of expand-then-contract.
--
-- Hand-edited after `prisma migrate diff`, in three places, each marked. The
-- generated form would have failed on the first one.

-- CreateEnum
CREATE TYPE "TakeoffItemType" AS ENUM ('LINEAR', 'AREA', 'COUNT', 'SEGMENT', 'AREA_WITH_PERIMETER');

-- CreateEnum
CREATE TYPE "TakeoffLineStyle" AS ENUM ('SOLID', 'DASHED', 'DOTTED');

-- CreateEnum
CREATE TYPE "TakeoffMeasurementSource" AS ENUM ('MANUAL', 'DETECTED', 'IMPORTED');

-- ── EDIT 1: `updatedAt` IS ADDED NULLABLE, BACKFILLED, THEN MADE NOT NULL ──
--
-- `prisma migrate diff` emitted a bare
--   ALTER TABLE "TakeoffPlan" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL;
-- which cannot succeed against a table that has rows, and production has 14
-- jobs' worth of them. Prisma's `@updatedAt` is applied by the CLIENT and
-- emits no database default, so there is nothing for the existing rows to
-- take.
--
-- Backfilled from `createdAt` rather than `now()`: as far as anything in this
-- database knows, a plan uploaded in August has not been updated since, and
-- stamping it with the migration's own clock would assert an edit that never
-- happened. No DEFAULT is left behind, so the column matches what Prisma
-- expects and `migrate status` reports no drift.
ALTER TABLE "TakeoffPlan" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "TakeoffPlan" SET "updatedAt" = "createdAt";
ALTER TABLE "TakeoffPlan" ALTER COLUMN "updatedAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "TakeoffMeasurement" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "cutouts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "itemId" TEXT,
ADD COLUMN     "source" "TakeoffMeasurementSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "TakeoffItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TakeoffItemType" NOT NULL,
    "colorHex" TEXT NOT NULL,
    "lineStyle" "TakeoffLineStyle" NOT NULL DEFAULT 'SOLID',
    "heightFt" DECIMAL(8,2),
    "sides" INTEGER,
    "thicknessIn" DECIMAL(6,2),
    "wastePercent" DECIMAL(5,2),
    "spacingIn" DECIMAL(6,2),
    "depthIn" DECIMAL(6,2),
    "wallTypeId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TakeoffItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TakeoffItem_jobId_sortOrder_idx" ON "TakeoffItem"("jobId", "sortOrder");

-- CreateIndex
CREATE INDEX "TakeoffItem_companyId_idx" ON "TakeoffItem"("companyId");

-- CreateIndex
CREATE INDEX "TakeoffItem_wallTypeId_idx" ON "TakeoffItem"("wallTypeId");

-- CreateIndex
CREATE INDEX "TakeoffMeasurement_itemId_idx" ON "TakeoffMeasurement"("itemId");

-- AddForeignKey
ALTER TABLE "TakeoffMeasurement" ADD CONSTRAINT "TakeoffMeasurement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "TakeoffItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffItem" ADD CONSTRAINT "TakeoffItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffItem" ADD CONSTRAINT "TakeoffItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffItem" ADD CONSTRAINT "TakeoffItem_wallTypeId_fkey" FOREIGN KEY ("wallTypeId") REFERENCES "WallType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── EDIT 2: EXISTING MEASUREMENTS GET AN ITEM ──
--
-- Every measurement drawn before today has a `packageLabel` — a loose
-- grouping string — and no item. One item per distinct
-- (jobId, kind, packageLabel), named from the label, so an estimator's
-- existing work arrives inside the new model rather than in an "Unassigned"
-- pile the size of their last six months.
--
-- UNPOSTED ROWS ONLY. A posted measurement has already become a WallRun and
-- priced JobLineItems; giving it an item too would let the expander see the
-- same quantity twice. Those keep `itemId` NULL and read as history.
--
-- The colour rotation is keyed on a deterministic hash of the group, so
-- re-running this migration against the same data produces the same colours
-- rather than reshuffling somebody's drawing.
INSERT INTO "TakeoffItem" (
    "id", "companyId", "jobId", "name", "type", "colorHex", "sortOrder",
    "createdAt", "updatedAt"
)
SELECT
    'tki_' || md5(p."jobId" || '|' || m."kind"::text || '|' || COALESCE(m."packageLabel", '')),
    p."companyId",
    p."jobId",
    COALESCE(
        NULLIF(TRIM(m."packageLabel"), ''),
        CASE m."kind"
            WHEN 'LINEAR' THEN 'Linear takeoff'
            WHEN 'AREA'   THEN 'Area takeoff'
            ELSE 'Count'
        END
    ),
    CASE m."kind"
        WHEN 'LINEAR' THEN 'LINEAR'::"TakeoffItemType"
        WHEN 'AREA'   THEN 'AREA'::"TakeoffItemType"
        ELSE 'COUNT'::"TakeoffItemType"
    END,
    (ARRAY[
        '#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2',
        '#be123c', '#4f46e5', '#15803d', '#b45309', '#7c3aed', '#0e7490'
    ])[1 + (('x' || substr(md5(p."jobId" || m."kind"::text || COALESCE(m."packageLabel", '')), 1, 8))::bit(32)::bigint % 12)],
    0,
    NOW(),
    NOW()
FROM "TakeoffMeasurement" m
JOIN "TakeoffPlanPage" pg ON pg."id" = m."pageId"
JOIN "TakeoffPlan" p ON p."id" = pg."planId"
WHERE m."postedAt" IS NULL
GROUP BY p."jobId", p."companyId", m."kind", m."packageLabel";

-- ── EDIT 3: AND THE MEASUREMENTS POINT AT THEM ──
--
-- The same key the insert above built its id from, so this is a lookup rather
-- than a second grouping that could disagree with the first.
UPDATE "TakeoffMeasurement" m
SET "itemId" = 'tki_' || md5(p."jobId" || '|' || m."kind"::text || '|' || COALESCE(m."packageLabel", ''))
FROM "TakeoffPlanPage" pg, "TakeoffPlan" p
WHERE pg."id" = m."pageId"
  AND p."id" = pg."planId"
  AND m."postedAt" IS NULL;
