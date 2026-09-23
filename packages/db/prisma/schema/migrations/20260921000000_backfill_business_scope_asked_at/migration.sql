-- Data-only backfill, no schema change. See apps/web/lib/onboarding-gate.ts
-- for the rule this exists to make true: `businessScopeAskedAt IS NULL`
-- means "created after this shipped and never asked", not merely "the
-- three onboarding questions have no answer on file." Before this
-- migration both cases produced the same null, which would have sent
-- every pre-existing company's owner to the full-page onboarding gate the
-- next time they opened the app — exactly the "existing companies must
-- never be redirected" regression this backfill exists to prevent.
--
-- Backfilled to "createdAt" rather than a shared NOW(): each row gets its
-- own company's signup date, so this reads as a fact about when the
-- company joined, not a single timestamp for whoever happened to deploy
-- this migration. The WHERE clause is what makes it safe to re-run: a
-- company created between this migration running and the next request is
-- unaffected either way, since its own INSERT happens after this UPDATE
-- and its businessScopeAskedAt correctly starts (and stays) NULL.
UPDATE "Company"
SET "businessScopeAskedAt" = "createdAt"
WHERE "businessScopeAskedAt" IS NULL;
