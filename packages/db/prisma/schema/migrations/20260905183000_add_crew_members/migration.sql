-- CrewMember: the worker identity for people who do not have a login.
--
-- ADDITIVE ONLY. Nothing is dropped, nothing becomes NOT NULL, no existing
-- row is read or rewritten. Every TimeEntry keeps its "employeeUserId"
-- exactly as it is, and "crewMemberId" is NULL on every existing row.
--
-- The everything-below-the-Prisma-block half is hand-written, following the
-- same precedent as the EXCLUDE constraint in
-- 20260824171704_add_union_affiliation: the guarantees this table needs
-- cannot be expressed in Prisma's schema language, and a guarantee that
-- lives only in an action is not a guarantee at all — least of all for a
-- table nothing calls yet.
--
-- WHAT IS DELIBERATELY NOT HERE:
--
--   ALTER TABLE "TimeEntry" ALTER COLUMN "employeeUserId" DROP NOT NULL;
--   ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_one_worker_identity"
--     CHECK (("employeeUserId" IS NOT NULL) <> ("crewMemberId" IS NOT NULL))
--     NOT VALID;
--   ALTER TABLE "TimeEntry" VALIDATE CONSTRAINT "TimeEntry_one_worker_identity";
--
-- That is the follow-up migration, and it is additive too (the XOR is
-- satisfied by every existing row: employeeUserId set, crewMemberId null).
-- It is held back because the moment "employeeUserId" is nullable the
-- generated Prisma type becomes `User | null` and every module that prints
-- `entry.employeeUser.name ?? entry.employeeUser.email` stops compiling.
-- Those modules are the certified-payroll, prevailing-wage, union-compliance
-- and job pages, and they must change in the same reviewable commit as the
-- constraint, not before it and not after it.

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "crewMemberId" TEXT;

-- CreateTable
CREATE TABLE "CrewMember" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "legalFirstName" TEXT NOT NULL,
    "legalMiddleName" TEXT,
    "legalLastName" TEXT NOT NULL,
    "identifyingNumberLast4" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "employeeNumber" TEXT,
    "hiredOn" TIMESTAMP(3),
    "linkedUserId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrewMember_linkedUserId_key" ON "CrewMember"("linkedUserId");

-- CreateIndex
CREATE INDEX "CrewMember_companyId_idx" ON "CrewMember"("companyId");

-- CreateIndex
CREATE INDEX "CrewMember_archivedAt_idx" ON "CrewMember"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrewMember_companyId_employeeNumber_key" ON "CrewMember"("companyId", "employeeNumber");

-- CreateIndex
CREATE INDEX "TimeEntry_crewMemberId_idx" ON "TimeEntry"("crewMemberId");

-- AddForeignKey
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written from here down. All of it applies to CrewMember, which has
-- zero rows, or to a TimeEntry UPDATE, which no code path in this repo
-- performs (`timeEntry.` call sites are create/createMany/delete/deleteMany/
-- find/count/aggregate only — checked, not assumed). Nothing below can
-- change the behaviour of an existing row.
-- ---------------------------------------------------------------------------

-- The name that goes on a signed WH-347 is not allowed to be blank. A form
-- filed with an empty surname is a correction to a government agency, and
-- the application layer that would have prevented it does not exist yet.
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_legal_name_present"
CHECK (btrim("legalFirstName") <> '' AND btrim("legalLastName") <> '');

-- WH-347 column 1E asks for an INDIVIDUAL IDENTIFYING NUMBER. The
-- Department of Labor's instructions accept the last four digits of the SSN
-- OR any number specific to the individual worker, and say the full SSN must
-- not be included (https://www.dol.gov/agencies/whd/forms/wh347). This
-- column is the SSN-derived form of that: four digits, or nothing. The
-- contractor's own worker number goes in "employeeNumber" instead, so a
-- company that uses badge numbers never supplies an SSN digit at all.
-- This CHECK is what stops a whole SSN being pasted into the field, which is
-- the reason there is no column anywhere for one.
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_identifying_number_last4"
CHECK ("identifyingNumberLast4" IS NULL OR "identifyingNumberLast4" ~ '^[0-9]{4}$');

-- linkedAt is the date of the link, so it exists exactly when the link does.
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_linked_at_matches_link"
CHECK (("linkedUserId" IS NULL) = ("linkedAt" IS NULL));

-- Identity is locked after creation.
--
-- CLAUDE.md's rule for evidence records — identity fields locked after
-- creation, sent correspondence can close but never delete — is enforced
-- here rather than in a Server Action, for one specific reason: an action
-- that nothing calls cannot enforce anything, and this model ships
-- deliberately unwired. When the first UI is built the guarantee will
-- already be in the database underneath it, which is the right order for a
-- record that ends up on a signed government filing.
--
-- A misspelt name is fixed by archiving the row and creating a corrected
-- one. That keeps both the filing and the correction on the record. A
-- silent UPDATE would leave a filed WH-347 and its source disagreeing with
-- nothing anywhere to show that they had ever agreed.
--
-- linkedUserId is one-way: NULL -> a user id is allowed (that is the
-- transition, when a crew member later gets a real login), and any change
-- after that is refused, so a login can never be moved from one person's
-- payroll history onto another's.
CREATE OR REPLACE FUNCTION prova_crew_member_identity_lock() RETURNS trigger AS $$
BEGIN
  IF NEW."companyId"              IS DISTINCT FROM OLD."companyId"
  OR NEW."legalFirstName"         IS DISTINCT FROM OLD."legalFirstName"
  OR NEW."legalMiddleName"        IS DISTINCT FROM OLD."legalMiddleName"
  OR NEW."legalLastName"          IS DISTINCT FROM OLD."legalLastName"
  OR NEW."identifyingNumberLast4" IS DISTINCT FROM OLD."identifyingNumberLast4"
  THEN
    RAISE EXCEPTION
      'CrewMember identity is locked after creation (id=%). Archive this row and create a corrected one.',
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

DROP TRIGGER IF EXISTS "CrewMember_identity_lock" ON "CrewMember";
CREATE TRIGGER "CrewMember_identity_lock"
BEFORE UPDATE ON "CrewMember"
FOR EACH ROW EXECUTE FUNCTION prova_crew_member_identity_lock();

-- An hour, once attributed to a crew member, does not change hands.
--
-- This is the other half of the same guarantee. Locking the CrewMember's
-- name is worth nothing if the TimeEntry can be repointed at a different
-- CrewMember afterwards: the hours on a filed certified payroll would move
-- from one named person to another, and the filing and the data would
-- disagree with no trace.
--
-- NULL -> a crew member id is allowed, because that is how an entry gets
-- attributed in the first place. Anything after that is refused; a
-- misattributed entry is deleted and re-entered, which is what
-- deleteTimeEntry already does today.
--
-- Deliberately NOT covering "employeeUserId" in this migration. The same
-- argument applies to it and it should end up locked the same way, but that
-- would be a new restriction on a column with real production rows, in a
-- change whose whole point is to touch no existing behaviour. It is called
-- out in the report as the recommended follow-up.
CREATE OR REPLACE FUNCTION prova_time_entry_crew_member_lock() RETURNS trigger AS $$
BEGIN
  IF OLD."crewMemberId" IS NOT NULL
  AND NEW."crewMemberId" IS DISTINCT FROM OLD."crewMemberId"
  THEN
    RAISE EXCEPTION
      'TimeEntry.crewMemberId cannot be reassigned once set (id=%). Delete the entry and re-enter it.',
      OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "TimeEntry_crew_member_lock" ON "TimeEntry";
CREATE TRIGGER "TimeEntry_crew_member_lock"
BEFORE UPDATE ON "TimeEntry"
FOR EACH ROW EXECUTE FUNCTION prova_time_entry_crew_member_lock();
