import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * One injury must produce one OSHA case (#111).
 *
 * `createSafetyIncident` had no barrier against being run twice. The
 * schema's only relevant constraint is
 * `@@unique([companyId, caseYear, caseNumber])`, and the counter hands the
 * second run a FRESH number — so the duplicate is unique by construction
 * and the database has no reason to refuse it. One injury becomes two
 * recordable cases in the count a GC reads at prequalification.
 *
 * Cleaning it up afterwards is worse than leaving it. `SafetyCaseCounter`
 * only ever increments, deliberately, so deleting the duplicate retires
 * its number for good — and the filed log then has a gap in the sequence
 * with nothing on the document to explain it.
 *
 * These assert on ROWS and on the counter, because neither is visible in a
 * return value: this action returns void, so a run that filed a second
 * case and a run that refused to look identical from the caller.
 */

let db = new FakeDb();
const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    return db.client();
  },
}));

const { createSafetyIncident } = await import("./safety");

/** One report of one injury, exactly as the form submits it. */
function report(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    occurredAt: "2026-08-14",
    employeeName: "Marco Ruiz",
    jobTitle: "Framer",
    location: "3rd floor east corridor",
    description: "Fell from a stilt walking backwards over a track offcut.",
    classification: "INJURY",
    outcome: "DAYS_AWAY",
    daysAway: "3",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function incidents() {
  return db.rows("safetyIncident");
}

function caseNumbers() {
  return incidents()
    .map((incident) => incident.caseNumber as number)
    .sort((a, b) => a - b);
}

/** How far the counter has been wound on. The gap in a filed log is made
 * here, not by the delete that exposes it. */
function counter() {
  const rows = db.rows("safetyCaseCounter");
  return rows.length === 0 ? 0 : (rows[0].lastCaseNumber as number);
}

beforeEach(() => {
  db = new FakeDb();
});

describe("createSafetyIncident files one case per injury", () => {
  it("issues case number 1 for the first report", async () => {
    await createSafetyIncident(report());

    expect(incidents()).toHaveLength(1);
    expect(caseNumbers()).toEqual([1]);
    expect(counter()).toBe(1);
  });

  it("files one case when the same injury is submitted twice", async () => {
    await createSafetyIncident(report());
    await createSafetyIncident(report());

    expect(incidents()).toHaveLength(1);
    expect(caseNumbers()).toEqual([1]);
  });

  it("does not burn a case number on the report it refuses", async () => {
    await createSafetyIncident(report());
    await createSafetyIncident(report());

    // The whole reason to refuse BEFORE the counter is touched. A guard
    // that ran after would leave the log numbered 1, 3, 4 — the same gap
    // as the deletion it was meant to make unnecessary.
    expect(counter()).toBe(1);
  });

  it("still files a second, genuinely different injury for the same person that day", async () => {
    await createSafetyIncident(report());
    await createSafetyIncident(
      report({ description: "Cut a hand on a stud track later the same shift." }),
    );

    // What happened is what identifies the case. Two different injuries to
    // one person on one day are two recordable cases, and a guard that
    // matched only on the person and the date would silently swallow the
    // second one.
    expect(incidents()).toHaveLength(2);
    expect(caseNumbers()).toEqual([1, 2]);
  });

  it("still files the same injury reported for a different person", async () => {
    await createSafetyIncident(report());
    await createSafetyIncident(report({ employeeName: "Dana Whitfield" }));

    expect(incidents()).toHaveLength(2);
    expect(caseNumbers()).toEqual([1, 2]);
  });

  /**
   * The ORDER of the guard, which is the half #102 says is easy to get
   * wrong: "a guard that runs BEFORE the transaction it protects is not a
   * guard, it is a race with a smaller window."
   *
   * What this fake can show is that the advisory lock is requested, and
   * that it is requested as the FIRST thing the transaction does — before
   * the duplicate check and before the counter is bumped. What it cannot
   * show is that the lock excludes anything, because there is no second
   * connection here and no SQL engine; that is proven against a real
   * Postgres in lib/actions/duplicate-writes.dbtest.ts, which holds the
   * lock from outside and watches this action stop at the door.
   */
  it("asks for the advisory lock before it touches the counter", async () => {
    await createSafetyIncident(report());

    expect(db.rawQueries).toHaveLength(1);
    expect(db.rawQueries[0]).toContain("pg_advisory_xact_lock");
    // Requested inside the transaction that files the case, not before it:
    // a lock taken outside would be released before the insert it protects.
    expect(db.rawQueriesBeforeFirstWrite).toBe(1);
  });
});
