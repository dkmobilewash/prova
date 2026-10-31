-- AlterTable: the list of what went into a submittal package (file names and
-- page counts). Additive and nullable; the package itself is never stored.
ALTER TABLE "SubmittalRevision" ADD COLUMN "packageContents" JSONB;
