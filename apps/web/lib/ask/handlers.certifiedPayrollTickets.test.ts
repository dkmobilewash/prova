import { describe, expect, it, vi } from "vitest";

/**
 * certified_payroll and tm_tickets — the two highest-stakes tools of the
 * eight the census found unreachable.
 *
 * Each exists to make a distinction that the obvious answer flattens:
 *
 *   - "certified payroll WENT IN", "a certified payroll is ON RECORD here"
 *     and "certified payroll COULD be produced" are THREE different
 *     sentences. The first is unknowable — nothing records a submission, no
 *     agency, no send date, no receipt — and a tool that let it be inferred
 *     would be putting a person's name under a criminal certification on the
 *     strength of an app that never saw the filing. The second and third are
 *     both knowable and are not each other, so they are two fields.
 *
 *     This tool used to refuse the middle one too, claiming it "does NOT and
 *     CANNOT say whether a week was FILED" — while `lib/alerts-query.ts` read
 *     `ComplianceDocument` rows of type CERTIFIED_PAYROLL to raise the alert
 *     `needs_attention` surfaces. One tool in the box refusing what another
 *     tool in the same box reports;
 *   - a SIGNED T&M ticket is not a BILLED one. Nothing links a ticket to a
 *     change order or an invoice, so "signed" must not read as "settled".
 */

const TODAY = "2026-09-17";

/** Two payroll weeks on Riverside and one on Cedar Park.
 *
 * Week ending 2026-09-12 (Sun 6th → Sat 12th) is the CLEAN one.
 * Week ending 2026-09-19 carries all three holes, one per worker, so a
 * handler that collapsed them into a single "incomplete" flag fails.
 */
const ENTRIES = [
  // ── clean week on Riverside ──
  {
    date: new Date("2026-09-08T00:00:00.000Z"),
    hours: 8,
    payType: "STRAIGHT",
    employeeUserId: "u-tino",
    crewMemberId: null,
    craftClassificationId: "craft-drywall",
    job: { name: "Riverside Medical" },
    employeeUser: { name: "Tino Alvarez", email: "tino@example.com" },
    crewMember: null,
  },
  {
    date: new Date("2026-09-09T00:00:00.000Z"),
    hours: 8,
    payType: "STRAIGHT",
    employeeUserId: "u-tino",
    crewMemberId: null,
    craftClassificationId: "craft-drywall",
    job: { name: "Riverside Medical" },
    employeeUser: { name: "Tino Alvarez", email: "tino@example.com" },
    crewMember: null,
  },
  // ── the week with holes, same job ──
  // Hole 1: a craft with NO rate schedule in force, so the wage column is blank.
  {
    date: new Date("2026-09-15T00:00:00.000Z"),
    hours: 10,
    payType: "STRAIGHT",
    employeeUserId: "u-marco",
    crewMemberId: null,
    craftClassificationId: "craft-unpriced",
    job: { name: "Riverside Medical" },
    employeeUser: { name: "Marco Ruiz", email: "marco@example.com" },
    crewMember: null,
  },
  // Hole 2: no craft at all.
  {
    date: new Date("2026-09-16T00:00:00.000Z"),
    hours: 6,
    payType: "STRAIGHT",
    employeeUserId: "u-dani",
    crewMemberId: null,
    craftClassificationId: null,
    job: { name: "Riverside Medical" },
    employeeUser: { name: "Dani Okafor", email: "dani@example.com" },
    crewMember: null,
  },
  // Hole 3: no NAME on the account. The name column of a WH-347 is a
  // statement to a government agency about who did the work.
  {
    date: new Date("2026-09-17T00:00:00.000Z"),
    hours: 4,
    payType: "OVERTIME",
    employeeUserId: "u-nameless",
    crewMemberId: null,
    craftClassificationId: "craft-drywall",
    job: { name: "Riverside Medical" },
    employeeUser: { name: null, email: "someone@example.com" },
    crewMember: null,
  },
  // ── a different job, so the job filter has something to exclude ──
  {
    date: new Date("2026-09-09T00:00:00.000Z"),
    hours: 8,
    payType: "STRAIGHT",
    employeeUserId: "u-tino",
    crewMemberId: null,
    craftClassificationId: "craft-drywall",
    job: { name: "Cedar Park Elementary" },
    employeeUser: { name: "Tino Alvarez", email: "tino@example.com" },
    crewMember: null,
  },
];

const CRAFTS = [
  {
    id: "craft-drywall",
    fringeRateSchedules: [
      {
        baseWage: 48,
        pensionRate: 9,
        vacationRate: 2,
        healthWelfareRate: 11,
        trainingRate: 1,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: null,
      },
    ],
  },
  // Deliberately EMPTY. A craft somebody created and never priced is the
  // ordinary way a payroll week ends up unpriceable.
  { id: "craft-unpriced", fringeRateSchedules: [] },
];

/**
 * Certified-payroll documents somebody filed, with the period each covers.
 *
 * Arranged so that a handler which ignored them, or which accepted a period
 * that merely CLIPS a week, gets a different answer:
 *
 *   - Riverside's clean week (6-12 Sep) is covered end to end;
 *   - Riverside's holey week (13-19 Sep) has a document covering only its
 *     first three days — a partial period is not evidence about a week;
 *   - Cedar Park's week has nothing on record at all;
 *   - and one document has a null period end, which covers nothing.
 */
const PAYROLL_DOCUMENTS = [
  {
    periodStart: new Date("2026-09-06T00:00:00.000Z"),
    periodEnd: new Date("2026-09-12T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
  },
  {
    // Clips the week and does not contain it.
    periodStart: new Date("2026-09-13T00:00:00.000Z"),
    periodEnd: new Date("2026-09-15T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
  },
  {
    // Half a period cannot contain a week, and guessing the other end of it
    // on a document whose certification is criminal is not a guess worth
    // making.
    periodStart: new Date("2026-09-06T00:00:00.000Z"),
    periodEnd: null,
    job: { name: "Cedar Park Elementary" },
  },
];

const TICKETS = [
  {
    // Old enough that somebody should have chased it.
    workDate: new Date("2026-07-02T00:00:00.000Z"),
    workDescription: "Rework at head-of-wall, GC changed the detail",
    signerName: "Dana Pratt",
    signedAt: new Date("2026-07-03T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
    createdBy: { name: "Miguel Alvarez", email: null },
  },
  {
    workDate: new Date("2026-09-15T00:00:00.000Z"),
    workDescription: "Extra soffit framing, level 3",
    signerName: "Dana Pratt",
    signedAt: new Date("2026-09-15T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
    createdBy: null,
  },
  {
    workDate: new Date("2026-09-01T00:00:00.000Z"),
    workDescription: "Patch after the plumber",
    signerName: "R. Nunez",
    signedAt: new Date("2026-09-02T00:00:00.000Z"),
    job: { name: "Cedar Park Elementary" },
    createdBy: { name: null, email: "hector@example.com" },
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    // Honours the WHERE, because the real one does — and because the job
    // filter living in the QUERY rather than after a `take` is the defect
    // this repo already shipped once in daily_field_reports.
    timeEntry: {
      findMany: async ({ where }: { where: { job?: { name?: { contains?: string } } } }) => {
        const wanted = where.job?.name?.contains?.toLowerCase();
        return wanted ? ENTRIES.filter((e) => e.job.name.toLowerCase().includes(wanted)) : ENTRIES;
      },
    },
    craftClassification: { findMany: async () => CRAFTS },
    // Honours the type and the job filter, because the real one does. A fake
    // that returned every document whatever it was asked for would hide a
    // handler reading COIs as certified payroll.
    complianceDocument: {
      findMany: async ({
        where,
      }: {
        where: { type?: string; job?: { name?: { contains?: string } } };
      }) => {
        if (where.type !== "CERTIFIED_PAYROLL") return [];
        const wanted = where.job?.name?.contains?.toLowerCase();
        return wanted
          ? PAYROLL_DOCUMENTS.filter((d) => d.job.name.toLowerCase().includes(wanted))
          : PAYROLL_DOCUMENTS;
      },
    },
    tmTicket: {
      findMany: async ({ where }: { where: { job?: { name?: { contains?: string } } } }) => {
        const wanted = where.job?.name?.contains?.toLowerCase();
        return wanted ? TICKETS.filter((t) => t.job.name.toLowerCase().includes(wanted)) : TICKETS;
      },
    },
    job: {
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return ["Riverside Medical", "Cedar Park Elementary"].some((n) => n.toLowerCase().includes(wanted))
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

describe("certified_payroll", () => {
  it("NEVER says a week was SUBMITTED, on every row", async () => {
    // The half of the old wording that was right, and it must not be lost in
    // fixing the half that was wrong. Nothing records a payroll submission —
    // no agency, no send date, no receipt — so neither a week that is ready
    // to produce NOR a week with a document on record has been sent anywhere
    // as far as this app knows. Said on each ROW rather than once in a note,
    // because a row is what gets quoted back.
    const rows = (await ask("certified_payroll")).data as {
      submissionToAnAgency: string;
      documentOnRecord: boolean;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    // And the control that makes this mean something: one of these rows DOES
    // have a document on record, so the sentence is not true only of empties.
    expect(rows.some((row) => row.documentOnRecord)).toBe(true);
    for (const row of rows) {
      expect(row.submissionToAnAgency).toMatch(/not recorded/i);
      expect(row.submissionToAnAgency).toMatch(/sent to or received by/i);
    }
  });

  it("SAYS a certified payroll is on record for a week, which it used to refuse", async () => {
    // THE FINDING. The description claimed it "does NOT and CANNOT say
    // whether a week was FILED: nothing in this app records a payroll
    // submission". The second clause is true. The first was not:
    // `ComplianceDocument` of type CERTIFIED_PAYROLL carries a period, and
    // lib/alerts-query.ts has been reading exactly those rows to raise the
    // CERTIFIED_PAYROLL alert `needs_attention` surfaces. So the box refused
    // what the bell beside it reports.
    const rows = (await ask("certified_payroll", { jobName: "Riverside" })).data as {
      weekEnding: string;
      documentOnRecord: boolean;
    }[];
    expect(rows.find((row) => row.weekEnding === "2026-09-12")!.documentOnRecord).toBe(true);
  });

  it("does not accept a period that merely CLIPS the week", async () => {
    // Riverside's 13-19 Sep week has a document covering 13-15 Sep. Counting
    // that as coverage hides a real gap on a document whose certification is
    // criminal — the same containment lib/alerts-query.ts raises the alert
    // from, through the same predicate.
    const rows = (await ask("certified_payroll", { jobName: "Riverside" })).data as {
      weekEnding: string;
      documentOnRecord: boolean;
    }[];
    expect(rows.find((row) => row.weekEnding === "2026-09-19")!.documentOnRecord).toBe(false);
  });

  it("treats a document with a missing period end as covering nothing", async () => {
    // Cedar Park's only document has a null periodEnd. Half a period cannot
    // contain a week.
    const rows = (await ask("certified_payroll", { jobName: "Cedar" })).data as {
      documentOnRecord: boolean;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].documentOnRecord).toBe(false);
  });

  it("keeps ready-to-produce and on-record as two separate facts", async () => {
    // Neither implies the other: a week can be ready with nothing on record,
    // and on record while its data has holes. One field for both would make
    // "ready" read as "in".
    const rows = (await ask("certified_payroll", { jobName: "Riverside" })).data as {
      weekEnding: string;
      readyToProduce: boolean;
      documentOnRecord: boolean;
    }[];
    expect(rows.find((row) => row.weekEnding === "2026-09-12")).toMatchObject({
      readyToProduce: true,
      documentOnRecord: true,
    });
    expect(rows.find((row) => row.weekEnding === "2026-09-19")).toMatchObject({
      readyToProduce: false,
      documentOnRecord: false,
    });
  });

  it("counts the three holes APART, because each sends a different person", async () => {
    // Collapsed into one "incomplete" flag, this week reads as one problem.
    // It is three: somebody has to enter a rate schedule, somebody has to
    // tag a worker's craft, and somebody has to put a name on an account.
    const rows = (await ask("certified_payroll", { jobName: "Riverside" })).data as {
      weekEnding: string;
      hoursWithNoRate: number;
      workersWithNoCraft: number;
      workersWithNoName: number;
      readyToProduce: boolean;
    }[];
    const holey = rows.find((row) => row.weekEnding === "2026-09-19")!;
    expect(holey.hoursWithNoRate).toBe(10);
    expect(holey.workersWithNoCraft).toBe(1);
    expect(holey.workersWithNoName).toBe(1);
    expect(holey.readyToProduce).toBe(false);
  });

  it("calls a complete week ready, so the flag means something", async () => {
    // A flag that is false on every week carries no information. The clean
    // week is the control.
    const rows = (await ask("certified_payroll", { jobName: "Riverside" })).data as {
      weekEnding: string;
      workers: number;
      hours: number;
      readyToProduce: boolean;
    }[];
    const clean = rows.find((row) => row.weekEnding === "2026-09-12")!;
    expect(clean.readyToProduce).toBe(true);
    expect(clean.workers).toBe(1);
    expect(clean.hours).toBe(16);
  });

  it("groups by WEEK and by JOB, not into one pile", async () => {
    const rows = (await ask("certified_payroll")).data as { job: string; weekEnding: string }[];
    // Riverside has two weeks, Cedar Park one. A handler that grouped by
    // job alone, or by week alone, gets a different number here.
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.job === "Riverside Medical")).toHaveLength(2);
    // Newest first.
    expect(rows[0].weekEnding).toBe("2026-09-19");
  });

  it("summarises holes against a real denominator", async () => {
    expect((await ask("certified_payroll", { jobName: "Riverside" })).summary).toEqual({
      weeks: 2,
      weeksReadyToProduce: 1,
      weeksWithHoles: 1,
      weeksWithADocumentOnRecord: 1,
      weeksWithNoDocumentOnRecord: 1,
    });
  });

  it("says a job with no hours is a GAP, not a clean bill", async () => {
    const result = await ask("certified_payroll", { jobName: "Nothing By This Name" });
    expect(result.unavailable).toContain("No job matches");
  });
});

describe("tm_tickets", () => {
  it("says billing is NOT RECORDED rather than reporting a ticket unbilled", async () => {
    // A `billed: false` field would be a claim this app cannot make —
    // nothing links a ticket to a change order or an invoice. The failure
    // it would cause is somebody re-billing work already paid for.
    const rows = (await ask("tm_tickets")).data as { billed: string }[];
    for (const row of rows) {
      expect(row.billed).toMatch(/not recorded/i);
    }
  });

  it("counts the ones old enough to have been forgotten", async () => {
    // 2026-07-03 signed, today 2026-09-17: 76 days. The other two are
    // inside a pay cycle.
    expect((await ask("tm_tickets")).summary).toEqual({ tickets: 3, olderThan30Days: 1 });
  });

  it("dates from the SIGNATURE, not from the work day", async () => {
    // A ticket for Tuesday's work signed three weeks later has been
    // outstanding since it was signed; the work date is what it covers.
    const rows = (await ask("tm_tickets", { jobName: "Riverside" })).data as {
      workDate: string | null;
      signedOn: string | null;
      daysSinceSigned: number;
    }[];
    const old = rows.find((row) => row.workDate === "2026-07-02")!;
    expect(old.signedOn).toBe("2026-07-03");
    expect(old.daysSinceSigned).toBe(76);
  });

  it("says nothing was WRITTEN UP, not that no extra work happened", async () => {
    // The distinction that matters on a T&M ticket more than anywhere: the
    // absence of a ticket is the absence of paperwork, and extra work with
    // no ticket is exactly the thing that never gets paid.
    const result = await ask("tm_tickets", { jobName: "Nothing By This Name" });
    expect(result.unavailable).toContain("No job matches");
  });
});
