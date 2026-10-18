-- The California wall-and-ceiling market as the state publishes it: every
-- CLEAR-licensed drywall/plaster/framing/insulation firm (CSLB's free files)
-- and what DIR says each is doing on public works (eCPR filings, project
-- listings). Read by the operating company only, for C Stream's own outbound.
-- Not company-scoped: these rows are about OTHER firms, never a tenant's data.
--
-- ADDITIVE ONLY: three new tables and one enum, no existing table touched.
-- `PublicWorksSignal.vendorKey` is unique so a re-pull inserts nothing twice —
-- idempotency is the database's job, not the sync's. Tier is never stored;
-- it is derived from signals at read time (lib/public-works/signals.ts).
-- CreateEnum
CREATE TYPE "PublicWorksSignalKind" AS ENUM ('ECPR_FILING', 'PROJECT_LISTING');

-- CreateTable
CREATE TABLE "PublicWorksFirm" (
    "licence" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT,
    "mailingAddress" TEXT,
    "city" TEXT,
    "county" TEXT,
    "zip" TEXT,
    "classes" TEXT[],
    "businessType" TEXT,
    "hasEmployees" BOOLEAN NOT NULL,
    "issuedOn" TIMESTAMP(3),
    "owners" JSONB NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicWorksFirm_pkey" PRIMARY KEY ("licence")
);

-- CreateTable
CREATE TABLE "PublicWorksSignal" (
    "id" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "kind" "PublicWorksSignalKind" NOT NULL,
    "vendorKey" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "awardingBody" TEXT,
    "primeContractor" TEXT,
    "occurredOn" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicWorksSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicWorksSyncSlice" (
    "key" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "rows" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "PublicWorksSyncSlice_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "PublicWorksFirm_county_idx" ON "PublicWorksFirm"("county");

-- CreateIndex
CREATE UNIQUE INDEX "PublicWorksSignal_vendorKey_key" ON "PublicWorksSignal"("vendorKey");

-- CreateIndex
CREATE INDEX "PublicWorksSignal_licence_occurredOn_idx" ON "PublicWorksSignal"("licence", "occurredOn");

-- CreateIndex
CREATE INDEX "PublicWorksSignal_kind_occurredOn_idx" ON "PublicWorksSignal"("kind", "occurredOn");

-- AddForeignKey
ALTER TABLE "PublicWorksSignal" ADD CONSTRAINT "PublicWorksSignal_licence_fkey" FOREIGN KEY ("licence") REFERENCES "PublicWorksFirm"("licence") ON DELETE CASCADE ON UPDATE CASCADE;

