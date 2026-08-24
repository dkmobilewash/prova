-- CreateEnum
CREATE TYPE "JurisdictionType" AS ENUM ('STATE', 'COUNTY', 'CITY');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'PENDING', 'INACTIVE');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "dbaName" TEXT,
ADD COLUMN     "ein" TEXT,
ADD COLUMN     "hqAddressLine1" TEXT,
ADD COLUMN     "hqAddressLine2" TEXT,
ADD COLUMN     "hqCity" TEXT,
ADD COLUMN     "hqState" TEXT,
ADD COLUMN     "hqZip" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "CompanyLicense" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jurisdictionType" "JurisdictionType" NOT NULL,
    "jurisdictionName" TEXT NOT NULL,
    "classificationCode" TEXT,
    "classificationLabel" TEXT,
    "licenseNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "bondNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseClassificationReference" (
    "id" TEXT NOT NULL,
    "jurisdictionName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseClassificationReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyLicense_companyId_idx" ON "CompanyLicense"("companyId");

-- CreateIndex
CREATE INDEX "CompanyLicense_expirationDate_idx" ON "CompanyLicense"("expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseClassificationReference_jurisdictionName_code_key" ON "LicenseClassificationReference"("jurisdictionName", "code");

-- AddForeignKey
ALTER TABLE "CompanyLicense" ADD CONSTRAINT "CompanyLicense_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed LicenseClassificationReference with the verified CA/AZ/UT codes.
-- Nevada is deliberately NOT seeded here -- the exact NAC 624 subclassification
-- wasn't available from a public source at build time; that jurisdiction stays
-- free-text in CompanyLicense until someone does the real lookup. Colorado has
-- no state classification system at all (municipal licensing only), so it
-- never gets rows here either. ON CONFLICT makes this safe to re-run.
INSERT INTO "LicenseClassificationReference" ("id", "jurisdictionName", "code", "label", "createdAt") VALUES
  ('lcr_ca_c9',  'California', 'C-9',  'Drywall', CURRENT_TIMESTAMP),
  ('lcr_ca_c35', 'California', 'C-35', 'Lathing and Plastering', CURRENT_TIMESTAMP),
  ('lcr_ca_c2',  'California', 'C-2',  'Insulation and Acoustical', CURRENT_TIMESTAMP),
  ('lcr_ca_c33', 'California', 'C-33', 'Painting and Decorating', CURRENT_TIMESTAMP),
  ('lcr_az_r10',  'Arizona', 'R-10',  'Drywall - Residential', CURRENT_TIMESTAMP),
  ('lcr_az_c10',  'Arizona', 'C-10',  'Drywall - Commercial', CURRENT_TIMESTAMP),
  ('lcr_az_cr10', 'Arizona', 'CR-10', 'Drywall - Dual (Residential/Commercial)', CURRENT_TIMESTAMP),
  ('lcr_az_r36',  'Arizona', 'R-36',  'Plastering/Stucco - Residential', CURRENT_TIMESTAMP),
  ('lcr_az_c36',  'Arizona', 'C-36',  'Plastering/Stucco - Commercial', CURRENT_TIMESTAMP),
  ('lcr_az_cr36', 'Arizona', 'CR-36', 'Plastering/Stucco - Dual (Residential/Commercial)', CURRENT_TIMESTAMP),
  ('lcr_az_r1',   'Arizona', 'R-1',   'Acoustical Ceilings - Residential', CURRENT_TIMESTAMP),
  ('lcr_az_c1',   'Arizona', 'C-1',   'Acoustical Ceilings - Commercial', CURRENT_TIMESTAMP),
  ('lcr_az_cr1',  'Arizona', 'CR-1',  'Acoustical Ceilings - Dual (Residential/Commercial)', CURRENT_TIMESTAMP),
  ('lcr_az_r16',  'Arizona', 'R-16',  'Fire Protection - Residential', CURRENT_TIMESTAMP),
  ('lcr_az_c16',  'Arizona', 'C-16',  'Fire Protection - Commercial', CURRENT_TIMESTAMP),
  ('lcr_az_cr16', 'Arizona', 'CR-16', 'Fire Protection - Dual (Residential/Commercial)', CURRENT_TIMESTAMP),
  ('lcr_ut_s270', 'Utah', 'S270', 'Drywall, Painting, Plastering & Insulation (combined)', CURRENT_TIMESTAMP)
ON CONFLICT ("jurisdictionName", "code") DO NOTHING;

