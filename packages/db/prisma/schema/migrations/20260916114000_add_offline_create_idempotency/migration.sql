-- Add the phone's idempotency key to every field create, so a retried
-- offline POST replays instead of duplicating. Nullable — web writes leave
-- it NULL and Postgres treats NULLs as distinct, so today's web rows are
-- unaffected, exactly like the field-reports pair in
-- 20260914233236_add_offline_field_report_sync. The two counter-backed
-- creates (MaterialOrder, SafetyIncident) rely on the unique index INSIDE
-- their existing transaction: a retried create violates it, the transaction
-- rolls back, and the counter is never double-bumped.

-- AlterTable
ALTER TABLE "MaterialOrder" ADD COLUMN "clientOperationId" TEXT;

ALTER TABLE "PunchListItem" ADD COLUMN "clientOperationId" TEXT;

ALTER TABLE "SafetyIncident" ADD COLUMN "clientOperationId" TEXT;

ALTER TABLE "TimeEntry" ADD COLUMN "clientOperationId" TEXT;

ALTER TABLE "ToolboxTalk" ADD COLUMN "clientOperationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MaterialOrder_companyId_clientOperationId_key" ON "MaterialOrder"("companyId", "clientOperationId");

CREATE UNIQUE INDEX "PunchListItem_companyId_clientOperationId_key" ON "PunchListItem"("companyId", "clientOperationId");

CREATE UNIQUE INDEX "SafetyIncident_companyId_clientOperationId_key" ON "SafetyIncident"("companyId", "clientOperationId");

CREATE UNIQUE INDEX "TimeEntry_jobId_clientOperationId_key" ON "TimeEntry"("jobId", "clientOperationId");

CREATE UNIQUE INDEX "ToolboxTalk_companyId_clientOperationId_key" ON "ToolboxTalk"("companyId", "clientOperationId");
