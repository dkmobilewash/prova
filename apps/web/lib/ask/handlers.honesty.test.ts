import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The five ways Ask stated something false in authoritative prose —
 * issue #103.
 *
 * Every one of these is a wrong ANSWER rather than a crash, which is what
 * makes them expensive: the output reads as considered, the person acts on
 * it, and nothing anywhere reports a disagreement. So each test asserts the
 * exact text or figure that reaches the model, not that a handler ran.
 *
 * No model is called and no database is touched. The fake below honours the
 * `select` the way Prisma does, so a handler that asks for the wrong field
 * gets undefined rather than a convenient value — a fake that returned
 * everything regardless would let a broken handler pass, which is worse
 * than no file at all.
 */

type Select = Record<string, unknown>;

function project(row: Record<string, unknown>, select: Select | undefined): unknown {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(select)) {
    if (!spec) continue;
    const value = row[key];
    const nested =
      typeof spec === "object" && spec !== null && "select" in spec
        ? (spec as { select: Select }).select
        : null;
    if (!nested) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.map((entry) => project(entry as Record<string, unknown>, nested));
    } else {
      out[key] = value == null ? value : project(value as Record<string, unknown>, nested);
    }
  }
  return out;
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** The clock, frozen. `serverToday()` reads it, and an age in days is one
 * of the things under test. */
const TODAY = "2026-09-01";

/**
 * One job, two line items. The first carries a cost forecast; the second
 * carries none, which is what makes the two coverage ratios differ from
 * the percent complete and from each other's obvious value.
 *
 *   line 1: $100,000 of value, $10,000 forecast cost, $4,000 spent → 40%
 *   line 2: $100,000 of value, no forecast at all
 *
 * So percentComplete is 0.4 and both coverage ratios are 0.5 — three raw
 * fractions, which is exactly the shape that used to leave here unscaled.
 */
const JOBS = [
  {
    id: "job-mercy",
    name: "Mercy Tower",
    status: "IN_PROGRESS",
    contact: { name: "Turner", phone: null, paymentTermsDays: null },
    invoices: [{ amount: 20000 }],
    lineItems: [
      {
        description: "Framing",
        quantity: 1,
        unitPrice: 100000,
        budgetedUnitCost: null,
        currentEstimatedUnitCost: 10000,
        estimatedCostToComplete: null,
        costEntries: [{ amount: 4000 }],
      },
      {
        description: "Ceilings",
        quantity: 1,
        unitPrice: 100000,
        budgetedUnitCost: null,
        currentEstimatedUnitCost: null,
        estimatedCostToComplete: null,
        costEntries: [],
      },
    ],
  },
];

/** 41 invitations: forty decided ones due long ago, and the one still open
 * due last. `forModel` keeps 40 rows, so ordered by due date alone the
 * open one is the row that gets cut. */
const BIDS = [
  ...Array.from({ length: 40 }, (_, index) => ({
    projectName: `Old project ${index}`,
    status: index % 2 === 0 ? "WON" : "LOST",
    dueDate: day(`2025-${String((index % 12) + 1).padStart(2, "0")}-01`),
    tradeScope: "Drywall",
    notes: null,
    contact: { name: "Turner" },
  })),
  {
    projectName: "Harbor Point",
    status: "INVITED",
    dueDate: day("2026-10-15"),
    tradeScope: "Drywall",
    notes: null,
    contact: { name: "Skanska" },
  },
];

const DRAWINGS = [
  {
    name: "A-Series",
    job: { name: "Mercy Tower" },
    revisions: [
      {
        id: "rev-1",
        label: "Rev 1",
        issuedOn: day("2026-06-01"),
        receivedOn: day("2026-06-03"),
        description: null,
        fileUrl: null,
        fileName: null,
      },
      {
        id: "rev-2",
        label: "Rev 2",
        issuedOn: day("2026-08-02"),
        receivedOn: null,
        description: null,
        fileUrl: null,
        fileName: null,
      },
    ],
  },
];

/** Empty on purpose: every list-shaped handler under test here is being
 * asked what it says when it finds nothing. */
const EMPTY: unknown[] = [];

vi.mock("@prova/db", () => ({
  prisma: {
    job: { findMany: async (args: { select?: Select }) => JOBS.map((r) => project(r, args.select)) },
    bidInvitation: {
      findMany: async (args: { select?: Select }) => BIDS.map((r) => project(r, args.select)),
    },
    drawingSet: {
      findMany: async (args: { select?: Select }) => DRAWINGS.map((r) => project(r, args.select)),
    },
    rfi: { findMany: async () => EMPTY },
    punchListItem: { findMany: async () => EMPTY },
    materialOrder: { findMany: async () => EMPTY },
    equipment: { findMany: async () => EMPTY },
    invoice: { findMany: async () => EMPTY },
  },
}));

/** Swapped per test: compliance_status's whole defect is what it says when
 * this returns nothing. */
const renewalSources: { rows: unknown[] } = { rows: [] };

vi.mock("@/lib/renewals", () => ({
  renewalSourcesForCompany: async () => renewalSources.rows,
}));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
});

afterAll(() => {
  vi.useRealTimers();
});

async function ask(name: string, input: Record<string, unknown> = {}) {
  const { runTool } = await import("./handlers");
  return runTool("company-1", name as never, input as never);
}

/* --------------------------------------------------------- MONEY-WRONG */

describe("job_margin percentages", () => {
  it("hands over 40.0%, not 0.4", async () => {
    // The model is told never to do arithmetic and to say the number the
    // tool gave it. Handed 0.4 it either says "0.4% complete" — a margin
    // figure 100x wrong — or multiplies by a hundred and breaks the one
    // rule the whole feature rests on.
    const [row] = (await ask("job_margin")).data as { percentComplete: string }[];
    expect(row.percentComplete).toBe("40.0%");
  });

  it("does the same for both coverage ratios", async () => {
    const [row] = (await ask("job_margin")).data as {
      shareOfValueWithACostEstimate: string;
      shareOfValueWithAnEarnedRevenueFigure: string;
    }[];
    expect(row.shareOfValueWithACostEstimate).toBe("50.0%");
    expect(row.shareOfValueWithAnEarnedRevenueFigure).toBe("50.0%");
  });

  it("matches what /jobs/[id] renders off the same figure", async () => {
    // The page does `(percentComplete * 100).toFixed(1)`. Two surfaces
    // deriving one number separately is this codebase's recurring bug, so
    // the assertion is that the strings are identical, not merely close.
    const { calculateJobWip, calculateLineItemWip } = await import("@/lib/wip");
    const wip = calculateJobWip(
      JOBS[0].lineItems.map((line) =>
        calculateLineItemWip({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          budgetedUnitCost: line.budgetedUnitCost,
          currentEstimatedUnitCost: line.currentEstimatedUnitCost,
          estimatedCostToComplete: line.estimatedCostToComplete,
          actualCostToDate: line.costEntries.reduce((sum, entry) => sum + entry.amount, 0),
        }),
      ),
      20000,
    );
    const onScreen = `${((wip.percentComplete as number) * 100).toFixed(1)}%`;
    const [row] = (await ask("job_margin")).data as { percentComplete: string }[];
    expect(row.percentComplete).toBe(onScreen);
  });
});

/* -------------------------------------------------------- SILENT-WRONG */

describe("compliance_status with nothing on file", () => {
  it("does not report a clean bill of health for records that do not exist", async () => {
    renewalSources.rows = [];
    const result = await ask("compliance_status");

    // The exact sentence it used to give: zero sources, zero alerts, and
    // an `unavailable` message the prompt tells the model IS the answer.
    // "Is my GL still good?" from a company that never filed a COI came
    // back as reassurance.
    expect(result.unavailable).not.toContain("is current");
    expect(result.unavailable).toContain("nothing on file");
    expect(result.unavailable).toContain("cannot tell you either way");
    expect(result.summary?.recordsOnFile).toBe(0);
  });

  it("still gives the good news when there is something to be good news about", async () => {
    // The control. Without it, "say nothing is current" would pass by
    // never reassuring anyone about anything.
    renewalSources.rows = [
      {
        id: "coi-1",
        kind: "COI",
        title: "General liability",
        detail: "Travelers",
        date: "2027-06-30",
        expectsDate: true,
        href: "/compliance",
      },
    ];
    const result = await ask("compliance_status");
    expect(result.unavailable).toContain("is current");
    expect(result.summary?.recordsOnFile).toBe(1);
    renewalSources.rows = [];
  });
});

describe("a job name that matches nothing", () => {
  it("says so, instead of answering about the whole company", async () => {
    // "What RFIs are open on Rivrside?" — a typo. This used to come back
    // as "No RFIs are sent and awaiting an answer", which is a true
    // sentence about the company and a dangerously false one about the
    // job the person asked about.
    const result = await ask("open_rfis", { jobName: "Rivrside" });
    expect(result.unavailable).toContain("Rivrside");
    expect(result.unavailable).toContain("not an answer about that job");
    expect(result.unavailable).not.toBe("No RFIs are sent and awaiting an answer.");
  });

  it("names the job when the job exists and simply has nothing open", async () => {
    const result = await ask("open_rfis", { jobName: "Mercy" });
    expect(result.unavailable).toContain("Mercy Tower");
    expect(result.unavailable).not.toContain("not an answer about that job");
  });

  it("answers company-wide only when nobody asked about a job", async () => {
    const result = await ask("open_rfis", {});
    expect(result.unavailable).toBe("No RFIs are sent and awaiting an answer.");
  });

  it("applies to every tool that takes a job name", async () => {
    for (const tool of ["open_punch_list", "material_deliveries", "drawing_currency"]) {
      const result = await ask(tool, { jobName: "Rivrside" });
      expect(result.unavailable, `${tool} answered about the wrong thing`).toContain("Rivrside");
    }
  });
});

describe("bid_status truncation", () => {
  it("keeps the undecided bids when the list is capped at 40", async () => {
    // 41 lifetime invitations, one of them still open. Ordered by due date
    // alone the open one was row 41, so the model was handed 40 decided
    // bids and none of the rows the question was about — and answered
    // "nothing is outstanding" from a slice that could not have said
    // otherwise.
    const { forModel } = await import("./answer");
    const result = await ask("bid_status");
    const sent = forModel(result.data) as { count: number; rows: { status: string }[] };

    expect(sent.count).toBe(41);
    expect(sent.rows).toHaveLength(40);
    expect(sent.rows.some((row) => row.status === "INVITED")).toBe(true);
    // First, not merely present: it is the only live one there is.
    expect(sent.rows[0].status).toBe("INVITED");
  });

  it("counts every status over the whole list, not the part that fits", async () => {
    const result = await ask("bid_status");
    expect(result.summary?.invitedCount).toBe(1);
    expect(result.summary?.undecidedCount).toBe(1);
    expect((result.summary?.wonCount ?? 0) + (result.summary?.lostCount ?? 0)).toBe(40);
  });
});

describe("drawing_currency's promised age", () => {
  it("returns the age its own description promises", async () => {
    // The description said "how old each is" and the handler returned only
    // dates, so the model subtracted them itself and stated the result —
    // the one thing this design forbids, invited by the tool that forbade
    // it.
    const [row] = (await ask("drawing_currency")).data as {
      buildFrom: string;
      currentIssuedOn: string;
      currentIssuedDaysAgo: number;
      issuedButNotReceived: { revision: string; issuedDaysAgo: number }[];
    }[];

    expect(row.buildFrom).toBe("Rev 2");
    expect(row.currentIssuedOn).toBe("2026-08-02");
    // 2026-08-02 to 2026-09-01.
    expect(row.currentIssuedDaysAgo).toBe(30);
    expect(row.issuedButNotReceived[0]).toEqual({
      revision: "Rev 2",
      issuedOn: "2026-08-02",
      issuedDaysAgo: 30,
    });
  });
});
