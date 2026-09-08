import { describe, expect, it } from "vitest";
import type { Prisma, TimeEntry, CrewMember } from "@prova/db";

/**
 * The regression test for the CrewMember change — and the only one of its
 * tests that runs in CI.
 *
 * What actually threatens certified payroll here is not arithmetic. It is
 * the SHAPE of TimeEntry. Every module that names a worker on a filing does
 * the same two things:
 *
 *   entry.employeeUserId                                  // groups the rows
 *   entry.employeeUser.name ?? entry.employeeUser.email   // names the person
 *
 * — in lib/certified-payroll-query.ts, lib/certified-payroll.ts,
 * lib/prevailing-wage-query.ts, lib/union-compliance-query.ts,
 * lib/apprenticeship-query.ts and app/(app)/jobs/[id]/page.tsx:1054. All of
 * them dereference `employeeUser` WITHOUT a null check, because the column
 * is NOT NULL. The day `employeeUserId` becomes nullable, every one of them
 * is a type error, and the ones that are not are printing "undefined" on a
 * government form.
 *
 * So this file pins the shape rather than the output. The assertions below
 * are compile-time: `pnpm typecheck` is what fails if the schema drifts,
 * and vitest is here so the failure also shows up in the suite where a
 * human is looking. A runtime assertion could not catch this at all — the
 * types are erased by the time a test runs.
 *
 * If a future change makes `employeeUserId` nullable ON PURPOSE — which is
 * the planned follow-up, see the migration — this file is expected to fail.
 * Update it in that same commit, together with the six read paths. That is
 * the point: it makes the change impossible to land quietly.
 */

// The standard "exactly equal" type check. A plain `extends` would let
// `string` pass for `string | null`, which is the exact widening being
// guarded against.
type Equals<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

// --- unchanged by this migration -------------------------------------------

type _EmployeeUserIdIsStillRequired = Assert<Equals<TimeEntry["employeeUserId"], string>>;

/** The include every read path uses. `employeeUser` must be `User`, never
 * `User | null` — this is the type that certified payroll dereferences. */
type WithEmployee = Prisma.TimeEntryGetPayload<{ include: { employeeUser: true } }>;
type _EmployeeUserIsNonNullable = Assert<Equals<WithEmployee["employeeUser"], NonNullable<WithEmployee["employeeUser"]>>>;

// --- added by this migration, and optional everywhere ----------------------

type _CrewMemberIdIsOptional = Assert<Equals<TimeEntry["crewMemberId"], string | null>>;

type WithCrew = Prisma.TimeEntryGetPayload<{ include: { crewMember: true } }>;
type _CrewMemberRelationIsOptional = Assert<Equals<WithCrew["crewMember"], CrewMember | null>>;

/** The identity fields a WH-347 names. Required so a crew record cannot
 * exist without a name; the last-four identifier is optional because a crew
 * member is worth recording before payroll has sent it over. */
type _LegalFirstNameRequired = Assert<Equals<CrewMember["legalFirstName"], string>>;
type _LegalLastNameRequired = Assert<Equals<CrewMember["legalLastName"], string>>;
type _MiddleNameOptional = Assert<Equals<CrewMember["legalMiddleName"], string | null>>;
type _IdentifyingNumberOptional = Assert<Equals<CrewMember["identifyingNumberLast4"], string | null>>;
type _LinkedUserIdOptional = Assert<Equals<CrewMember["linkedUserId"], string | null>>;
type _ArchivedAtOptional = Assert<Equals<CrewMember["archivedAt"], Date | null>>;

/** There is deliberately NO column for a full SSN. `keyof` is the check,
 * because "we did not add it" is not something a person notices missing. */
type _NoFullSsnColumn = Assert<Equals<Extract<keyof CrewMember, "ssn" | "socialSecurityNumber" | "taxId">, never>>;

describe("TimeEntry keeps the shape certified payroll depends on", () => {
  it("compiles — the assertions above are what this test is", () => {
    // Every assertion in this file is a type. `pnpm typecheck` is the
    // assertion runner; this body exists so the file appears in the suite.
    const proof: _EmployeeUserIdIsStillRequired &
      _EmployeeUserIsNonNullable &
      _CrewMemberIdIsOptional &
      _CrewMemberRelationIsOptional &
      _LegalFirstNameRequired &
      _LegalLastNameRequired &
      _MiddleNameOptional &
      _IdentifyingNumberOptional &
      _LinkedUserIdOptional &
      _ArchivedAtOptional &
      _NoFullSsnColumn = true;
    expect(proof).toBe(true);
  });

  it("still lists exactly the time-entry columns the CSV export names", async () => {
    // The export enumerates its columns by hand, so a new column must NOT
    // silently appear in a customer's download. crewMemberId is not in the
    // list, and this pins that until the wiring commit adds it deliberately.
    const { EXPORT_DATASETS } = await import("./export");
    const timeEntries = EXPORT_DATASETS.find((d) => d.key === "time-entries");
    expect(timeEntries?.columns).toEqual([
      "id",
      "jobId",
      "lineItemId",
      "employeeUserId",
      "craftClassificationId",
      "date",
      "hours",
      "payType",
      "perDiemAmount",
      "travelPayAmount",
      "note",
      "createdAt",
    ]);
  });
});
