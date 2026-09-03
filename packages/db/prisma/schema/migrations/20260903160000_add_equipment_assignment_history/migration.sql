-- CreateTable
CREATE TABLE "EquipmentAssignment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sentOutOn" TIMESTAMP(3) NOT NULL,
    "returnedOn" TIMESTAMP(3),
    "notes" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentAssignment_companyId_idx" ON "EquipmentAssignment"("companyId");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_equipmentId_idx" ON "EquipmentAssignment"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_jobId_idx" ON "EquipmentAssignment"("jobId");

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every piece of equipment currently sitting on a job becomes an
-- open assignment, so nothing that was recorded is lost when the app stops
-- reading Equipment."assignedJobId".
--
-- The dates are INFERRED, not entered, and that is written into the row so
-- nobody mistakes them for a real record. The old column only ever stored
-- WHERE a thing was, never when it went — "updatedAt" is the least-bad
-- available answer and it is honestly an upper bound, not the truth.
-- Additive: this only inserts, and only for equipment that has a job.
INSERT INTO "EquipmentAssignment" ("id", "companyId", "equipmentId", "jobId", "sentOutOn", "returnedOn", "notes", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    e."companyId",
    e."id",
    e."assignedJobId",
    date_trunc('day', e."updatedAt"),
    NULL,
    'Carried over when assignment history was introduced. The date is inferred from when the record last changed — the old field stored only where this was, never when it went out.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Equipment" e
WHERE e."assignedJobId" IS NOT NULL;
