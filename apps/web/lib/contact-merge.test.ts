import { describe, expect, it } from "vitest";
import { normalizeMergeValue, planContactMerge } from "./contact-merge";

/** A contact with every mergeable field blank, so each test only says what it
 * is actually about. */
function contact(overrides: Record<string, unknown> = {}) {
  return {
    email: null,
    phone: null,
    address: null,
    accountType: null,
    defaultRetainagePercent: null,
    paymentTermsDays: null,
    standardFormsUsed: null,
    msaExpirationDate: null,
    prequalificationExpiresAt: null,
    ...overrides,
  };
}

describe("normalizeMergeValue", () => {
  it("treats blank-ish values as blank", () => {
    expect(normalizeMergeValue(null)).toBeNull();
    expect(normalizeMergeValue(undefined)).toBeNull();
    // An older row holding "" must not read as a value — otherwise it would
    // invent a conflict against a real address.
    expect(normalizeMergeValue("")).toBeNull();
    expect(normalizeMergeValue("   ")).toBeNull();
  });

  it("compares dates and numbers by a stable string, not by identity", () => {
    const a = new Date("2026-08-01T00:00:00.000Z");
    const b = new Date("2026-08-01T00:00:00.000Z");
    expect(normalizeMergeValue(a)).toBe(normalizeMergeValue(b));
    expect(normalizeMergeValue(30)).toBe("30");
    // Prisma hands back a Decimal object for the money columns.
    expect(normalizeMergeValue({ toString: () => "10.00" })).toBe("10.00");
  });
});

describe("planContactMerge", () => {
  it("copies the duplicate's value into a blank on the contact being kept", () => {
    // The whole reason merge is worth building: createJob mints a contact
    // with nulls, so the record holding the real terms is usually the one
    // WITHOUT the jobs on it.
    const plan = planContactMerge(
      contact(),
      contact({ paymentTermsDays: 45, standardFormsUsed: "AIA A401" }),
    );
    expect(plan.fills.map((f) => f.key)).toEqual(["paymentTermsDays", "standardFormsUsed"]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.updates).toEqual({ paymentTermsDays: 45, standardFormsUsed: "AIA A401" });
  });

  it("leaves a value the contact being kept already has", () => {
    const plan = planContactMerge(contact({ email: "ap@gc.test" }), contact());
    expect(plan.fills).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.updates).toEqual({});
  });

  it("says nothing about two values that already agree", () => {
    const plan = planContactMerge(
      contact({ email: "ap@gc.test", msaExpirationDate: new Date("2027-01-01T00:00:00.000Z") }),
      contact({ email: " ap@gc.test ", msaExpirationDate: new Date("2027-01-01T00:00:00.000Z") }),
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.updates).toEqual({});
  });

  it("reports a disagreement as unresolved until it is answered, and never guesses", () => {
    const winner = contact({ defaultRetainagePercent: "10" });
    const loser = contact({ defaultRetainagePercent: "5" });

    const unanswered = planContactMerge(winner, loser);
    expect(unanswered.conflicts.map((c) => c.key)).toEqual(["defaultRetainagePercent"]);
    expect(unanswered.unresolved).toHaveLength(1);
    // Nothing is written while a conflict stands. Silently taking either
    // side is how a contract term gets replaced by the duplicate's guess.
    expect(unanswered.updates).toEqual({});

    const keepOurs = planContactMerge(winner, loser, { defaultRetainagePercent: "keep" });
    expect(keepOurs.unresolved).toEqual([]);
    expect(keepOurs.updates).toEqual({});

    const takeTheirs = planContactMerge(winner, loser, { defaultRetainagePercent: "duplicate" });
    expect(takeTheirs.unresolved).toEqual([]);
    expect(takeTheirs.updates).toEqual({ defaultRetainagePercent: "5" });
  });

  it("answers each conflicting field on its own", () => {
    const plan = planContactMerge(
      contact({ email: "old@gc.test", paymentTermsDays: 30 }),
      contact({ email: "ap@gc.test", paymentTermsDays: 60 }),
      { email: "duplicate", paymentTermsDays: "keep" },
    );
    expect(plan.unresolved).toEqual([]);
    expect(plan.updates).toEqual({ email: "ap@gc.test" });
  });

  it("shows both sides of a conflict so the screen can print them", () => {
    const [conflict] = planContactMerge(
      contact({ address: "1 Main St" }),
      contact({ address: "2 Market St" }),
    ).conflicts;
    expect(conflict).toMatchObject({
      key: "address",
      label: "Address",
      keep: "1 Main St",
      duplicate: "2 Market St",
      kind: "conflict",
      choice: null,
    });
  });

  it("never touches name or status", () => {
    // The person chose which record to KEEP; renaming it during a merge
    // would make "keep this one" mean something else. Status is
    // non-nullable, so it can never be filled from a blank, and it is one
    // click to change on the page you are already standing on.
    const plan = planContactMerge(
      contact({ name: "Turner Construction", status: "PROSPECT" }),
      contact({ name: "Turner Constr.", status: "ACTIVE" }),
    );
    expect(plan.updates).toEqual({});
    expect(plan.conflicts).toEqual([]);
  });
});
