import { describe, expect, it, vi } from "vitest";

/**
 * The other six of the eight the census found unreachable.
 *
 * Every assertion here is on the ONE distinction the tool exists to make,
 * and in each case the obvious implementation gets it backwards:
 *
 *   - an approved change order that only EDITED lines has no unbilled
 *     figure that can honestly be computed, and folding it in as fully
 *     unbilled invents money;
 *   - a job with no end date is not a job 0% through its programme;
 *   - a line nobody has priced yet is not a line worth nothing;
 *   - a classifier's job HINT is not a filing;
 *   - a person has no pay rate in this app, and reporting one would be
 *     inventing it;
 *   - a dispatch row with no document attached proves nothing in an audit.
 */

const TODAY = "2026-09-17";

const CHANGE_ORDERS = [
  {
    // Added $15,000 of scope, half of it billed on a pay application.
    number: 4,
    title: "Soffit framing, level 3",
    decidedOn: new Date("2026-08-18T00:00:00.000Z"),
    job: {
      name: "Riverside Medical",
      invoices: [{ lineItems: [{ lineItemId: "l-1" }] }],
    },
    addedLineItems: [
      { id: "l-1", quantity: 100, unitPrice: 150, invoiceLineItems: [{ thisPeriodBilled: 7_500 }] },
    ],
    edits: [],
  },
  {
    // Added scope, NOTHING billed. The row somebody is looking for.
    number: 5,
    title: "Extra fire caulking",
    decidedOn: new Date("2026-09-02T00:00:00.000Z"),
    job: {
      name: "Riverside Medical",
      invoices: [{ lineItems: [{ lineItemId: "l-1" }] }],
    },
    addedLineItems: [{ id: "l-2", quantity: 40, unitPrice: 80, invoiceLineItems: [] }],
    edits: [],
  },
  {
    // EDITS ONLY. Nothing separates its uplift from the line's original
    // value once the edit has landed, so it gets no unbilled figure.
    number: 2,
    title: "Reprice the level 2 board",
    decidedOn: new Date("2026-07-10T00:00:00.000Z"),
    job: { name: "Northgate Apartments", invoices: [] },
    addedLineItems: [],
    edits: [{ id: "e-1" }],
  },
  {
    // Added scope on a job billed LUMP SUM — the invoice carries no line
    // breakdown, so this tool cannot see whether it was billed.
    number: 1,
    title: "Ceiling grid revision",
    decidedOn: new Date("2026-06-01T00:00:00.000Z"),
    job: {
      name: "Cedar Park Elementary",
      invoices: [{ lineItems: [] }, { lineItems: [] }],
    },
    addedLineItems: [{ id: "l-3", quantity: 10, unitPrice: 500, invoiceLineItems: [] }],
    edits: [],
  },
];

const JOBS_SCHEDULE = [
  {
    name: "Riverside Medical",
    status: "IN_PROGRESS",
    startDate: new Date("2026-06-01T00:00:00.000Z"),
    endDate: new Date("2026-12-01T00:00:00.000Z"),
    substantialCompletionDate: null,
  },
  {
    // Past its end date.
    name: "Cedar Park Elementary",
    status: "IN_PROGRESS",
    startDate: new Date("2026-03-01T00:00:00.000Z"),
    endDate: new Date("2026-09-01T00:00:00.000Z"),
    substantialCompletionDate: null,
  },
  {
    // NO DATES AT ALL. Must read as unknown, never as 0%.
    name: "Northgate Apartments",
    status: "CONTRACTED",
    startDate: null,
    endDate: null,
    substantialCompletionDate: null,
  },
];

const JOBS_ESTIMATE = [
  {
    name: "Northgate Apartments",
    status: "ESTIMATE",
    lineItems: [
      {
        description: "5/8 Type X, level 1",
        quantity: 200,
        unit: "sheet",
        unitPrice: 14.2,
        laborHours: 60,
        tradeScope: "DRYWALL",
        craftClassification: { name: "Drywall Applicator" },
        originChangeOrder: null,
      },
      {
        // NOT PRICED. Scoped, no number yet.
        description: "Soffit framing, lobby",
        quantity: 1,
        unit: null,
        unitPrice: null,
        laborHours: null,
        tradeScope: "FRAMING",
        craftClassification: null,
        originChangeOrder: null,
      },
      {
        // Arrived on an approved change order, not in the original bid.
        description: "Extra fire caulking",
        quantity: 40,
        unit: "lf",
        unitPrice: 80,
        laborHours: null,
        tradeScope: null,
        craftClassification: null,
        originChangeOrder: { number: 5 },
      },
    ],
    estimateVersions: [{ versionNumber: 3, createdAt: new Date("2026-09-01T00:00:00.000Z"), note: null }],
  },
];

const INTAKE = [
  {
    // Filed against a real job by a person.
    fileName: "riverside-payapp-4.pdf",
    createdAt: new Date("2026-09-16T00:00:00.000Z"),
    proposedKind: "PAY_APP",
    proposedConfidence: "HIGH",
    proposedReason: "Filename and header match a pay application",
    job: { name: "Riverside Medical" },
    jobHint: "Riverside",
    uploadedBy: { name: "Dana Pratt", email: null },
  },
  {
    // A HINT only. Nobody has filed it. Presented as a filing, this is how
    // a pay application ends up on the wrong job.
    fileName: "scan0041.pdf",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    proposedKind: "LIEN_WAIVER",
    proposedConfidence: "LOW",
    proposedReason: "Contains the word 'waiver'",
    job: null,
    jobHint: "Cedar",
    uploadedBy: null,
  },
  {
    fileName: "coi-2027.pdf",
    createdAt: new Date("2026-09-15T00:00:00.000Z"),
    proposedKind: "COMPLIANCE_DOC",
    proposedConfidence: "MEDIUM",
    proposedReason: "Insurance certificate layout",
    job: null,
    jobHint: null,
    uploadedBy: { name: null, email: "office@example.com" },
  },
];

const PEOPLE = [
  {
    name: "Tino Alvarez",
    email: "tino@example.com",
    role: "MEMBER",
    jobFunction: "FIELD",
    timeEntries: [
      { craftClassification: { name: "Drywall Applicator" } },
      { craftClassification: { name: "Drywall Applicator" } },
      { craftClassification: { name: "Lather" } },
    ],
    certifications: [{ id: "c-1" }, { id: "c-2" }],
  },
  {
    // NO NAME. A blank in the name column of a WH-347.
    name: null,
    email: "someone@example.com",
    role: "MEMBER",
    jobFunction: null,
    timeEntries: [{ craftClassification: null }],
    certifications: [],
  },
];

const SLIPS = [
  {
    dispatchNumber: "D-88214",
    dispatchDate: new Date("2026-09-08T00:00:00.000Z"),
    fileUrl: "https://example.blob.vercel-storage.com/d.pdf",
    note: null,
    job: { name: "Riverside Medical" },
    employeeUser: { name: "Tino Alvarez", email: "tino@example.com" },
    craftClassification: {
      name: "Drywall Applicator",
      unionLocal: { parentInternational: "United Brotherhood of Carpenters", localNumber: "213" },
    },
  },
  {
    // A row saying a slip exists is NOT a slip.
    dispatchNumber: null,
    dispatchDate: new Date("2026-09-09T00:00:00.000Z"),
    fileUrl: null,
    note: "Hall said they'd fax it",
    job: { name: "Riverside Medical" },
    employeeUser: { name: null, email: "someone@example.com" },
    craftClassification: null,
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    changeOrder: { findMany: async () => CHANGE_ORDERS },
    documentIntake: { findMany: async () => INTAKE },
    user: { findMany: async () => PEOPLE },
    dispatchSlip: { findMany: async () => SLIPS },
    job: {
      findMany: async ({ select }: { select?: Record<string, unknown> }) =>
        // The two job-reading tools ask for different shapes; the fake
        // answers by what was selected rather than by call order, so
        // reordering the tests cannot silently swap the fixtures.
        select && "lineItems" in select ? JOBS_ESTIMATE : JOBS_SCHEDULE,
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return ["Riverside Medical", "Cedar Park Elementary", "Northgate Apartments"].some((n) =>
          n.toLowerCase().includes(wanted),
        )
          ? { id: "job-1" }
          : null;
      },
    },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

async function ask(name: string, input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, name as any, input);
}

describe("unbilled_change_orders", () => {
  it("finds the approved change order nobody has billed", async () => {
    const rows = (await ask("unbilled_change_orders")).data as {
      changeOrder: string;
      addedValue: number;
      billedToDate: number;
      unbilled: number;
    }[];
    const unbilled = rows.find((row) => row.changeOrder.startsWith("#5"))!;
    expect(unbilled.addedValue).toBe(3_200);
    expect(unbilled.billedToDate).toBe(0);
    expect(unbilled.unbilled).toBe(3_200);
  });

  it("subtracts what HAS been billed rather than reporting the whole value", async () => {
    const rows = (await ask("unbilled_change_orders")).data as { changeOrder: string; unbilled: number }[];
    // $15,000 added, $7,500 billed.
    expect(rows.find((row) => row.changeOrder.startsWith("#4"))!.unbilled).toBe(7_500);
  });

  it("gives an EDITS-ONLY change order NULL, not zero", async () => {
    // The finding, and it is sharper than it first looked. Its uplift is
    // inside a line that was already being billed and nothing separates
    // the two — so `unbilled: 0` would say "nothing outstanding on this
    // change order", which is the false clean bill this tool exists to
    // cure. Zero is an answer; null is the absence of one, and only the
    // second is true.
    //
    // This assertion was `toBe(0)` and a mutation folding these rows into
    // the totals passed all thirty tests, because zero contributes nothing
    // to a sum. The filter was never the protection — the row was.
    const rows = (await ask("unbilled_change_orders")).data as {
      changeOrder: string;
      editsOnly: boolean;
      addedValue: number | null;
      billedToDate: number | null;
      unbilled: number | null;
    }[];
    const edits = rows.find((row) => row.changeOrder.startsWith("#2"))!;
    expect(edits.editsOnly).toBe(true);
    expect(edits.addedValue).toBeNull();
    expect(edits.billedToDate).toBeNull();
    expect(edits.unbilled).toBeNull();

    const summary = (await ask("unbilled_change_orders")).summary!;
    expect(summary.changeOrdersThatOnlyEditedLines).toBe(1);
    // And the total says how many it could not speak for, so a figure
    // computed over 3 of 4 change orders is never read as the book.
    expect(summary.changeOrdersWithNoFigure).toBe(1);
    // $3,200 + $7,500 from the two measurable ones, and $5,000 from the
    // lump-sum job — the edits-only one contributes nothing.
    expect(summary.unbilledTotal).toBe(15_700);
  });

  it("says when it CANNOT see the billing, instead of calling it unbilled", async () => {
    // A change order billed on a plain lump-sum invoice has no line rows
    // to read. Reported rather than hidden: the row still shows unbilled,
    // and the count beside it is what stops that being read as a fact.
    const rows = (await ask("unbilled_change_orders")).data as {
      changeOrder: string;
      lumpSumInvoicesOnJob: number;
      billingVisible: boolean;
    }[];
    const lump = rows.find((row) => row.changeOrder.startsWith("#1"))!;
    expect(lump.lumpSumInvoicesOnJob).toBe(2);
    expect(lump.billingVisible).toBe(false);
    expect((await ask("unbilled_change_orders")).summary!.changeOrdersWhereBillingIsPartlyInvisible).toBe(1);
  });

  it("keeps billing VISIBLE where every invoice has a breakdown", async () => {
    // The control. A flag false on every row carries no information.
    const rows = (await ask("unbilled_change_orders")).data as {
      changeOrder: string;
      billingVisible: boolean;
    }[];
    expect(rows.find((row) => row.changeOrder.startsWith("#4"))!.billingVisible).toBe(true);
  });
});

describe("schedule_status", () => {
  it("reports a job past its end date with a NEGATIVE day count", async () => {
    const rows = (await ask("schedule_status")).data as {
      job: string;
      daysToScheduledEnd: number | null;
      pastScheduledEnd: boolean;
    }[];
    const late = rows.find((row) => row.job === "Cedar Park Elementary")!;
    expect(late.daysToScheduledEnd).toBe(-16);
    expect(late.pastScheduledEnd).toBe(true);
  });

  it("says NULL, never 0%, for a job with no dates on file", async () => {
    // The finding. A job with no end date is not a job 0% through its
    // programme, and a zero printed next to a real percentage reads as one.
    const rows = (await ask("schedule_status")).data as {
      job: string;
      scheduleElapsedPercent: number | null;
      daysToScheduledEnd: number | null;
      datesOnFile: boolean;
    }[];
    const blank = rows.find((row) => row.job === "Northgate Apartments")!;
    expect(blank.scheduleElapsedPercent).toBeNull();
    expect(blank.daysToScheduledEnd).toBeNull();
    expect(blank.datesOnFile).toBe(false);
    expect((await ask("schedule_status")).summary!.withoutBothDates).toBe(1);
  });

  it("computes elapsed from the window the person entered", async () => {
    // 1 Jun to 1 Dec is 183 days; today is 108 days in. 59%.
    const rows = (await ask("schedule_status")).data as { job: string; scheduleElapsedPercent: number | null }[];
    expect(rows.find((row) => row.job === "Riverside Medical")!.scheduleElapsedPercent).toBe(59);
  });

  it("carries NO cost figure at all", async () => {
    // /schedule is open because there is no money on it. A cost percentage
    // here would put money on an open surface — and it is also the exact
    // number this tool exists to stop being read as a schedule one.
    const rows = (await ask("schedule_status")).data as Record<string, unknown>[];
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        expect(key.toLowerCase(), JSON.stringify(row)).not.toContain("cost");
        expect(key.toLowerCase()).not.toContain("margin");
        expect(key.toLowerCase()).not.toContain("billed");
      }
    }
  });
});

describe("estimate_detail", () => {
  it("reports an unpriced line as NULL, and counts it", async () => {
    // A line nobody has priced yet is not a line worth nothing. Printed as
    // 0 the two are indistinguishable, and a bid goes out light.
    const rows = (await ask("estimate_detail", { jobName: "Northgate" })).data as {
      line: string;
      unitPrice: number | null;
      lineValue: number | null;
    }[];
    const unpriced = rows.find((row) => row.line.startsWith("Soffit"))!;
    expect(unpriced.unitPrice).toBeNull();
    expect(unpriced.lineValue).toBeNull();
    expect((await ask("estimate_detail")).summary!.linesWithNoPrice).toBe(1);
  });

  it("totals only the PRICED lines and names the figure accordingly", async () => {
    // 200 × 14.20 = 2,840, plus 40 × 80 = 3,200.
    const summary = (await ask("estimate_detail")).summary!;
    expect(summary.pricedLinesTotal).toBe(6_040);
    expect(Object.keys(summary)).not.toContain("estimateTotal");
  });

  it("marks the line that arrived on a change order", async () => {
    // "What's in the estimate" and "what did we bid" stopped being the
    // same question the moment a change order was approved.
    const rows = (await ask("estimate_detail")).data as { line: string; fromChangeOrder: string | null }[];
    expect(rows.find((row) => row.line === "Extra fire caulking")!.fromChangeOrder).toBe("#5");
    expect(rows.find((row) => row.line.startsWith("5/8"))!.fromChangeOrder).toBeNull();
    expect((await ask("estimate_detail")).summary!.linesFromChangeOrders).toBe(1);
  });
});

describe("document_intake", () => {
  it("keeps a classifier's HINT apart from a job somebody filed it against", async () => {
    // The finding. A hint presented as a filing is how a pay application
    // ends up on the wrong job.
    const rows = (await ask("document_intake")).data as {
      file: string;
      job: string | null;
      jobHint: string | null;
    }[];
    const filed = rows.find((row) => row.file.startsWith("riverside"))!;
    expect(filed.job).toBe("Riverside Medical");
    expect(filed.jobHint).toBeNull();

    const hinted = rows.find((row) => row.file === "scan0041.pdf")!;
    expect(hinted.job).toBeNull();
    expect(hinted.jobHint).toBe("Cedar");
  });

  it("counts what has been sitting there, and what the classifier was unsure about", async () => {
    expect((await ask("document_intake")).summary).toEqual({
      waiting: 3,
      lowConfidence: 1,
      waitingMoreThan7Days: 1,
      withNoJobAtAll: 1,
    });
  });
});

describe("team_roster", () => {
  it("reports NO pay rate, because a person does not have one here", async () => {
    // Inventing a headline rate is the one thing this tool must not do: a
    // rate belongs to a craft classification and the schedule in force on a
    // date, which is why job_labor_cost prices an hour rather than a person.
    const rows = (await ask("team_roster")).data as Record<string, unknown>[];
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        expect(key.toLowerCase(), JSON.stringify(row)).not.toContain("rate");
        expect(key.toLowerCase()).not.toContain("wage");
        expect(key.toLowerCase()).not.toContain("salary");
      }
    }
  });

  it("lists the crafts somebody has actually worked under, without repeats", async () => {
    const rows = (await ask("team_roster")).data as { email: string; craftsWorkedUnder: string[] }[];
    expect(rows.find((row) => row.email === "tino@example.com")!.craftsWorkedUnder).toEqual([
      "Drywall Applicator",
      "Lather",
    ]);
  });

  it("names the blanks that break a government form", async () => {
    expect((await ask("team_roster")).summary).toEqual({
      people: 2,
      withNoNameOnTheirAccount: 1,
      withNoCertificationOnFile: 1,
      withUntaggedHours: 1,
    });
  });
});

describe("dispatch_slips", () => {
  it("distinguishes a slip on file from a ROW saying there is one", async () => {
    // The distinction an audit turns on, and the same one wage_determinations
    // makes: a record with no document proves nothing.
    const rows = (await ask("dispatch_slips")).data as { worker: string; documentAttached: boolean }[];
    expect(rows.find((row) => row.worker === "Tino Alvarez")!.documentAttached).toBe(true);
    expect(rows.find((row) => row.worker === "someone@example.com")!.documentAttached).toBe(false);
    expect((await ask("dispatch_slips")).summary!.withoutTheDocument).toBe(1);
  });

  it("builds the local from its parts, since a local has no name field", async () => {
    const rows = (await ask("dispatch_slips")).data as { worker: string; local: string | null }[];
    expect(rows.find((row) => row.worker === "Tino Alvarez")!.local).toBe(
      "United Brotherhood of Carpenters Local 213",
    );
  });

  it("says a job with no slips is a GAP, not that nobody was dispatched", async () => {
    const result = await ask("dispatch_slips", { jobName: "Nothing By This Name" });
    expect(result.unavailable).toContain("No job matches");
  });
});
