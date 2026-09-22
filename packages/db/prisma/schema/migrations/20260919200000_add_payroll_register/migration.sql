-- The payroll register import, and WH-347 payroll numbers.
--
-- ADDITIVE ONLY, plus one trigger-function replacement that LOOSENS a rule
-- in one direction (spelled out at the bottom). Three new tables, their
-- indexes and foreign keys as `prisma migrate diff` generated them
-- (schema-to-schema, no database touched), then two hand-written CHECKs.
-- No existing column changes, no backfill: no register has ever been
-- imported and no WH-347 number has ever been issued, so unlike
-- InvoiceCounter there is no history for a fresh counter to collide with.

-- CreateTable
CREATE TABLE "PayrollRegisterEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "payDate" TIMESTAMP(3),
    "hours" DECIMAL(6,2),
    "grossCents" INTEGER NOT NULL,
    "deductionsCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "deductionsDetail" JSONB,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRegisterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wh347PayrollNumber" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "number" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wh347PayrollNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wh347PayrollCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wh347PayrollCounter_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE INDEX "PayrollRegisterEntry_companyId_periodStart_idx" ON "PayrollRegisterEntry"("companyId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRegisterEntry_crewMemberId_periodStart_periodEnd_key" ON "PayrollRegisterEntry"("crewMemberId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Wh347PayrollNumber_jobId_idx" ON "Wh347PayrollNumber"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Wh347PayrollNumber_jobId_weekStart_key" ON "Wh347PayrollNumber"("jobId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "Wh347PayrollNumber_jobId_number_key" ON "Wh347PayrollNumber"("jobId", "number");

-- AddForeignKey
ALTER TABLE "PayrollRegisterEntry" ADD CONSTRAINT "PayrollRegisterEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRegisterEntry" ADD CONSTRAINT "PayrollRegisterEntry_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wh347PayrollNumber" ADD CONSTRAINT "Wh347PayrollNumber_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wh347PayrollCounter" ADD CONSTRAINT "Wh347PayrollCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A period that ends before it starts is a parse bug, not data. Both new
-- tables are empty, so there is no existing row for either CHECK to meet.
ALTER TABLE "PayrollRegisterEntry" ADD CONSTRAINT "PayrollRegisterEntry_period_order"
CHECK ("periodEnd" >= "periodStart");

-- A payroll number is 1-based: the counter starts at 0 and the first bump
-- issues 1, so 0 or below on the issued row means the counter was bypassed.
ALTER TABLE "Wh347PayrollNumber" ADD CONSTRAINT "Wh347PayrollNumber_number_positive"
CHECK ("number" >= 1);

-- identifyingNumberLast4 becomes SET-ONCE instead of locked-from-creation.
--
-- The column's own schema comment has said since it shipped that it is
-- "nullable because a crew member is worth recording before payroll has
-- sent the number over" — and the trigger below, as written in
-- 20260905183000_add_crew_members, then refused the very write that
-- sentence describes: NULL -> a value is DISTINCT, so the number payroll
-- sent over could never be recorded. The payroll register import is that
-- caller, so the contradiction now costs something.
--
-- The replacement gives identifyingNumberLast4 exactly the one-way rule
-- linkedUserId already has in this same function: NULL -> value is
-- allowed, and ANY change once set is still refused. Nothing filed can be
-- contradicted by the loosened direction — a filing made while the field
-- was NULL printed "ID number not recorded", and filling the field later
-- completes future filings without altering what that one said. Changing
-- a SET value would contradict a filing, and that direction stays locked.
-- Names, company and the after-set case behave byte-for-byte as before;
-- the four-digit CHECK on the column is untouched.
CREATE OR REPLACE FUNCTION prova_crew_member_identity_lock() RETURNS trigger AS $$
BEGIN
  IF NEW."companyId"      IS DISTINCT FROM OLD."companyId"
  OR NEW."legalFirstName" IS DISTINCT FROM OLD."legalFirstName"
  OR NEW."legalMiddleName" IS DISTINCT FROM OLD."legalMiddleName"
  OR NEW."legalLastName"  IS DISTINCT FROM OLD."legalLastName"
  THEN
    RAISE EXCEPTION
      'CrewMember identity is locked after creation (id=%). Archive this row and create a corrected one.',
      OLD."id";
  END IF;

  IF OLD."identifyingNumberLast4" IS NOT NULL
  AND NEW."identifyingNumberLast4" IS DISTINCT FROM OLD."identifyingNumberLast4"
  THEN
    RAISE EXCEPTION
      'CrewMember.identifyingNumberLast4 cannot be changed once set (id=%). Archive this row and create a corrected one.',
      OLD."id";
  END IF;

  IF OLD."linkedUserId" IS NOT NULL
  AND NEW."linkedUserId" IS DISTINCT FROM OLD."linkedUserId"
  THEN
    RAISE EXCEPTION
      'CrewMember.linkedUserId cannot be changed once set (id=%).',
      OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
