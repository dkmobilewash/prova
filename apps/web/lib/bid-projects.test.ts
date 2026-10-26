import { describe, expect, it } from "vitest";
import { hasPrimeAward, planMerge, primeWentElsewhere, priceVersusEstimate, provisionalGc, type MergeSide } from "./bid-projects";

const none = { primeAwardedContactId: null, primeAwardedName: null };

describe("primeWentElsewhere", () => {
  it("is false when nobody has said who won: unknown is not a loss", () => {
    expect(primeWentElsewhere(none, "acme")).toBe(false);
    expect(primeWentElsewhere({ primeAwardedContactId: null, primeAwardedName: "   " }, "acme")).toBe(false);
  });

  it("is true for every GC on file except the winner", () => {
    const award = { primeAwardedContactId: "turner", primeAwardedName: null };
    expect(primeWentElsewhere(award, "turner")).toBe(false);
    expect(primeWentElsewhere(award, "acme")).toBe(true);
  });

  it("is true for everyone when the winner is recorded by name only", () => {
    // A GC we have no record of is, by construction, none of the GCs on file.
    expect(primeWentElsewhere({ primeAwardedContactId: null, primeAwardedName: "Hensel Phelps" }, "acme")).toBe(true);
  });

  it("hasPrimeAward counts a bare name", () => {
    expect(hasPrimeAward({ primeAwardedContactId: null, primeAwardedName: "Hensel Phelps" })).toBe(true);
    expect(hasPrimeAward(none)).toBe(false);
  });
});

describe("provisionalGc", () => {
  const at = (id: string, contactId: string, day: number) => ({ id, contactId, createdAt: new Date(Date.UTC(2026, 9, day)) });
  const invitations = [at("i2", "buildco", 5), at("i1", "acme", 2), at("i3", "turner", 9)];

  it("is the first GC to invite us when no prime is known", () => {
    expect(provisionalGc(invitations, none)?.contactId).toBe("acme");
  });

  it("is the awarded GC once the prime is known and that GC invited us", () => {
    expect(provisionalGc(invitations, { primeAwardedContactId: "turner", primeAwardedName: null })?.id).toBe("i3");
  });

  it("falls back to the first when the winner never invited us", () => {
    expect(provisionalGc(invitations, { primeAwardedContactId: "stranger", primeAwardedName: null })?.id).toBe("i1");
  });

  it("is null with nothing to pick, and breaks a date tie by id so it is deterministic", () => {
    expect(provisionalGc([], none)).toBeNull();
    expect(provisionalGc([at("b", "x", 1), at("a", "y", 1)], none)?.id).toBe("a");
  });
});

describe("planMerge", () => {
  const side = (over: Partial<MergeSide> = {}): MergeSide => ({
    id: "p1",
    companyId: "co",
    estimateJobId: null,
    ...none,
    ...over,
  });

  it("refuses to merge a project into itself or across companies", () => {
    expect(planMerge(side(), side())).toMatchObject({ ok: false });
    expect(planMerge(side(), side({ id: "p2", companyId: "other" }))).toMatchObject({ ok: false });
  });

  it("refuses when both have an estimate, in words, rather than dropping one", () => {
    const plan = planMerge(side({ estimateJobId: "j1" }), side({ id: "p2", estimateJobId: "j2" }));
    expect(plan).toEqual({ ok: false, error: expect.stringContaining("Both have an estimate") });
  });

  it("lets the target adopt the source's estimate when it has none, and never the reverse", () => {
    expect(planMerge(side({ estimateJobId: "j1" }), side({ id: "p2" }))).toMatchObject({ ok: true, adoptEstimateJobId: "j1" });
    expect(planMerge(side(), side({ id: "p2", estimateJobId: "j2" }))).toMatchObject({ ok: true, adoptEstimateJobId: null });
  });

  it("refuses two different winners but accepts the same one written two ways", () => {
    const a = side({ primeAwardedContactId: "turner" });
    expect(planMerge(a, side({ id: "p2", primeAwardedContactId: "acme" }))).toMatchObject({ ok: false });
    expect(planMerge(a, side({ id: "p2", primeAwardedContactId: "turner" }))).toMatchObject({ ok: true, adoptPrimeAward: false });
    const named = side({ primeAwardedName: "Hensel  Phelps" });
    expect(planMerge(named, side({ id: "p2", primeAwardedName: "hensel phelps" }))).toMatchObject({ ok: true });
    expect(planMerge(named, side({ id: "p2", primeAwardedName: "Other Co" }))).toMatchObject({ ok: false });
  });

  it("carries the source's award across when the target has none", () => {
    expect(planMerge(side({ primeAwardedContactId: "turner" }), side({ id: "p2" }))).toMatchObject({ ok: true, adoptPrimeAward: true });
  });
});

describe("priceVersusEstimate", () => {
  const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;
  it("says nothing when the two agree, or when either is unknown", () => {
    expect(priceVersusEstimate(437000, 437000, "Acme", fmt)).toBeNull();
    expect(priceVersusEstimate(null, 437000, "Acme", fmt)).toBeNull();
    expect(priceVersusEstimate(412300, null, "Acme", fmt)).toBeNull();
  });
  it("names the difference in words", () => {
    expect(priceVersusEstimate(412300, 437000, "Acme", fmt)).toBe("$412,300 sent to Acme; the estimate totals $437,000.");
  });
});
