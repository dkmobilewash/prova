import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CALCULATE_TOOL,
  CANONICAL,
  COMBINABLE,
  FigureLedger,
  calculate,
  countNumbers,
  kindOf,
  type CalculationResult,
} from "./calculator";
import { forModel } from "./answer";
import { TOOLS } from "./tools";

/**
 * The corpus: tool results shaped exactly as the executor hands them over —
 * `JSON.stringify({ ...summary, ...forModel(data) })` — so a change to how
 * results are assembled breaks these tests rather than sliding past them.
 *
 * The figures are invented; the FIELD NAMES are the real ones, read out of
 * handlers.ts, and a test below re-checks that against the file.
 */
function content(summary: Record<string, number> | null, data: unknown): string {
  const payload = forModel(data);
  return JSON.stringify(
    summary && typeof payload === "object" && payload !== null ? { ...summary, ...payload } : payload,
  );
}

const RECEIVABLES = content(
  { outstandingInvoiceCount: 3, overdueInvoiceCount: 2, notYetDueInvoiceCount: 1 },
  [
    {
      invoice: 7,
      job: "Turner — Riverside",
      gc: "Turner",
      amount: 32000,
      paid: 2000,
      retainageWithheld: 0,
      outstanding: 30000,
      dueOn: "2026-08-14",
      dueFromTerms: false,
      daysOverdue: 39,
    },
    {
      invoice: 11,
      job: "Halvorsen — Cedar Point",
      gc: "Halvorsen",
      amount: 18400,
      paid: 0,
      retainageWithheld: 0,
      outstanding: 18400,
      dueOn: "2026-09-02",
      dueFromTerms: true,
      daysOverdue: 20,
    },
    {
      invoice: 12,
      job: "Bellweather — Mill Street",
      gc: "Bellweather",
      amount: 9250.55,
      paid: 0,
      retainageWithheld: 0,
      outstanding: 9250.55,
      dueOn: "2026-10-01",
      dueFromTerms: false,
      daysOverdue: 0,
    },
  ],
);

const LABOR = content(
  { jobsWithHours: 2, hoursLogged: 35.3, hoursNotPriced: 0, burdenedLaborCost: 4210.5 },
  [
    { job: "Riverside", gc: "Turner", hoursLogged: 21.1, hoursPriced: 21.1, burdenedLaborCost: 2515.5, wageCost: 2100, allowanceCost: 415.5, shareOfHoursPriced: "100%" },
    { job: "Cedar Point", gc: "Halvorsen", hoursLogged: 14.2, hoursPriced: 14.2, burdenedLaborCost: 1695, wageCost: 1400, allowanceCost: 295, shareOfHoursPriced: "100%" },
  ],
);

const RETAINAGE = content(
  { companyWideStillHeld: 41000, jobsHoldingRetainage: 2, jobsWithNoCompletionDate: 1 },
  [
    { job: "Riverside", gc: "Turner", jobStatus: "IN_PROGRESS", withheldToDate: 26000, releasedToDate: 0, stillHeld: 26000, substantialCompletionDate: null },
    { job: "Cedar Point", gc: "Halvorsen", jobStatus: "CONTRACTED", withheldToDate: 15000, releasedToDate: 0, stillHeld: 15000, substantialCompletionDate: "2026-11-30" },
  ],
);

const MARGIN = content(null, [
  {
    job: "Riverside",
    gc: "Turner",
    contractValue: 240000,
    costToDate: 96000,
    forecastCostAtCompletion: 201000,
    percentComplete: "48%",
    earnedRevenue: 115200,
    billedToDate: 120000,
    overUnderBilling: 4800,
    forecastVarianceAgainstContract: 39000,
    shareOfValueWithACostEstimate: "100%",
    shareOfValueWithAnEarnedRevenueFigure: "100%",
  },
]);

/** The corpus's own size, declared. A fixture that silently stops holding
 * numbers would make every "the ledger saw everything" assertion below pass
 * on nothing — the empty-question failure this repo keeps paying for. */
const NUMBERS_IN_CORPUS = 55;

function ledgerWithEverything(): FigureLedger {
  const ledger = new FigureLedger();
  ledger.record("receivables", RECEIVABLES);
  ledger.record("job_labor_cost", LABOR);
  ledger.record("retainage_held", RETAINAGE);
  ledger.record("job_margin", MARGIN);
  return ledger;
}

function ok(outcome: ReturnType<typeof calculate>): CalculationResult {
  expect(outcome, `expected a calculation, got ${JSON.stringify(outcome)}`).toHaveProperty("result");
  return outcome as CalculationResult;
}

// ─────────────────────────────────────────────────────────────────────────

describe("the ledger sees every number the model was handed", () => {
  // THE SIZE ASSERTION. A walker that stops matching returns an empty
  // ledger, and an empty ledger makes every path lookup below fail for the
  // "right" reason — refused as untraceable — with no test able to tell the
  // difference. So the walk is pinned to a count taken by JSON.parse's own
  // reviver, which is not this code and cannot break with it.
  const CORPUS: [string, string][] = [
    ["receivables", RECEIVABLES],
    ["job_labor_cost", LABOR],
    ["retainage_held", RETAINAGE],
    ["job_margin", MARGIN],
  ];

  it("registers exactly as many figures as the JSON contains numbers", () => {
    let total = 0;
    for (const [name, json] of CORPUS) {
      const ledger = new FigureLedger();
      const report = ledger.record(name, json);
      expect(report.registered, `${name}: the walk and the parser disagree`).toBe(report.numbers);
      expect(report.registered, `${name}: no numbers found at all`).toBeGreaterThan(0);
      total += report.registered;
    }
    // And the corpus is the size it says it is, so the equality above can
    // never be 0 === 0.
    expect(total).toBe(NUMBERS_IN_CORPUS);
    expect(CORPUS.reduce((sum, [, json]) => sum + countNumbers(json), 0)).toBe(NUMBERS_IN_CORPUS);
  });

  it("keeps one ledger's figures for every tool called in a turn", () => {
    expect(ledgerWithEverything().size()).toBe(NUMBERS_IN_CORPUS);
  });

  it("gives a second call to the same tool its own root", () => {
    const ledger = new FigureLedger();
    expect(ledger.record("receivables", RECEIVABLES).root).toBe("receivables");
    expect(ledger.record("receivables", RECEIVABLES).root).toBe("receivables#2");
    expect(ledger.get("receivables#2.rows[0].outstanding")?.value).toBe(30000);
  });

  it("holds a tool that answered in prose without falling over", () => {
    const ledger = new FigureLedger();
    const report = ledger.record("start_bid", "A card is in front of the person. Wait for them.");
    expect(report.registered).toBe(0);
  });
});

describe("the operations", () => {
  it("sums two figures the tools returned", () => {
    const result = ok(
      calculate(ledgerWithEverything(), {
        operation: "sum",
        figures: "receivables.rows[0].outstanding, receivables.rows[1].outstanding",
      }),
    );
    expect(result.result).toBe("$48,400.00");
    expect(result.resultValue).toBe(48400);
    expect(result.working).toBe("$30,000.00 + $18,400.00 = $48,400.00");
    expect(result.operands.map((operand) => operand.path)).toEqual([
      "receivables.rows[0].outstanding",
      "receivables.rows[1].outstanding",
    ]);
  });

  it("takes a difference, first minus second", () => {
    const result = ok(
      calculate(ledgerWithEverything(), {
        operation: "difference",
        figures: "job_margin.rows[0].contractValue, job_margin.rows[0].costToDate",
      }),
    );
    expect(result.result).toBe("$144,000.00");
    expect(result.working).toBe("$240,000.00 - $96,000.00 = $144,000.00");
  });

  it("averages", () => {
    const result = ok(
      calculate(ledgerWithEverything(), {
        operation: "average",
        figures: "receivables.rows[0].outstanding, receivables.rows[1].outstanding",
      }),
    );
    expect(result.result).toBe("$24,200.00");
  });

  it("expresses one figure as a percentage of another", () => {
    const result = ok(
      calculate(ledgerWithEverything(), {
        operation: "percentage_of",
        figures: "job_margin.rows[0].costToDate, job_margin.rows[0].contractValue",
      }),
    );
    expect(result.result).toBe("40%");
    expect(result.kind).toBe("percent");
    expect(result.working).toBe("$96,000.00 is 40% of $240,000.00");
  });

  it("counts the figures it was given, and only those", () => {
    const result = ok(
      calculate(ledgerWithEverything(), {
        operation: "count",
        figures:
          "receivables.rows[0].outstanding, receivables.rows[1].outstanding, receivables.rows[2].outstanding",
      }),
    );
    expect(result.result).toBe("3");
    expect(result.kind).toBe("count");
  });

  it("adds hours as hours, through the app's own hours formatter", () => {
    const result = ok(
      calculate(ledgerWithEverything(), {
        operation: "sum",
        figures: "job_labor_cost.rows[0].hoursPriced, job_labor_cost.rows[1].hoursPriced",
      }),
    );
    // 21.1 + 14.2 is 35.300000000000004 in floating point. render-hours.ts
    // exists because that reached a certified-payroll form once.
    // `hoursPriced` rather than `hoursLogged`: the latter has a canonical
    // company total, so summing every row of it is refused.
    expect(result.result).toBe("35.3 hours");
    expect(result.resultValue).toBe(35.3);
  });

  it("refuses a percentage of zero rather than dividing by it", () => {
    const ledger = new FigureLedger();
    ledger.record("receivables", content({ outstandingInvoiceCount: 1 }, [{ job: "A", amount: 100, outstanding: 0 }]));
    const outcome = calculate(ledger, {
      operation: "percentage_of",
      figures: "receivables.rows[0].amount, receivables.rows[0].outstanding",
    });
    expect(outcome).toHaveProperty("unavailable");
  });
});

describe("money is added in cents, and rounded once", () => {
  // THE ROUNDING TEST. Every one of these sums is wrong in plain floating
  // point — 0.1 + 0.2 is 0.30000000000000004 — and each is a figure that
  // would go to a GC.
  //
  // They use `amount` rather than `outstanding` for a reason worth knowing:
  // `outstanding` has a canonical company total, so a sum covering every
  // row of it is refused before any arithmetic happens.
  const CASES: { values: number[]; expected: string; expectedValue: number }[] = [
    { values: [0.1, 0.2], expected: "$0.30", expectedValue: 0.3 },
    { values: [0.1, 0.7], expected: "$0.80", expectedValue: 0.8 },
    { values: [9250.55, 18400.35], expected: "$27,650.90", expectedValue: 27650.9 },
    { values: [0.07, 0.07, 0.07], expected: "$0.21", expectedValue: 0.21 },
  ];

  for (const { values, expected, expectedValue } of CASES) {
    it(`sums ${values.join(" + ")} to ${expected}`, () => {
      const ledger = new FigureLedger();
      ledger.record(
        "receivables",
        content(null, values.map((amount, index) => ({ invoice: index, amount }))),
      );
      const result = ok(
        calculate(ledger, {
          operation: "sum",
          figures: values.map((_, index) => `receivables.rows[${index}].amount`).join(", "),
        }),
      );
      expect(result.result).toBe(expected);
      expect(result.resultValue).toBe(expectedValue);
      // The proof that this is not just `toFixed` on a float sum: the naive
      // total is not the same number.
      expect(values.reduce((sum, value) => sum + value, 0)).not.toBe(expectedValue);
    });
  }

  it("rounds an average once, not per operand", () => {
    const ledger = new FigureLedger();
    ledger.record("receivables", content(null, [{ amount: 10 }, { amount: 10 }, { amount: 10.01 }]));
    const result = ok(
      calculate(ledger, {
        operation: "average",
        figures: "receivables.rows[0].amount, receivables.rows[1].amount, receivables.rows[2].amount",
      }),
    );
    expect(result.result).toBe("$10.00");
  });
});

describe("what it refuses", () => {
  it("refuses a figure that is not in this turn's tool results", () => {
    // THE WHOLE POINT. Nothing the model types is a number, and a path it
    // invents resolves to nothing.
    const outcome = calculate(ledgerWithEverything(), {
      operation: "sum",
      figures: "receivables.rows[0].outstanding, receivables.rows[9].outstanding",
    });
    expect(outcome).toHaveProperty("problem");
    const problem = outcome as { problem: string; availableFigures?: string[] };
    expect(problem.problem).toContain("receivables.rows[9].outstanding");
    expect(problem.availableFigures).toContain("receivables.rows[0].outstanding");
    expect(outcome).not.toHaveProperty("result");
  });

  it("refuses a made-up tool entirely", () => {
    const outcome = calculate(ledgerWithEverything(), {
      operation: "sum",
      figures: "bank_balance.total, receivables.rows[0].outstanding",
    });
    expect(outcome).toHaveProperty("problem");
    expect(outcome).not.toHaveProperty("result");
  });

  it("refuses dollars added to hours", () => {
    const outcome = calculate(ledgerWithEverything(), {
      operation: "sum",
      figures: "job_labor_cost.rows[0].burdenedLaborCost, job_labor_cost.rows[0].hoursLogged",
    });
    expect(outcome).toHaveProperty("unavailable");
    expect((outcome as { unavailable: string }).unavailable).toMatch(/not the same kind/i);
  });

  it("refuses a count added to an amount", () => {
    const outcome = calculate(ledgerWithEverything(), {
      operation: "sum",
      figures: "receivables.outstandingInvoiceCount, receivables.rows[0].outstanding",
    });
    expect(outcome).toHaveProperty("unavailable");
  });

  it("refuses days added to dollars", () => {
    const outcome = calculate(ledgerWithEverything(), {
      operation: "sum",
      figures: "receivables.rows[0].daysOverdue, receivables.rows[0].outstanding",
    });
    expect(outcome).toHaveProperty("unavailable");
  });

  it("refuses a field it has no kind for, rather than guessing one", () => {
    // `invoice` is an invoice NUMBER. Summing two of them is arithmetic
    // that works and means nothing.
    const outcome = calculate(ledgerWithEverything(), {
      operation: "sum",
      figures: "receivables.rows[0].invoice, receivables.rows[1].invoice",
    });
    expect(outcome).toHaveProperty("unavailable");
    expect((outcome as { unavailable: string }).unavailable).toContain("invoice");
  });

  it("refuses the same figure named twice", () => {
    const outcome = calculate(ledgerWithEverything(), {
      operation: "sum",
      figures: "receivables.rows[0].outstanding, receivables.rows[0].outstanding",
    });
    expect(outcome).toHaveProperty("problem");
    expect(outcome).not.toHaveProperty("result");
  });

  it("refuses an operation it does not have", () => {
    const outcome = calculate(ledgerWithEverything(), {
      operation: "multiply",
      figures: "receivables.rows[0].outstanding, receivables.rows[1].outstanding",
    });
    expect(outcome).toHaveProperty("problem");
  });

  it("refuses a difference of three figures", () => {
    const outcome = calculate(ledgerWithEverything(), {
      operation: "difference",
      figures:
        "receivables.rows[0].outstanding, receivables.rows[1].outstanding, receivables.rows[2].outstanding",
    });
    expect(outcome).toHaveProperty("problem");
  });

  it("refuses when no figures were named at all", () => {
    expect(calculate(ledgerWithEverything(), { operation: "sum", figures: "" })).toHaveProperty("problem");
    expect(calculate(ledgerWithEverything(), { operation: "sum" })).toHaveProperty("problem");
  });
});

describe("a canonical figure wins", () => {
  it("refuses a sum that covers every retainage row, and names the figure that owns it", () => {
    const outcome = calculate(ledgerWithEverything(), {
      operation: "sum",
      figures: "retainage_held.rows[0].stillHeld, retainage_held.rows[1].stillHeld",
    });
    expect(outcome).toHaveProperty("problem");
    expect((outcome as { problem: string }).problem).toContain("companyWideStillHeld");
    expect(outcome).not.toHaveProperty("result");
  });

  it("refuses a sum of every receivables row, and points at the cash-flow total", () => {
    const outcome = calculate(ledgerWithEverything(), {
      operation: "sum",
      figures:
        "receivables.rows[0].outstanding, receivables.rows[1].outstanding, receivables.rows[2].outstanding",
    });
    expect(outcome).toHaveProperty("problem");
    expect((outcome as { problem: string }).problem).toContain("arOutstanding");
  });

  it("allows a SUBSET of the same rows, which is what the tool is for", () => {
    const result = ok(
      calculate(ledgerWithEverything(), {
        operation: "sum",
        figures: "receivables.rows[0].outstanding, receivables.rows[1].outstanding",
      }),
    );
    expect(result.resultValue).toBe(48400);
  });

  it("refuses the whole-population sum of hours and of burdened labor cost", () => {
    for (const field of ["hoursLogged", "burdenedLaborCost"]) {
      const outcome = calculate(ledgerWithEverything(), {
        operation: "sum",
        figures: `job_labor_cost.rows[0].${field}, job_labor_cost.rows[1].${field}`,
      });
      expect(outcome, field).toHaveProperty("problem");
    }
  });

  it("names a canonical for every entry, and every entry names a real tool", () => {
    expect(CANONICAL.length).toBeGreaterThan(0);
    const names = new Set<string>(TOOLS.map((tool) => tool.name));
    for (const entry of CANONICAL) {
      expect(names.has(entry.tool), `${entry.tool} is not a tool`).toBe(true);
      expect(kindOf(entry.tool, entry.field), `${entry.tool}.${entry.field} is not combinable`).not.toBeNull();
      expect(entry.instead.length).toBeGreaterThan(10);
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});

describe("the kind table is pinned to the handlers it was read from", () => {
  const HANDLERS = readFileSync(
    fileURLToPath(new URL("./handlers.ts", import.meta.url)),
    "utf8",
  );

  it("read the handlers file it is checking against", () => {
    // Scope, asserted rather than assumed: a check that reads the wrong
    // path finds nothing and would otherwise report that as clean.
    expect(HANDLERS.length).toBeGreaterThan(50_000);
  });

  it("declares exactly the fields it was written with", () => {
    // A bare size, and this one is allowed to change — but only by somebody
    // editing this number on purpose, which is the point.
    expect(COMBINABLE.length).toBe(48);
  });

  it("names only real tools", () => {
    const names = new Set<string>(TOOLS.map((tool) => tool.name));
    for (const entry of COMBINABLE) {
      expect(names.has(entry.tool), `${entry.tool} is not a tool in TOOLS`).toBe(true);
    }
  });

  it("names only fields that still exist in handlers.ts", () => {
    for (const entry of COMBINABLE) {
      // `:` for a written key, `,` for the shorthand form handlers.ts uses
      // where a local already holds the value (`amount,`, `paid,`). A
      // presence check, and honestly no stronger than that: it catches a
      // rename or a deletion, which is what it is for.
      const asKey = new RegExp(`\\b${entry.field}\\s*[:,]`);
      expect(asKey.test(HANDLERS), `${entry.tool}.${entry.field} is no longer a key in handlers.ts`).toBe(true);
    }
  });

  it("treats `count` as a count for every tool, because forModel adds it to every rowed result", () => {
    expect(kindOf("receivables", "count")).toBe("count");
    expect(kindOf("open_rfis", "count")).toBe("count");
  });

  it("has no kind for a field nobody listed", () => {
    expect(kindOf("receivables", "invoice")).toBeNull();
    expect(kindOf("job_margin", "somethingNew")).toBeNull();
  });
});

describe("what the model is told", () => {
  it("tells it to pass paths and never numbers", () => {
    expect(CALCULATE_TOOL.description).toMatch(/You do not pass numbers/);
    expect(CALCULATE_TOOL.input_schema.properties.figures.description).toMatch(/Never a number/i);
  });

  it("tells it when NOT to use the tool, by naming the canonical figures", () => {
    expect(CALCULATE_TOOL.description).toMatch(/DO NOT USE IT WHEN A TOOL ALREADY HAS THE TOTAL/);
    expect(CALCULATE_TOOL.description).toContain("arOutstanding");
    expect(CALCULATE_TOOL.description).toContain("companyWideStillHeld");
    expect(CALCULATE_TOOL.description).toContain("job_labor_cost");
  });

  it("carries only the three fields the API accepts", () => {
    expect(Object.keys(CALCULATE_TOOL).sort()).toEqual(["description", "input_schema", "name"]);
  });
});
