/**
 * Do the union tables still agree with themselves about who owns what?
 *
 * READ-ONLY. Two SELECTs, no writes. Exits non-zero if an invariant is broken,
 * so a scheduled run fails loudly rather than printing something nobody reads.
 *
 * WHAT THIS FILE USED TO BE, AND WHY IT IS NOT THAT ANY MORE. It was written to
 * answer an open question from issue #136 finding 1: `UnionLocal`,
 * `CraftClassification`, `FringeRateSchedule` and `ApprenticeRatioRule` carried
 * no `companyId`, so any company could claim any local by typing its public
 * number. The question was whether that had already happened, because the
 * backfill that closes it could only be written once somebody knew.
 *
 * That question is ANSWERED and the hole is CLOSED. Migration
 * `20260907191702_union_tenancy_companyid` (#200) added `companyId` to all four
 * tables, backfilled them, made them NOT NULL, and replaced
 * `@@unique([parentInternational, localNumber])` with
 * `@@unique([companyId, parentInternational, localNumber])`, so two contractors
 * signatory to the same real local now hold their own rows. The advisory
 * version of this script survived that merge by six commits still telling its
 * reader to make a change that was already made -- which is why it is rewritten
 * rather than deleted: the question changed from "should we fix this" to "is it
 * still fixed", and the second question never stops needing an answer.
 *
 * WHAT IS ACTUALLY WORTH CHECKING. Nearly everything the migration established
 * is now enforced by Postgres: `companyId` is NOT NULL with a foreign key on
 * every one of those tables. Asserting any of that would be a check that cannot
 * fail, which is the defect this file has been rewritten twice to stop
 * committing.
 *
 * What Postgres does NOT enforce is that a row's `companyId` AGREES with the
 * `companyId` of the parent it points at. The migration denormalised the column
 * onto children -- `CraftClassification` carries one, and so does the
 * `UnionLocal` it belongs to -- and there is no CHECK, no trigger and no
 * composite foreign key tying the two together. Verified: the migration
 * contains zero of them. So a write path that sets one and forgets the other
 * creates a row filed under company A hanging off company B's local, silently,
 * with every constraint satisfied. That is issue #136 coming back through the
 * denormalisation introduced to fix it, and it is exactly the hazard CLAUDE.md
 * names when it says derived state is never stored.
 *
 * Six such pairs exist. This checks all six.
 *
 *   DATABASE_URL=... node scripts/union-tenancy-audit.mjs
 */

import { PrismaClient } from "@prisma/client";
import { loadEnvFiles } from "./load-env.mjs";
import { describe } from "./connection-target.mjs";

loadEnvFiles();

const target = describe(process.env.DATABASE_URL);
if (!target) {
  console.error("union-tenancy: DATABASE_URL is not set or is unparseable. Nothing was read.");
  process.exit(1);
}
console.log(`union-tenancy: database   ${target.label}`);
console.log(`union-tenancy: endpoint   ${target.endpointId ?? "(not a Neon host)"}`);
console.log("union-tenancy: READ-ONLY — two SELECTs, no writes.\n");

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
  /* Read FIRST, so every verdict below has a denominator and none of them is
   * printed before the numbers that decide whether it could have failed. */
  const scale = await prisma.$queryRaw`
    SELECT
      (SELECT count(*) FROM "Company")::int                                    AS companies,
      (SELECT count(*) FROM "UnionLocal")::int                                 AS locals,
      (SELECT count(*) FROM "CraftClassification")::int                        AS crafts,
      (SELECT count(*) FROM "FringeRateSchedule")::int                         AS fringe_schedules,
      (SELECT count(*) FROM "ApprenticeRatioRule")::int                        AS ratio_rules,
      (SELECT count(*) FROM "CompanyUnionAgreement")::int                      AS agreements,
      (SELECT count(*) FROM "ApprenticeshipEnrollment")::int                   AS enrollments
  `;
  const companies = required(scale, "companies");
  const rowsUnderCheck =
    required(scale, "crafts") + required(scale, "fringe_schedules") + required(scale, "ratio_rules") +
    required(scale, "agreements") + required(scale, "enrollments");

  console.log("== scale ==");
  console.table(scale);
  console.log("");

  /* The six denormalised pairs. Each counts rows whose own companyId disagrees
   * with the companyId of the parent it points at. The two enrollment joins are
   * inner joins on nullable columns on purpose: an enrollment naming no local
   * or no craft cannot disagree with one. */
  const drift = await prisma.$queryRaw`
    SELECT
      (SELECT count(*) FROM "CraftClassification" c
         JOIN "UnionLocal" u ON u.id = c."unionLocalId"
        WHERE c."companyId" <> u."companyId")::int                             AS craft_vs_local,
      (SELECT count(*) FROM "FringeRateSchedule" f
         JOIN "CraftClassification" c ON c.id = f."craftClassificationId"
        WHERE f."companyId" <> c."companyId")::int                             AS fringe_vs_craft,
      (SELECT count(*) FROM "ApprenticeRatioRule" r
         JOIN "UnionLocal" u ON u.id = r."unionLocalId"
        WHERE r."companyId" <> u."companyId")::int                             AS ratio_rule_vs_local,
      (SELECT count(*) FROM "CompanyUnionAgreement" a
         JOIN "UnionLocal" u ON u.id = a."unionLocalId"
        WHERE a."companyId" <> u."companyId")::int                             AS agreement_vs_local,
      (SELECT count(*) FROM "ApprenticeshipEnrollment" e
         JOIN "UnionLocal" u ON u.id = e."unionLocalId"
        WHERE e."companyId" <> u."companyId")::int                             AS enrollment_vs_local,
      (SELECT count(*) FROM "ApprenticeshipEnrollment" e
         JOIN "CraftClassification" c ON c.id = e."craftClassificationId"
        WHERE e."companyId" <> c."companyId")::int                             AS enrollment_vs_craft
  `;

  const PAIRS = [
    ["craft_vs_local", "CraftClassification", "the UnionLocal it belongs to"],
    ["fringe_vs_craft", "FringeRateSchedule", "the CraftClassification it belongs to"],
    ["ratio_rule_vs_local", "ApprenticeRatioRule", "the UnionLocal it belongs to"],
    ["agreement_vs_local", "CompanyUnionAgreement", "the UnionLocal it names"],
    ["enrollment_vs_local", "ApprenticeshipEnrollment", "the UnionLocal it names"],
    ["enrollment_vs_craft", "ApprenticeshipEnrollment", "the CraftClassification it names"],
  ];

  const broken = PAIRS.map(([column, child, parent]) => ({
    child,
    parent,
    rows: required(drift, column),
  })).filter((pair) => pair.rows > 0);

  console.log("== cross-tenant rows: a companyId that disagrees with its parent's ==");
  if (broken.length > 0) {
    for (const pair of broken) {
      console.log(`   BROKEN  ${pair.rows} ${pair.child} row(s) filed under a different company than ${pair.parent}.`);
    }
    console.log("");
    console.log("   Every constraint in the database is satisfied and the data is still");
    console.log("   wrong: nothing ties a child's companyId to its parent's. Find the write");
    console.log("   path that set one without the other before repairing rows, or it will");
    console.log("   refill behind you.");
    process.exitCode = 1;
  } else if (companies < 2) {
    // The point of this branch. With one company every row in the database
    // carries the same companyId, so `<>` cannot match and a clean result is
    // arithmetic rather than evidence.
    console.log("   NOT ESTABLISHED — this check could not have failed.");
    console.log(`   There ${companies === 1 ? "is 1 company" : `are ${companies} companies`} in this database, so every row carries the same`);
    console.log("   companyId and no pair can disagree. A second tenant is what makes");
    console.log("   this check mean anything.");
  } else if (rowsUnderCheck === 0) {
    console.log("   NOT ESTABLISHED — there are no union rows to check.");
    console.log(`   ${companies} companies exist, but no craft, schedule, ratio rule,`);
    console.log("   agreement or enrollment does, so nothing could have disagreed.");
  } else {
    console.log("   HOLDS. All six parent/child companyId pairs agree, across");
    console.log(`   ${rowsUnderCheck} row(s) spanning ${companies} companies — so a disagreement was`);
    console.log("   reachable and none is present.");
  }
  console.log("");
  console.log("   Checked: CraftClassification/UnionLocal, FringeRateSchedule/CraftClassification,");
  console.log("   ApprenticeRatioRule/UnionLocal, CompanyUnionAgreement/UnionLocal, and");
  console.log("   ApprenticeshipEnrollment against both the local and the craft it names.");
} catch (error) {
  // Never interpolate the connection string into an error path.
  console.error(`union-tenancy: FAILED — ${error?.message ?? "unknown error"}`);
  console.error("union-tenancy: no verdict above is safe to read.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
