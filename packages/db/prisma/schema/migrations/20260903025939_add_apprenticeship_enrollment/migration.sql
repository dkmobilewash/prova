-- CreateTable
CREATE TABLE "ApprenticeshipEnrollment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "apprenticeUserId" TEXT NOT NULL,
    "sponsorName" TEXT NOT NULL,
    "programNumber" TEXT,
    "craftClassificationId" TEXT,
    "unionLocalId" TEXT,
    "enrolledOn" TIMESTAMP(3) NOT NULL,
    "completedOn" TIMESTAMP(3),
    "cancelledOn" TIMESTAMP(3),
    "requiredOjtHoursPerPeriod" DECIMAL(7,2),
    "requiredClassroomHoursPerPeriod" DECIMAL(7,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeshipEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeshipPeriodRecord" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "classroomHours" DECIMAL(7,2),
    "signedOffOn" TIMESTAMP(3),
    "signedOffBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeshipPeriodRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprenticeshipEnrollment_companyId_idx" ON "ApprenticeshipEnrollment"("companyId");

-- CreateIndex
CREATE INDEX "ApprenticeshipEnrollment_apprenticeUserId_idx" ON "ApprenticeshipEnrollment"("apprenticeUserId");

-- CreateIndex
CREATE INDEX "ApprenticeshipPeriodRecord_enrollmentId_idx" ON "ApprenticeshipPeriodRecord"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeshipPeriodRecord_enrollmentId_periodNumber_key" ON "ApprenticeshipPeriodRecord"("enrollmentId", "periodNumber");

-- AddForeignKey
ALTER TABLE "ApprenticeshipEnrollment" ADD CONSTRAINT "ApprenticeshipEnrollment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeshipEnrollment" ADD CONSTRAINT "ApprenticeshipEnrollment_apprenticeUserId_fkey" FOREIGN KEY ("apprenticeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeshipEnrollment" ADD CONSTRAINT "ApprenticeshipEnrollment_craftClassificationId_fkey" FOREIGN KEY ("craftClassificationId") REFERENCES "CraftClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeshipEnrollment" ADD CONSTRAINT "ApprenticeshipEnrollment_unionLocalId_fkey" FOREIGN KEY ("unionLocalId") REFERENCES "UnionLocal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeshipPeriodRecord" ADD CONSTRAINT "ApprenticeshipPeriodRecord_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "ApprenticeshipEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
