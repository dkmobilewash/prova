/**
 * Is the shared union namespace ALREADY shared, or only shareable?
 *
 * READ-ONLY. Four SELECTs, no writes.
 *
 * Issue #136 finding 1: `UnionLocal`, `CraftClassification`,
 * `FringeRateSchedule` and `ApprenticeRatioRule` carry no `companyId`, and the
 * only access check is a self-asserted `CompanyUnionAgreement`. Whether that is
 * a live breach or a latent one depends on whether two companies have actually
 * landed on the same local, and the backfill that closes it depends on the same
 * answer.
 *
 * THE RULE THIS SCRIPT IS BUILT AROUND, learned by getting it wrong: a check
 * that cannot fail will report success, fast and confidently. The first version
 * of this file printed "NONE -> the backfill is single-valued. Build it." on a
 * database holding ONE company and ONE agreement, where the `HAVING
 * count(DISTINCT "companyId") > 1` it rests on is ARITHMETICALLY INCAPABLE of
 * returning a row. It also computed the scale that would have revealed that
 * AFTER printing the conclusion.
 *
 * So: scale is read FIRST, and every verdict below states the condition under
 * which it could have come out the other way and whether the data met it. A
 * verdict that could not have failed is reported as NOT ESTABLISHED, never as
 * good news.
 *
 * Prints the host it read, never the connection string, via the same
 * `describe()` every other script in this directory uses.
 *
 *   DATABASE_URL=... node scripts/union-tenancy-audit.mjs
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
console.log("union-audit: READ-ONLY — four SELECTs, no writes.\n");

const prisma = new PrismaClient();

/** Nothing here may quietly default to the reassuring value. */
function required(rows, column) {
  const value = rows?.[0]?.[column];
  if (value === undefined || value === null) {
    throw new Error(`the '${column}' count came back empty — the query did not answer, so nothing below is safe to read`);
  }
  return Number(value);
}

try {
  /* ---------------------------------------------------------------- scale --
   * FIRST, not last. Every verdict below is gated on these numbers, so they
   * cannot be read as a footnote to a conclusion already printed.
   *
   * `companiesWithAnyEdge` is the one that decides whether the collision query
   * could have fired at all, and it deliberately spans BOTH ways a company
   * reaches a local -- see the note on that query. */
  const scale = await prisma.$queryRaw`
    SELECT
      (SELECT count(*) FROM "UnionLocal")::int                                  AS locals,
      (SELECT count(*) FROM "CompanyUnionAgreement")::int                       AS agreements,
      (SELECT count(*) FROM "ApprenticeshipEnrollment"
         WHERE "unionLocalId" IS NOT NULL)::int                                 AS enrollments_naming_a_local,
      (SELECT count(DISTINCT "companyId") FROM (
         SELECT "companyId" FROM "CompanyUnionAgreement"
         UNION SELECT "companyId" FROM "ApprenticeshipEnrollment" WHERE "unionLocalId" IS NOT NULL
       ) e)::int                                                                AS companies_touching_a_local,
      (SELECT count(*) FROM "CraftClassification")::int                         AS crafts,
      (SELECT count(*) FROM "FringeRateSchedule")::int                          AS fringe_schedules,
      (SELECT count(*) FROM "ApprenticeRatioRule")::int                         AS apprentice_ratio_rules
  `;

  const locals = required(scale, "locals");
  const companiesTouching = required(scale, "companies_touching_a_local");
  const crafts = required(scale, "crafts");
  const fringe = required(scale, "fringe_schedules");
  const ratioRules = required(scale, "apprentice_ratio_rules");

  console.log("== scale, read FIRST so the verdicts below have a denominator ==");
  console.table(scale);
  console.log("");

  /* ------------------------------------------------------- 1. collisions --
   * A local reached by more than one company.
   *
   * TWO EDGES, NOT ONE. `CompanyUnionAgreement` is the obvious one and the only
   * one #136 mentions, but `ApprenticeshipEnrollment` also carries a companyId
   * AND a nullable unionLocalId -- and its writer takes that id straight out of
   * FormData (`lib/actions/apprenticeship.ts`). So a company can attach itself
   * to another company's local with no agreement row at all, and a query over
   * the agreement table alone would print NONE while it was happening. */
  const shared = await prisma.$queryRaw`
    WITH edges AS (
      SELECT "companyId", "unionLocalId" FROM "CompanyUnionAgreement"
      UNION
      SELECT "companyId", "unionLocalId" FROM "ApprenticeshipEnrollment" WHERE "unionLocalId" IS NOT NULL
    )
    SELECT e."unionLocalId",
           count(DISTINCT e."companyId")::int AS companies,
           l."parentInternational",
           l."localNumber"
    FROM edges e JOIN "UnionLocal" l ON l.id = e."unionLocalId"
    GROUP BY e."unionLocalId", l."parentInternational", l."localNumber"
    HAVING count(DISTINCT e."companyId") > 1
    ORDER BY 2 DESC
  `;

  console.log("== 1. locals reached by more than one company ==");
  if (shared.length > 0) {
    console.table(shared);
    console.log(`   ${shared.length} local(s) shared, across ${companiesTouching} companies.`);
    console.log("   -> DO NOT write a single-valued backfill. Each of these needs a");
    console.log("      decision first: a backfill picks a winner and the loser silently");
    console.log("      loses the wage rates its certified payroll is computed from.\n");
  } else if (companiesTouching < 2) {
    // The whole point of this branch. `HAVING count(DISTINCT companyId) > 1`
    // cannot return a row unless two companies hold edges, so with fewer than
    // two the empty result carries no information whatsoever.
    console.log("   NOT ESTABLISHED — this check could not have failed.");
    console.log(`   Only ${companiesTouching} compan${companiesTouching === 1 ? "y has" : "ies have"} any edge to a union local, and the`);
    console.log("   collision test needs at least 2 before it can return anything.");
    console.log("   An empty result here is arithmetic, not evidence.");
    console.log("   -> The backfill happens to be single-valued TODAY because there is");
    console.log("      barely any data, not because the model prevents sharing.\n");
  } else {
    console.log("   NONE — and this check could have failed:");
    console.log(`   ${companiesTouching} companies hold edges to locals, so a collision was reachable.`);
    console.log("   -> the backfill is single-valued as of this run.\n");
  }

  /* ---------------------------------------------------------- 2. orphans --
   * Locals no company has claimed. These have no company to backfill FROM,
   * which is what makes NOT NULL a question rather than a default. */
  const orphans = await prisma.$queryRaw`
    SELECT count(*)::int AS locals_with_no_edge
    FROM "UnionLocal" l
    WHERE NOT EXISTS (SELECT 1 FROM "CompanyUnionAgreement" a WHERE a."unionLocalId" = l.id)
      AND NOT EXISTS (SELECT 1 FROM "ApprenticeshipEnrollment" e WHERE e."unionLocalId" = l.id)
  `;
  const orphanCount = required(orphans, "locals_with_no_edge");

  console.log("== 2. locals no company has claimed ==");
  console.log(`   ${orphanCount} of ${locals}`);
  if (orphanCount > 0) {
    console.log("   -> a NOT NULL companyId would FAIL on these. Decide what an");
    console.log("      unclaimed local means before writing the constraint.\n");
  } else if (locals === 0) {
    console.log("   NOT ESTABLISHED — there are no locals at all, so 0 orphans is");
    console.log("   vacuous. It says nothing about whether NOT NULL is viable.\n");
  } else {
    console.log(`   -> every local has an owner across all ${locals} of them. NOT NULL is`);
    console.log("      viable on the data as it stands — re-run before you rely on it.\n");
  }

  /* ------------------------------------------------- 3. is there a leak --
   * The exposure is one contractor reading another's wage, pension, H&W and
   * training rates. Those live in CraftClassification/FringeRateSchedule, and
   * the destructive half of #136 deletes ApprenticeRatioRule by unionLocalId
   * alone -- so all three belong here, not just the two the first version
   * counted. */
  console.log("== 3. is there anything behind the hole yet ==");
  const exposed = crafts + fringe + ratioRules;
  if (exposed === 0) {
    console.log("   NOTHING. 0 craft classifications, 0 fringe rate schedules,");
    console.log("   0 apprentice ratio rules. The hole is real in code and there is");
    console.log("   no wage data on the other side of it today.");
    console.log("   -> lower live urgency, and the cheapest this migration will ever be.\n");
  } else {
    console.log(`   ${crafts} craft classification(s), ${fringe} fringe rate schedule(s),`);
    console.log(`   ${ratioRules} apprentice ratio rule(s) hang off shared locals.`);
    console.log("   -> real wage data is exposed by the shared namespace.\n");
  }

  /* ------------------------------------------------- the migration note --
   * Anyone acting on the above is about to add companyId to UnionLocal. The
   * constraint below is what makes that more than one line, and no amount of
   * counting rows would have told them. */
  console.log("== before you write the backfill ==");
  console.log("   `UnionLocal` carries @@unique([parentInternational, localNumber]).");
  console.log("   Adding companyId does NOT by itself let two contractors each hold");
  console.log("   'Carpenters / 300' — the second insert collides. That constraint has");
  console.log("   to become ([companyId, parentInternational, localNumber]) in the same");
  console.log("   migration, or the fix cannot express the case it exists for.");
  console.log("");
  console.log("   This is a SNAPSHOT. Re-run it immediately before writing the");
  console.log("   migration — every verdict above expires the moment anyone signs up.");
} catch (error) {
  // Never interpolate the connection string into an error path.
  console.error(`union-audit: FAILED — ${error?.message ?? "unknown error"}`);
  console.error("union-audit: no conclusion above is safe to read.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
