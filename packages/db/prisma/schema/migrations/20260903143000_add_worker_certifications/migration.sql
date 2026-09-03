-- CreateEnum
CREATE TYPE "CertificationKind" AS ENUM ('OSHA_10', 'OSHA_30', 'SCAFFOLD_COMPETENT_PERSON', 'SCAFFOLD_USER', 'AERIAL_LIFT', 'POWERED_INDUSTRIAL_TRUCK', 'FALL_PROTECTION', 'SILICA_AWARENESS', 'RESPIRATOR_FIT_TEST', 'RESPIRATOR_MEDICAL_EVALUATION', 'HEARING_CONSERVATION', 'FIRST_AID_CPR', 'HOT_WORK', 'CONFINED_SPACE', 'HAZARD_COMMUNICATION', 'SITE_ORIENTATION', 'OTHER');

-- CreateTable
CREATE TABLE "WorkerCertification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "holderUserId" TEXT NOT NULL,
    "kind" "CertificationKind" NOT NULL,
    "otherLabel" TEXT,
    "issuer" TEXT,
    "referenceNumber" TEXT,
    "issuedOn" TIMESTAMP(3),
    "expiresOn" TIMESTAMP(3),
    "notes" TEXT,
    "documentUrl" TEXT,
    "documentLabel" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificationRequirement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "CertificationKind" NOT NULL,
    "otherLabel" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificationRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerCertification_companyId_idx" ON "WorkerCertification"("companyId");

-- CreateIndex
CREATE INDEX "WorkerCertification_holderUserId_idx" ON "WorkerCertification"("holderUserId");

-- CreateIndex
CREATE INDEX "WorkerCertification_expiresOn_idx" ON "WorkerCertification"("expiresOn");

-- CreateIndex
CREATE INDEX "CertificationRequirement_companyId_idx" ON "CertificationRequirement"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificationRequirement_companyId_kind_otherLabel_key" ON "CertificationRequirement"("companyId", "kind", "otherLabel");

-- AddForeignKey
ALTER TABLE "WorkerCertification" ADD CONSTRAINT "WorkerCertification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCertification" ADD CONSTRAINT "WorkerCertification_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCertification" ADD CONSTRAINT "WorkerCertification_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationRequirement" ADD CONSTRAINT "CertificationRequirement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
