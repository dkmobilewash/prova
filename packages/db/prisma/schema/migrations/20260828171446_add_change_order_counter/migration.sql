-- CreateTable
CREATE TABLE "ChangeOrderCounter" (
    "jobId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeOrderCounter_pkey" PRIMARY KEY ("jobId")
);

-- AddForeignKey
ALTER TABLE "ChangeOrderCounter" ADD CONSTRAINT "ChangeOrderCounter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed from the change orders that already exist. Without this, a job that
-- already has CO #1..#3 would start issuing from 1 again and collide with
-- the @@unique([jobId, number]) constraint on the very next change order.
-- Same seeding step SafetyCaseCounter needed for the same reason.
INSERT INTO "ChangeOrderCounter" ("jobId", "lastNumber", "updatedAt")
SELECT "jobId", MAX("number"), now()
FROM "ChangeOrder"
GROUP BY "jobId";
