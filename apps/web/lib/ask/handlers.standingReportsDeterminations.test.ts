import { describe, expect, it, vi } from "vitest";

/**
 * apprenticeship_standing, daily_field_reports and wage_determinations —
 * three tools whose whole value is a distinction a summary would flatten.
 *
 *   - "short on hours", "nobody recorded the hours" and "the programme has
 *     no figure to measure against" send three different people to do three
 *     different things. Collapsing them into "not met" sends somebody to
 *     talk to an apprentice about a blank field;
 *   - a job with no field report is a job nobody WROTE UP, which is not a
 *     job where nothing happened;
 *   - a determination row with no file and no link proves nothing, and is
 *     the shape most likely to be mistaken for coverage.
 */

const TODAY = "2026-09-17";

const STANDINGS = [
  {
    apprenticeName: "Tino Alvarez",
    sponsorName: "Carpenters JATC",
    programNumber: "CA-2019-114",
    craftName: "Drywall Applicator",
    localName: "Carpenters Local 213",
    state: "ACTIVE",
    period: 3,
    ojtHoursThisPeriod: 410,
    requiredOjtHoursPerPeriod: 600,
    ojt: "SHORT",
    ojtShortfall: 190,
  },
  {
    // A requirement exists; nobody logged anything. Not the apprentice's
    // problem, and counting it as SHORT sends the wrong person.
    apprenticeName: "Marco Ruiz",
    sponsorName: "Carpenters JATC",
    programNumber: "CA-2019-114",
    craftName: "Lather",
    localName: "Carpenters Local 213",
    state: "ACTIVE",
    period: 1,
    ojtHoursThisPeriod: 0,
    requiredOjtHoursPerPeriod: 600,
    ojt: "NOT_RECORDED",
    ojtShortfall: null,
  },
  {
    // The programme has no figure on file. Saying "short" would invent a
    // standard nobody set.
    apprenticeName: "Dani Okafor",
    sponsorName: "Plasterers JATC",
    programNumber: null,
    craftName: "Plasterer",
    localName: "Plasterers Local 200",
    state: "ACTIVE",
    period: 2,
    ojtHoursThisPeriod: 300,
    requiredOjtHoursPerPeriod: null,
    ojt: "NO_REQUIREMENT_RECORDED",
    ojtShortfall: null,
  },
  {
    // Both end dates set. A data-entry error on a compliance record.
    apprenticeName: "Sam Whitfield",
    sponsorName: "Carpenters JATC",
    programNumber: "CA-2019-114",
    craftName: "Drywall Applicator",
    localName: "Carpenters Local 213",
    state: "CONTRADICTORY",
    period: 4,
    ojtHoursThisPeriod: 600,
    requiredOjtHoursPerPeriod: 600,
    ojt: "MET",
    ojtShortfall: null,
  },
];

const REPORTS = [
  {
    reportDate: new Date("2026-09-16T00:00:00.000Z"),
    workPerformed: "Hung board, level 2 east",
    crewPresent: "Miguel, Hector, Tino",
    weather: "Clear, 78",
    delays: "Hoist down 3 hours, GC electrician working in the shaft",
    job: { name: "Riverside Medical" },
    filedBy: { name: "Miguel Alvarez", email: null },
  },
  {
    reportDate: new Date("2026-09-15T00:00:00.000Z"),
    workPerformed: "Framed corridor partitions",
    crewPresent: "Miguel, Hector",
    weather: null,
    // Empty string, not null. Must not count as a delay.
    delays: "   ",
    job: { name: "Riverside Medical" },
    filedBy: { name: null, email: "hector@example.com" },
  },
  {
    reportDate: new Date("2026-09-14T00:00:00.000Z"),
    workPerformed: "Taping, level 1",
    crewPresent: null,
    weather: null,
    delays: null,
    job: { name: "Northgate Apartments" },
    filedBy: null,
  },
];

const DETERMINATIONS = [
  {
    jurisdiction: "California DIR",
    fileName: "DIR-2026-1.pdf",
    fileUrl: "https://example.blob.vercel-storage.com/dir.pdf",
    sourceUrl: null,
    note: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
  },
  {
    // Link only, no file. Still producible.
    jurisdiction: "Davis-Bacon",
    fileName: null,
    fileUrl: null,
    sourceUrl: "https://sam.gov/wage-determination/CA20260001",
    note: null,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    job: { name: "Northgate Apartments" },
  },
  {
    // NEITHER. A determination in name only — the row this flags.
    jurisdiction: "California DIR",
    fileName: null,
    fileUrl: null,
    sourceUrl: null,
    note: "PM said he'd send it",
    createdAt: new Date("2026-08-02T00:00:00.000Z"),
    job: { name: "Northgate Apartments" },
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    // Honours the WHERE, because the real one does. This fake used to
    // return every row whatever it was asked for, and the test passed only
    // because the handler filtered in memory afterwards — so it could not
    // see that the filter was running AFTER a company-wide `take`. A fake
    // more permissive than the database hides exactly the bug that lives
    // in the query.
    dailyFieldReport: {
      findMany: async ({ where }: { where: { job?: { name?: { contains?: string } } } }) => {
        const wanted = where.job?.name?.contains?.toLowerCase();
        return wanted ? REPORTS.filter((r) => r.job.name.toLowerCase().includes(wanted)) : REPORTS;
      },
    },
    prevailingWageDetermination: { findMany: async () => DETERMINATIONS },
    job: {
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        const names = ["Riverside Medical", "Northgate Apartments"];
        return names.some((name) => name.toLowerCase().includes(wanted)) ? { id: "job-1" } : null;
      },
    },
  },
}));

vi.mock("@/lib/apprenticeship-query", () => ({ loadApprenticeships: async () => STANDINGS }));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

async function ask(name: string, input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, name as any, input);
}

describe("apprenticeship_standing", () => {
  it("counts SHORT apart from hours nobody recorded", async () => {
    // The finding. One apprentice is behind; one has a blank field. Telling
    // an owner "two are short" sends somebody to the wrong conversation.
    const result = await ask("apprenticeship_standing");
    expect(result.summary).toMatchObject({ short: 1, hoursNotRecorded: 1 });
  });

  it("does not call an apprentice short when the programme set no figure", async () => {
    const result = await ask("apprenticeship_standing");
    expect(result.summary).toMatchObject({ noRequirementOnFile: 1 });
    const rows = result.data as { apprentice: string; ojtStanding: string; ojtShortfall: number | null }[];
    const dani = rows.find((row) => row.apprentice === "Dani Okafor")!;
    expect(dani.ojtStanding).toBe("NO_REQUIREMENT_RECORDED");
    expect(dani.ojtShortfall).toBeNull();
  });

  it("surfaces a contradictory enrollment instead of resolving it", async () => {
    const result = await ask("apprenticeship_standing");
    expect(result.summary).toMatchObject({ contradictory: 1 });
    const rows = result.data as { apprentice: string; state: string }[];
    expect(rows.find((row) => row.apprentice === "Sam Whitfield")!.state).toBe("CONTRADICTORY");
  });

  it("carries the shortfall for the one genuinely behind", async () => {
    const rows = (await ask("apprenticeship_standing")).data as {
      apprentice: string;
      ojtShortfall: number | null;
    }[];
    expect(rows.find((row) => row.apprentice === "Tino Alvarez")!.ojtShortfall).toBe(190);
  });
});

describe("daily_field_reports", () => {
  it("flags the reports carrying a delay, which is what a claim is built from", async () => {
    const result = await ask("daily_field_reports", { jobName: "Riverside" });
    expect(result.summary).toEqual({ reports: 2, reportsWithADelay: 1 });
  });

  it("does not count a whitespace-only delay as a delay", async () => {
    // An empty string is what a form submits when somebody tabbed past the
    // field. Counting it puts a delay on the record that nobody wrote.
    const rows = (await ask("daily_field_reports", { jobName: "Riverside" })).data as {
      date: string | null;
      hasDelay: boolean;
    }[];
    expect(rows.find((row) => row.date === "2026-09-15")!.hasDelay).toBe(false);
  });

  it("says nobody WROTE ONE UP, not that nothing happened", async () => {
    // The distinction that matters. "No delays on that job" would be a
    // claim about the site; this is a claim about the paperwork.
    const result = await ask("daily_field_reports", { jobName: "Cedar" });
    expect(result.unavailable).toContain("No job matches");

    const rows = (await ask("daily_field_reports")).data as unknown[];
    expect(rows.length).toBe(3);
  });

  it("keeps the newest first", async () => {
    const rows = (await ask("daily_field_reports")).data as { date: string | null }[];
    expect(rows.map((row) => row.date)).toEqual(["2026-09-16", "2026-09-15", "2026-09-14"]);
  });
});

describe("wage_determinations", () => {
  it("flags a determination with NEITHER a file nor a link", async () => {
    // The row most likely to be mistaken for coverage: it exists, so a
    // count of determinations says the job is covered, and there is
    // nothing to hand an auditor.
    const result = await ask("wage_determinations");
    expect(result.summary).toMatchObject({ determinations: 3, withoutDocumentOrLink: 1 });
  });

  it("treats a source link with no attached file as producible", async () => {
    const rows = (await ask("wage_determinations")).data as {
      jurisdiction: string;
      hasDocument: boolean;
      hasSourceLink: boolean;
      producibleInAnAudit: boolean;
    }[];
    const linkOnly = rows.find((row) => row.jurisdiction === "Davis-Bacon")!;
    expect(linkOnly.hasDocument).toBe(false);
    expect(linkOnly.hasSourceLink).toBe(true);
    expect(linkOnly.producibleInAnAudit).toBe(true);
  });

  it("refuses to call a determination MISSING, because nothing records what is public works", async () => {
    // The tool could easily imply a gap here and be wrong: a job with no
    // determination may simply be private work.
    const result = await ask("wage_determinations", { jobName: "Riverside" });
    expect(result.unavailable).toBeUndefined();

    const rows = result.data as { job: string }[];
    expect(rows.every((row) => row.job === "Riverside Medical")).toBe(true);
  });

  it("counts jobs covered rather than implying every job needs one", async () => {
    const result = await ask("wage_determinations");
    expect(result.summary).toMatchObject({ jobsCovered: 2 });
  });
});
