-- WHERE a site capture was taken: two coordinates and the radius they are
-- good to.
--
-- ADDITIVE ONLY. Three new nullable columns on an existing table. Nothing is
-- dropped, nothing becomes NOT NULL, no existing row is read or rewritten,
-- and no default is applied — every JobMedia row that exists today keeps
-- three NULLs and stays a completely ordinary row. There is nothing to
-- backfill and nothing that could be: a photo taken last month has no
-- recoverable position, and inventing the job's address as a stand-in would
-- put a coordinate on a record that was never located.
--
-- DOUBLE PRECISION rather than NUMERIC(9,6). The values are rounded to five
-- decimals by the application before they ever arrive (see
-- apps/web/lib/job-media-location.ts for why five), and a float64 represents
-- those exactly enough that no display ever shows a rounding artefact — a
-- latitude needs 7 significant digits and a double carries 15. NUMERIC would
-- be a second, weaker statement of a precision rule that already lives in
-- one tested function, and the two could disagree.
--
-- The two CHECKs below are hand-written, following the same precedent as
-- 20260905183000_add_crew_members and the EXCLUDE constraint in
-- 20260824171704_add_union_affiliation: Prisma's schema language cannot
-- express either of them, and both are invariants that would otherwise be
-- enforced only by whichever writer happened to remember. They are satisfied
-- by every existing row (all three columns NULL), so they can be added and
-- validated in the same statement without scanning anything meaningful.

-- AlterTable
ALTER TABLE "JobMedia" ADD COLUMN     "capturedAccuracyMeters" DOUBLE PRECISION,
ADD COLUMN     "capturedLatitude" DOUBLE PRECISION,
ADD COLUMN     "capturedLongitude" DOUBLE PRECISION;

-- Half a fix is not a fix.
--
-- A latitude without a longitude is not a degraded location, it is a number
-- that cannot be plotted, cannot be linked to a map and cannot be filtered
-- on honestly — and "has a location" is a question `/photos` answers by
-- testing ONE of these columns, so a half-written row would make that answer
-- wrong rather than incomplete. The accuracy is bound to the pair for the
-- same reason in reverse: a radius with no centre describes nothing.
ALTER TABLE "JobMedia" ADD CONSTRAINT "JobMedia_captured_location_pairing"
CHECK (
  ("capturedLatitude" IS NULL) = ("capturedLongitude" IS NULL)
  AND ("capturedAccuracyMeters" IS NULL OR "capturedLatitude" IS NOT NULL)
);

-- A coordinate that is not on Earth.
--
-- The application refuses these already, in the one pure function both
-- writers share. This is the copy that survives a writer that forgets to
-- call it — including the next one, which does not exist yet. The accuracy
-- bound is `> 0` rather than `>= 0`: the Geolocation API defines it as a
-- 95%-confidence radius, and a radius of zero is a claim of certainty that
-- no positioning system makes.
ALTER TABLE "JobMedia" ADD CONSTRAINT "JobMedia_captured_location_range"
CHECK (
  ("capturedLatitude" IS NULL OR ("capturedLatitude" >= -90 AND "capturedLatitude" <= 90))
  AND ("capturedLongitude" IS NULL OR ("capturedLongitude" >= -180 AND "capturedLongitude" <= 180))
  AND ("capturedAccuracyMeters" IS NULL OR "capturedAccuracyMeters" > 0)
);
