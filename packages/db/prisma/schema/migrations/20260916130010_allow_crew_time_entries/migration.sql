-- Allow an entry to name a crew member instead of a User, and enforce the
-- XOR: exactly one of employeeUserId / crewMemberId is set. Existing rows
-- all have employeeUserId NOT NULL and crewMemberId NULL, so the CHECK
-- passes on today's data; web writes keep that shape.

-- AlterTable
ALTER TABLE "TimeEntry" ALTER COLUMN "employeeUserId" DROP NOT NULL;

-- Add the XOR constraint (an hour is for a User OR a crew member, not both,
-- not neither).
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employee_or_crew" CHECK (("employeeUserId" IS NOT NULL) <> ("crewMemberId" IS NOT NULL));
