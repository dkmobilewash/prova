import { describe, expect, it } from "vitest";
import { CATALOG_MIN_SAMPLE, CATALOG_VARIANCE_THRESHOLD } from "@/lib/catalog-actuals";
import {
  priceAnomalies,
  TYPO_FACTOR,
  type AnomalyHistory,
  type AnomalyLine,
} from "./price-anomalies";

/**
 * The silence cases carry as much weight as the findings here, because this
 * panel sits on the screen somebody is working on. Anything it says when
 * nothing is wrong teaches them to stop reading it.
 *
 * Every figure below is a real one: $2.85/SF is what 5/8" Type X board costs.
 */

const board = (over: Partial<AnomalyLine> = {}): AnomalyLine => ({
  id: "l1",
  description: '5/8" Type X board',
  budgetedUnitCost: 2.85,
  unitPrice: 4.1,
  unit: "SF",
  ...over,
});

const history = (over: Partial<AnomalyHistory> = {}): AnomalyHistory => ({
  unit: "SF",
  actualUnitCost: 2.85,
  sampleSize: 14,
  ...over,
});

const run = (line: AnomalyLine, hist: AnomalyHistory | null) => priceAnomalies([{ line, history: hist }]);

describe("the line that matches its history says nothing", () => {
  it("is silent on an exact match", () => {
    expect(run(board(), history()).anomalies).toEqual([]);
  });

  it("is silent a few per cent off, because estimating is not exact", () => {
    // 8.8% over. Flagging this would train people to ignore the flag, which
    // costs more than the drift does — `catalog-actuals.ts`'s own reasoning.
    expect(run(board({ budgetedUnitCost: 3.1 }), history()).anomalies).toEqual([]);
  });

  it("is silent just under the threshold and speaks just over it", () => {
    const under = 2.85 * (1 + CATALOG_VARIANCE_THRESHOLD * 0.9);
    const over = 2.85 * (1 + CATALOG_VARIANCE_THRESHOLD * 1.1);
    expect(run(board({ budgetedUnitCost: under }), history()).anomalies).toEqual([]);
    expect(run(board({ budgetedUnitCost: over }), history()).anomalies).toHaveLength(1);
  });
});

describe("the typed decimal, which is what this is for", () => {
  it("flags ten times too high as TYPED_WRONG, not as drift", () => {
    const [anomaly] = run(board({ budgetedUnitCost: 28.5 }), history()).anomalies;
    expect(anomaly.kind).toBe("TYPED_WRONG");
    expect(anomaly.sentence).toContain("$28.50");
    expect(anomaly.sentence).toContain("$2.85");
    // The action, which is different from drift's.
    expect(anomaly.sentence).toContain("moved decimal point");
  });

  it("flags ten times too LOW, which is the direction that wins the job and loses money", () => {
    const [anomaly] = run(board({ budgetedUnitCost: 0.285 }), history()).anomalies;
    expect(anomaly.kind).toBe("TYPED_WRONG");
  });

  it("names the sample it is judged against", () => {
    const [anomaly] = run(board({ budgetedUnitCost: 28.5 }), history({ sampleSize: 14 })).anomalies;
    expect(anomaly.sentence).toContain("14 finished jobs");
  });

  it("fires on a sample of ONE, unlike drift", () => {
    // A tenfold difference from one costed job is still worth a look: the claim
    // is "you typed this wrong", and a decimal point does not become more or
    // less moved with a bigger sample.
    const [anomaly] = run(board({ budgetedUnitCost: 28.5 }), history({ sampleSize: 1 })).anomalies;
    expect(anomaly.kind).toBe("TYPED_WRONG");
    expect(anomaly.sentence).toContain("1 finished job");
  });

  it("says ONE thing about a line, not both a typo and a 900% drift", () => {
    const report = run(board({ budgetedUnitCost: 28.5 }), history());
    expect(report.anomalies.filter((a) => a.kind === "COST_DRIFT")).toEqual([]);
    expect(report.anomalies).toHaveLength(1);
  });

  it("catches a slip in the PRICE too, which drift never looks at", () => {
    // $41.00 where the work costs $2.85. A margin decision is not this file's
    // business; a keystroke is.
    const [anomaly] = run(board({ budgetedUnitCost: 2.85, unitPrice: 41 }), history()).anomalies;
    expect(anomaly.kind).toBe("TYPED_WRONG");
    expect(anomaly.sentence).toContain("usually a keystroke");
  });

  it("the factor is wide enough that a genuinely hard job is not a typo", () => {
    // Three times the usual cost is a real job — high work, occupied site,
    // night shift. It is drift, worth a look, and not "you hit the wrong key".
    const [anomaly] = run(board({ budgetedUnitCost: 8.55 }), history()).anomalies;
    expect(anomaly.kind).toBe("COST_DRIFT");
    expect(TYPO_FACTOR).toBeGreaterThan(5);
  });
});

describe("the unit mismatch, which needs no arithmetic", () => {
  it("flags a line priced per LF against history measured per SF", () => {
    const [anomaly] = run(board({ unit: "LF" }), history({ unit: "SF" })).anomalies;
    expect(anomaly.kind).toBe("UNIT_MISMATCH");
    expect(anomaly.sentence).toContain("per LF");
    expect(anomaly.sentence).toContain("per SF");
  });

  it("ignores case and padding, because a unit is typed by hand", () => {
    expect(run(board({ unit: " sf " }), history({ unit: "SF" })).anomalies).toEqual([]);
  });

  it("says nothing when either side has no unit", () => {
    // Null is "nobody said", not "they disagree".
    expect(run(board({ unit: null }), history({ unit: "SF" })).anomalies).toEqual([]);
    expect(run(board({ unit: "SF" }), history({ unit: null })).anomalies).toEqual([]);
    expect(run(board({ unit: "" }), history({ unit: "SF" })).anomalies).toEqual([]);
  });
});

describe("drift respects the sample, because one job is an anecdote", () => {
  it("stays silent below the minimum sample", () => {
    const thin = history({ sampleSize: CATALOG_MIN_SAMPLE - 1 });
    expect(run(board({ budgetedUnitCost: 3.6 }), thin).anomalies).toEqual([]);
  });

  it("speaks at the minimum sample", () => {
    const enough = history({ sampleSize: CATALOG_MIN_SAMPLE });
    const [anomaly] = run(board({ budgetedUnitCost: 3.6 }), enough).anomalies;
    expect(anomaly.kind).toBe("COST_DRIFT");
  });

  it("states the percentage and the direction", () => {
    // 3.40 against 2.85 is 19% over.
    const [anomaly] = run(board({ budgetedUnitCost: 3.4 }), history()).anomalies;
    expect(anomaly.sentence).toContain("19%");
    expect(anomaly.sentence).toContain("above");
  });

  it("says BELOW when the line is under history, which is the dangerous direction", () => {
    const [anomaly] = run(board({ budgetedUnitCost: 2.2 }), history()).anomalies;
    expect(anomaly.sentence).toContain("below");
  });

  it("never reads the price", () => {
    // A margin call on a hard job is not an anomaly. A line costed correctly
    // and priced high must produce nothing.
    expect(run(board({ budgetedUnitCost: 2.85, unitPrice: 9 }), history()).anomalies).toEqual([]);
  });
});

describe("nothing to judge against", () => {
  it("counts a line with no history as unchecked, and reports nothing about it", () => {
    const report = run(board({ budgetedUnitCost: 28.5 }), null);
    expect(report.anomalies).toEqual([]);
    expect(report.unchecked).toBe(1);
    expect(report.checked).toBe(0);
  });

  it("treats history with no actual cost as no history", () => {
    const report = run(board(), history({ actualUnitCost: null }));
    expect(report.unchecked).toBe(1);
  });

  it("treats an empty sample as no history", () => {
    const report = run(board(), history({ sampleSize: 0, actualUnitCost: 2.85 }));
    expect(report.unchecked).toBe(1);
  });

  it("does not divide by a zero history", () => {
    const report = run(board({ budgetedUnitCost: 5 }), history({ actualUnitCost: 0 }));
    expect(report.anomalies).toEqual([]);
    for (const anomaly of report.anomalies) expect(anomaly.sentence).not.toContain("Infinity");
  });

  it("says nothing about a line with no cost of its own", () => {
    // A cost-only or unpriced line is `bid-recap.ts`'s business, not this
    // file's — and it is still COUNTED as checked, because its history exists.
    const report = run(board({ budgetedUnitCost: null, unitPrice: null }), history());
    expect(report.anomalies).toEqual([]);
    expect(report.checked).toBe(1);
  });
});

describe("the coverage counts, which stop a clean result reading as a clean bid", () => {
  it("counts checked and unchecked separately", () => {
    const report = priceAnomalies([
      { line: board({ id: "a" }), history: history() },
      { line: board({ id: "b" }), history: history() },
      { line: board({ id: "c" }), history: null },
      { line: board({ id: "d" }), history: null },
      { line: board({ id: "e" }), history: null },
    ]);
    expect(report.checked).toBe(2);
    expect(report.unchecked).toBe(3);
  });

  it("returns zeroes and no anomalies for an empty estimate", () => {
    expect(priceAnomalies([])).toEqual({ anomalies: [], checked: 0, unchecked: 0 });
  });
});

describe("order on screen", () => {
  it("puts TYPED_WRONG first, because it is the one that loses a job", () => {
    const report = priceAnomalies([
      { line: board({ id: "drift", budgetedUnitCost: 3.4 }), history: history() },
      { line: board({ id: "unit", unit: "LF" }), history: history() },
      { line: board({ id: "typo", budgetedUnitCost: 28.5 }), history: history() },
    ]);
    expect(report.anomalies.map((a) => a.kind)).toEqual(["TYPED_WRONG", "UNIT_MISMATCH", "COST_DRIFT"]);
  });
});
