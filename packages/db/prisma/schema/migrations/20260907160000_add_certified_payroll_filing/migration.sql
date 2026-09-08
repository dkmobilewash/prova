-- The two things a WH-347 needs that no amount of time data can supply:
-- a sequential payroll number, and a signed statement of compliance.
--
-- ADDITIVE ONLY. One new enum, two new tables, and two nullable columns on
-- "Job". No DROP, nothing made NOT NULL on an existing table, no backfill,
-- no existing row read or rewritten. Every Job that exists today keeps
-- exactly the values it has and gains two NULLs.
--
-- WHY EACH CHOICE:
--
-- "Job"."projectLocation" / "contractNumber" are TEXT and NULLABLE, and
-- stay nullable. The WH-347 header wants "Project and Location" and
-- "Project or Contract No."; a Job records a name and nothing else. Every
-- existing job predates these, there is no backfill source, and a contract
-- number is issued by the awarding body — inventing one would be inventing
-- evidence on a document signed under penalty of perjury. TEXT rather than
-- structured address columns because a location is as often "Sta. 41+00 to
-- 62+00, SR-160" as it is a street address.
--
-- "CertifiedPayrollFilingCounter" is a counter row, keyed by job and only
-- ever incremented, copied from "RfiCounter". A number derived from the
-- filings that still exist (max+1 or count+1) is freed again when one is
-- deleted and reissued to the next — and an awarding body reads the
-- payroll sequence looking for gaps, so a reissued number reads as a
-- missing or falsified payroll rather than as a bug. lastNumber DEFAULT 0
-- so a job's first filing is 1.
--
-- "CertifiedPayrollFiling" is page 2 of the form: an assertion by a named
-- person, on an entered date, about how fringes were paid. It stores only
-- what a person asserts. Hours, gross and fringe credit are NOT
-- snapshotted here — they stay derived from "TimeEntry" on every render,
-- because a stored copy of a computed column can disagree with what it was
-- computed from, and a filing whose stored gross contradicts its own time
-- entries is the worst version of that.
--
--   * "signedDate" is TIMESTAMP(3) and carries NO DEFAULT, deliberately.
--     It is the date the person SIGNED, ENTERED by whoever recorded it,
--     stored at UTC midnight — the same call as
--     "ContractDocument"."executedSignedDate". A DEFAULT now() here would
--     silently misdate a sworn document signed Friday and entered Monday.
--   * "createdAt" DEFAULT CURRENT_TIMESTAMP is the stamped audit
--     companion: when cstream was told, as against when the signing
--     happened. Keeping both is what makes a backdated filing visible.
--   * "signedByUserId" is NOT NULL. An unsigned statement of compliance is
--     not a statement of compliance.
--   * "exceptions" is nullable: NULL means the signer claimed no 4(c)
--     exceptions, which is itself part of the sworn statement. A row only
--     exists once somebody signed, so it never means "not filled in yet".
--
-- The UNIQUE index on ("jobId", "weekEnding") is the design, not hygiene.
-- THE WEEK IS THE IDENTITY of a filing. A filing has already been sent to
-- an agency by the time anyone wants to change it, so a correction must be
-- an AMENDMENT that preserves what was actually sworn to, never an
-- overwrite that leaves the app asserting the corrected text is what the
-- agency received. THE AMENDMENT FLOW IS NOT BUILT — there is no supersedes
-- pointer or revision number yet, so today this constraint simply means a
-- week filed once cannot be filed again, and the action must report that
-- rather than crash.
--
-- NO TRIGGER ON ANY TABLE, live or new. The identity lock on ("jobId",
-- "weekEnding", "payrollNumber") is enforced in the Server Action, which is
-- not built yet. #194 removed a trigger from "TimeEntry" for exactly this
-- reason: a trigger is invisible from the code, fires on every write
-- including migrations and backfills, and cannot return the
-- { ok: false, error } a form renders.
--
-- Announced in #prova-build before this was pushed, per the working
-- agreement. Ships deliberately unwired: no action writes these tables and
-- no read path selects them yet.

-- CreateEnum
CREATE TYPE "CertifiedPayrollFringeMethod" AS ENUM ('APPROVED_PLANS', 'PAID_IN_CASH', 'BOTH');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "projectLocation" TEXT;
ALTER TABLE "Job" ADD COLUMN "contractNumber" TEXT;

-- CreateTable
CREATE TABLE "CertifiedPayrollFilingCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertifiedPayrollFilingCounter_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "CertifiedPayrollFiling" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "weekEnding" TIMESTAMP(3) NOT NULL,
    "payrollNumber" INTEGER NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "fringeMethod" "CertifiedPayrollFringeMethod" NOT NULL,
    "exceptions" TEXT,
    "signedByUserId" TEXT NOT NULL,
    "signedDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertifiedPayrollFiling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertifiedPayrollFiling_jobId_weekEnding_key" ON "CertifiedPayrollFiling"("jobId", "weekEnding");

-- CreateIndex
CREATE INDEX "CertifiedPayrollFiling_jobId_idx" ON "CertifiedPayrollFiling"("jobId");

-- AddForeignKey
ALTER TABLE "CertifiedPayrollFilingCounter" ADD CONSTRAINT "CertifiedPayrollFilingCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertifiedPayrollFiling" ADD CONSTRAINT "CertifiedPayrollFiling_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertifiedPayrollFiling" ADD CONSTRAINT "CertifiedPayrollFiling_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
