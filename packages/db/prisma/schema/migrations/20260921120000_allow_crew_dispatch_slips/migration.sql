-- Allow a hiring-hall dispatch slip to name a crew member instead of a User,
-- and enforce the XOR: exactly one of employeeUserId / crewMemberId is set.
-- The same shape as 20260916130010_allow_crew_time_entries (#412).
--
-- ADDITIVE ONLY. Nothing is dropped or renamed: employeeUserId keeps its
-- column, its index and its foreign key, and is only loosened to nullable, so
-- the build still live during the deploy window (which reads employeeUserId)
-- keeps working against this schema. Every existing row has employeeUserId
-- NOT NULL and crewMemberId NULL, so the CHECK passes on today's data.

-- AlterTable
ALTER TABLE "DispatchSlip" ADD COLUMN     "crewMemberId" TEXT,
ALTER COLUMN "employeeUserId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "DispatchSlip_crewMemberId_idx" ON "DispatchSlip"("crewMemberId");

-- AddForeignKey
ALTER TABLE "DispatchSlip" ADD CONSTRAINT "DispatchSlip_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add the XOR constraint (a dispatch is for a User OR a crew member, not both,
-- not neither). Hand-written: Prisma cannot express a CHECK.
ALTER TABLE "DispatchSlip" ADD CONSTRAINT "DispatchSlip_employee_or_crew" CHECK (("employeeUserId" IS NOT NULL) <> ("crewMemberId" IS NOT NULL));
