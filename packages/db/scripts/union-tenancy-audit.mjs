/**
 * Is the shared union namespace ALREADY shared, or only shareable?
 *
 * READ-ONLY. This script issues three SELECTs and writes nothing. It exists
 * because issue #136 finding 1 turns on a question nobody could answer:
 * `UnionLocal`, `CraftClassification`, `FringeRateSchedule` and
 * `ApprenticeRatioRule` carry no `companyId`, and the only access check is
 * a self-asserted `CompanyUnionAgreement`. Whether that is a live breach or
 * a latent one depends on whether two companies have actually landed on the
 * same local, and the fix depends on it too:
 *
 *   - no local shared by two companies  -> the `companyId` backfill is
 *     single-valued and can be written in an afternoon;
 *   - any local shared                  -> those rows need a decision before
 *     a migration exists, because a backfill would have to pick a winner and
 *     the loser silently loses its wage rates.
 *
 * Question 2, which the migration ALSO turns on and which #136 did not ask:
 * a local with no agreement row at all has no company to backfill from. A
 * `NOT NULL companyId` would decide that case by crashing the migration,
 * which is the one outcome that tells you nothing — so it is counted here
 * while the counting is free.
 *
 * Prints the host it read, never the connection string, via the same
 * `describe()` every other script in this directory uses.
 *
 *   DATABASE_URL=... node scripts/union-tenancy-audit.mjs
 *
 * Diego is the only person who can point this at `ep-little-sea`; Cyrus's
 * .env resolves to `ep-icy-hat` and will answer about his own data, which is
 * a useful smoke test of the script and not an answer to the question.
 */

import { PrismaClient } from "@prisma/client";
import { loadEnvFiles } from "./load-env.mjs";
import { describe } from "./connection-target.mjs";

loadEnvFiles();

const target = describe(process.env.DATABASE_URL);
if (!target) {
  console.error("union-audit: DATABASE_URL is not set or is unparseable. Nothing was read.");
  process.exit(1);
}
console.log(`union-audit: database   ${target.label}`);
console.log(`union-audit: endpoint   ${target.endpointId ?? "(not a Neon host)"}`);
console.log("union-audit: READ-ONLY — three SELECTs, no writes.\n");

const prisma = new PrismaClient();

try {
  // 1. THE QUERY FROM #136. A local named by more than one company is the
  //    shared namespace actually being shared.
  const shared = await prisma.$queryRaw`
    SELECT "unionLocalId", count(DISTINCT "companyId")::int AS companies
    FROM "CompanyUnionAgreement"
    GROUP BY 1
    HAVING count(DISTINCT "companyId") > 1
    ORDER BY 2 DESC
  `;

  console.log("== 1. locals claimed by more than one company ==");
  if (shared.length === 0) {
    console.log("   NONE.");
    console.log("   -> the companyId backfill is single-valued. Build it.\n");
  } else {
    console.table(shared);
    console.log(`   ${shared.length} local(s) shared. Every one is a company reading`);
    console.log("   another company's wage, pension, H&W and training rates today.");
    console.log("   -> these need a decision BEFORE a migration exists.\n");
  }

  // 2. Locals nobody has claimed. These have no company to backfill from,
  //    which is what makes NOT NULL a question rather than a default.
  const orphans = await prisma.$queryRaw`
    SELECT count(*)::int AS locals_with_no_agreement
    FROM "UnionLocal" l
    WHERE NOT EXISTS (
      SELECT 1 FROM "CompanyUnionAgreement" a WHERE a."unionLocalId" = l.id
    )
  `;
  const orphanCount = orphans[0]?.locals_with_no_agreement ?? 0;
  console.log("== 2. locals with NO agreement row ==");
  console.log(`   ${orphanCount}`);
  console.log(
    orphanCount === 0
      ? "   -> every local has an owner. NOT NULL is viable on the backfill.\n"
      : "   -> NOT NULL would fail on these. Decide what they mean before writing it.\n",
  );

  // 3. Scale, so the two numbers above have something to be read against.
  const totals = await prisma.$queryRaw`
    SELECT
      (SELECT count(*) FROM "UnionLocal")::int              AS locals,
      (SELECT count(*) FROM "CompanyUnionAgreement")::int    AS agreements,
      (SELECT count(DISTINCT "companyId") FROM "CompanyUnionAgreement")::int AS companies,
      (SELECT count(*) FROM "CraftClassification")::int      AS crafts,
      (SELECT count(*) FROM "FringeRateSchedule")::int       AS fringe_schedules
  `;
  console.log("== 3. scale ==");
  console.table(totals);
} catch (error) {
  // Never interpolate the connection string into an error path.
  console.error(`union-audit: query failed — ${error?.message ?? "unknown error"}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
