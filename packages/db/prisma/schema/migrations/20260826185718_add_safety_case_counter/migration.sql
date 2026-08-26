-- CreateTable
CREATE TABLE "SafetyCaseCounter" (
    "companyId" TEXT NOT NULL,
    "caseYear" INTEGER NOT NULL,
    "lastCaseNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyCaseCounter_pkey" PRIMARY KEY ("companyId","caseYear")
);

-- AddForeignKey
ALTER TABLE "SafetyCaseCounter" ADD CONSTRAINT "SafetyCaseCounter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the counter from cases that already exist so numbering continues.
INSERT INTO "SafetyCaseCounter" ("companyId", "caseYear", "lastCaseNumber", "updatedAt")
SELECT "companyId", "caseYear", MAX("caseNumber"), NOW()
FROM "SafetyIncident"
GROUP BY "companyId", "caseYear"
ON CONFLICT ("companyId", "caseYear") DO NOTHING;
