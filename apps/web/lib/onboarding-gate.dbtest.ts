import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";

/**
 * The backfill migration, against a real database — the half
 * `lib/onboarding-gate.test.ts` cannot reach, since that file mocks
 * everything and never touches SQL.
 *
 * `shouldGateToOnboarding`'s whole "existing companies are never
 * redirected" guarantee rests on migration
 * `20260921000000_backfill_business_scope_asked_at` actually running the
 * way its own comment says it does. Reading the migration's SQL straight
 * off disk and executing it here — rather than re-typing the UPDATE
 * statement in this file — is deliberate: a second, hand-written copy of
 * the same SQL could drift from the real migration and still pass, which
 * is exactly the "written, documented, and never called" shape CLAUDE.md
 * warns about, one level removed (here it would be "tested against the
 * wrong SQL" rather than "never tested at all").
 *
 * NOT RUN BY THIS SESSION — CLAUDE.md: "You cannot run the dbtest suite
 * locally; do not claim it passes." Written to the same shape as the
 * dbtests beside it and left for CI / the next session with a scratch
 * Postgres to execute.
 */

const migrationSql = readFileSync(
  fileURLToPath(
    new URL(
      "../../../packages/db/prisma/schema/migrations/20260921000000_backfill_business_scope_asked_at/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

let existingCompanyId = "";
let stillUnansweredCompanyId = "";
let alreadyAnsweredCompanyId = "";

describe("the businessScopeAskedAt backfill migration, against a real database", () => {
  beforeAll(async () => {
    // A company that predates this feature: null before the migration,
    // same as every row in production the day this ships.
    const existing = await prisma.company.create({
      data: { name: "Backfill Test — Existing Company", createdAt: new Date("2026-01-15T00:00:00.000Z") },
    });
    existingCompanyId = existing.id;

    // A company that ALREADY answered before this migration ran — proves
    // the migration does not clobber a real answer with its createdAt.
    const alreadyAnswered = await prisma.company.create({
      data: {
        name: "Backfill Test — Already Answered",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        businessScopeAskedAt: new Date("2026-03-01T00:00:00.000Z"),
        contractingRelationship: "BOTH",
      },
    });
    alreadyAnsweredCompanyId = alreadyAnswered.id;

    // Run the migration's own SQL, read off disk, not retyped.
    await prisma.$executeRawUnsafe(migrationSql);

    // A company created AFTER the migration ran — the case that must stay
    // null, since it is genuinely new and has not been asked yet.
    const stillUnanswered = await prisma.company.create({
      data: { name: "Backfill Test — Created After Migration" },
    });
    stillUnansweredCompanyId = stillUnanswered.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({
      where: { id: { in: [existingCompanyId, stillUnansweredCompanyId, alreadyAnsweredCompanyId] } },
    });
  });

  it("backfills a pre-existing company's businessScopeAskedAt to its own createdAt", async () => {
    const after = await prisma.company.findUniqueOrThrow({ where: { id: existingCompanyId } });
    expect(after.businessScopeAskedAt).toEqual(after.createdAt);
    expect(after.businessScopeAskedAt).toEqual(new Date("2026-01-15T00:00:00.000Z"));
    // And the three answers themselves stay null — this migration is a
    // "stop asking" stamp, never a fabricated answer.
    expect(after.contractingRelationship).toBeNull();
    expect(after.doesPublicWork).toBeNull();
    expect(after.filesMonthlyPayApps).toBeNull();
  });

  it("leaves a company that had already answered untouched", async () => {
    const after = await prisma.company.findUniqueOrThrow({ where: { id: alreadyAnsweredCompanyId } });
    expect(after.businessScopeAskedAt).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    expect(after.contractingRelationship).toBe("BOTH");
  });

  it("leaves a company created AFTER the migration ran genuinely null — it has not been asked yet", async () => {
    const after = await prisma.company.findUniqueOrThrow({ where: { id: stillUnansweredCompanyId } });
    expect(after.businessScopeAskedAt).toBeNull();
  });

  it("shouldGateToOnboarding agrees with the migration's own intent on all three rows", async () => {
    const { shouldGateToOnboarding } = await import("./onboarding-gate");
    const [existing, alreadyAnswered, stillUnanswered] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: existingCompanyId } }),
      prisma.company.findUniqueOrThrow({ where: { id: alreadyAnsweredCompanyId } }),
      prisma.company.findUniqueOrThrow({ where: { id: stillUnansweredCompanyId } }),
    ]);
    expect(shouldGateToOnboarding({ role: "OWNER", businessScopeAskedAt: existing.businessScopeAskedAt })).toBe(
      false,
    );
    expect(
      shouldGateToOnboarding({ role: "OWNER", businessScopeAskedAt: alreadyAnswered.businessScopeAskedAt }),
    ).toBe(false);
    expect(
      shouldGateToOnboarding({ role: "OWNER", businessScopeAskedAt: stillUnanswered.businessScopeAskedAt }),
    ).toBe(true);
  });
});
