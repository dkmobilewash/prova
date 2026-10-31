import { describe, expect, it } from "vitest";
import {
  parsePastPriceArg,
  pastPriceToken,
  suggestPastPrices,
  whenLabelOf,
  writesFor,
  type GroupInfo,
  type PastLine,
  type UnpricedTarget,
} from "./pastPriceCore";

const NOW = new Date("2026-10-26T12:00:00Z");
const W2: GroupInfo = { groupKey: "wt:wt2", kind: "wallType", code: "W2", name: '6" 1-HR' };

const target = (over: Partial<UnpricedTarget> = {}): UnpricedTarget => ({
  lineId: "new-board",
  description: "W2 — board",
  unit: "SF",
  groupKey: "wt:wt2",
  partKey: "comp-board",
  ...over,
});

let n = 0;
const past = (over: Partial<PastLine> = {}): PastLine => ({
  lineId: `old-${(n += 1)}`,
  jobId: "job-old",
  jobName: "Civic Center Annex",
  jobCreatedAt: new Date("2026-08-01T00:00:00Z"),
  partKey: "comp-board",
  groupKey: "wt:wt2",
  unit: "SF",
  unitCost: 1.5,
  unitPrice: 2.25,
  updatedAt: new Date("2026-09-10T00:00:00Z"),
  isDeleted: false,
  ...over,
});

const run = (
  history: PastLine[],
  extra: { targets?: UnpricedTarget[]; recapApplied?: boolean } = {},
) =>
  suggestPastPrices({
    jobId: "job-new",
    targets: extra.targets ?? [target()],
    groups: [W2],
    history,
    recapApplied: extra.recapApplied ?? false,
    now: NOW,
  });

describe("suggestPastPrices", () => {
  it("finds the same wall type on an earlier job and names it", () => {
    const [s] = run([past()]);
    expect(s).toMatchObject({
      wallTypeCode: "W2",
      wallTypeId: "wt2",
      label: 'W2 — 6" 1-HR',
      fromJobId: "job-old",
      fromJobName: "Civic Center Annex",
      whenLabel: "September",
      unitCost: 1.5,
      unitPrice: 2.25,
      unit: "SF",
      priceHeldForRecap: false,
    });
    expect(s.parts).toEqual([
      expect.objectContaining({ lineId: "new-board", unitCost: 1.5, unitPrice: 2.25, unit: "SF" }),
    ]);
    expect(parsePastPriceArg(s.actionArg)).toEqual({ groupKey: "wt:wt2", token: expect.any(String) });
  });

  it("skips a past line whose unit differs from the line's unit", () => {
    expect(run([past({ unit: "LF" })])).toEqual([]);
    // case and spaces are not a difference
    expect(run([past({ unit: " sf " })])).toHaveLength(1);
    // and the right-unit line beats a wrong-unit one on the same job
    const [s] = run([past({ unit: "LF", unitCost: 9 }), past({ unit: "SF", unitCost: 1.5 })]);
    expect(s.unitCost).toBe(1.5);
  });

  it("ignores soft-deleted lines, lines with nothing to carry, and the job itself", () => {
    expect(run([past({ isDeleted: true })])).toEqual([]);
    expect(run([past({ unitCost: null, unitPrice: null })])).toEqual([]);
    expect(run([past({ unitCost: 0, unitPrice: 0 })])).toEqual([]);
    expect(run([past({ jobId: "job-new" })])).toEqual([]);
  });

  it("takes the latest job by updatedAt, then job creation, then id", () => {
    const older = past({ jobId: "a", jobName: "Older", updatedAt: new Date("2026-03-01T00:00:00Z"), unitCost: 1 });
    const newer = past({ jobId: "b", jobName: "Newer", updatedAt: new Date("2026-09-20T00:00:00Z"), unitCost: 2 });
    expect(run([older, newer])[0]).toMatchObject({ fromJobName: "Newer", unitCost: 2 });
    expect(run([newer, older])[0]).toMatchObject({ fromJobName: "Newer", unitCost: 2 });

    const same = new Date("2026-05-05T00:00:00Z");
    const x = past({ jobId: "x", jobName: "X", updatedAt: same, jobCreatedAt: new Date("2026-01-01T00:00:00Z") });
    const y = past({ jobId: "y", jobName: "Y", updatedAt: same, jobCreatedAt: new Date("2026-02-01T00:00:00Z") });
    expect(run([x, y])[0].fromJobName).toBe("Y");
  });

  it("returns nothing when no other job priced it", () => {
    expect(run([])).toEqual([]);
    expect(run([past({ groupKey: "wt:someone-else", partKey: "other" })])).toEqual([]);
  });

  it("needs a job that can price EVERY unpriced line of the type", () => {
    const targets = [target(), target({ lineId: "new-stud", partKey: "comp-stud", unit: "LF" })];
    const halfNewer = past({ jobId: "half", jobName: "Half", updatedAt: new Date("2026-10-01T00:00:00Z") });
    const full = [
      past({ jobId: "full", jobName: "Full", updatedAt: new Date("2026-06-01T00:00:00Z") }),
      past({ jobId: "full", jobName: "Full", partKey: "comp-stud", unit: "LF", unitCost: 0.4, unitPrice: 0.9 }),
    ];
    const [s] = run([halfNewer, ...full], { targets });
    expect(s.fromJobName).toBe("Full");
    expect(s.parts.map((p) => p.lineId)).toEqual(["new-board", "new-stud"]);
    expect(run([halfNewer], { targets })).toEqual([]);
  });

  it("labels a year only when it is not this year", () => {
    expect(whenLabelOf(new Date("2025-09-30T23:00:00Z"), NOW)).toBe("September 2025");
    expect(whenLabelOf(new Date("2026-09-01T00:00:00Z"), NOW)).toBe("September");
  });

  it("holds the price back once the recap is applied, and the token knows", () => {
    const history = [past()];
    const open = run(history)[0];
    const held = run(history, { recapApplied: true })[0];
    expect(writesFor(open)[0].data).toMatchObject({ budgetedUnitCost: "1.5", unitPrice: "2.25" });
    const heldData = writesFor(held)[0].data;
    expect(heldData.budgetedUnitCost).toBe("1.5");
    expect(heldData.unitPrice).toBeUndefined();
    expect(held.priceHeldForRecap).toBe(true);
    expect(held.actionArg).not.toBe(open.actionArg);
    // a price-only source has nothing to write once held
    expect(run([past({ unitCost: null })], { recapApplied: true })).toEqual([]);
  });

  it("matches a price-book item by catalog entry, not by wall type", () => {
    const [s] = suggestPastPrices({
      jobId: "job-new",
      targets: [target({ groupKey: "ce:e1", partKey: "e1", description: "Fire caulk" })],
      groups: [{ groupKey: "ce:e1", kind: "catalog", code: null, name: "Fire caulk" }],
      history: [past({ groupKey: "ce:e1", partKey: "e1" })],
      recapApplied: false,
      now: NOW,
    });
    expect(s).toMatchObject({ wallTypeCode: null, catalogEntryId: "e1", label: "Fire caulk" });
    expect(s.wallTypeId).toBeUndefined();
    expect(s.actionArg.startsWith("ce:e1:")).toBe(true);
  });
});

describe("the token and the arg", () => {
  it("moves when any figure or line moves, and not with order", () => {
    const a = pastPriceToken("j", [
      { lineId: "l1", cost: 150, price: 225 },
      { lineId: "l2", cost: 40, price: null },
    ]);
    expect(pastPriceToken("j", [
      { lineId: "l2", cost: 40, price: null },
      { lineId: "l1", cost: 150, price: 225 },
    ])).toBe(a);
    expect(pastPriceToken("j", [{ lineId: "l1", cost: 151, price: 225 }, { lineId: "l2", cost: 40, price: null }])).not.toBe(a);
    expect(pastPriceToken("other", [{ lineId: "l1", cost: 150, price: 225 }, { lineId: "l2", cost: 40, price: null }])).not.toBe(a);
  });

  it("parses only the documented shape", () => {
    expect(parsePastPriceArg("wt:abc123:0123abcd")).toEqual({ groupKey: "wt:abc123", token: "0123abcd" });
    expect(parsePastPriceArg("ce:abc123:0123abcd")).toEqual({ groupKey: "ce:abc123", token: "0123abcd" });
    for (const bad of ["", "wt:abc", "xx:abc:0123abcd", "wt:abc:ZZZZZZZZ", "wt:a:b:0123abcd", null, 5, undefined]) {
      expect(parsePastPriceArg(bad)).toBeNull();
    }
  });
});
