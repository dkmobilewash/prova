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
 *   - a delay lives in `DelayEvent` since 2026-09-18 and in a free-text box
 *     on the report before that, and the two are not the same evidence: one
 *     has a cause, a responsible party and crew-hours, the other is a
 *     sentence. Reading only the superseded box reported a confident ZERO
 *     for every structured delay since the changeover — see the
 *     daily_field_reports block below;
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

/**
 * Structured delays. The fixture is arranged so that reading ONLY the
 * superseded `DailyFieldReport.delays` column — which is what this handler
 * did until 2026-09-26 — gets a different answer from every assertion below:
 *
 *   - 2026-09-14 Northgate has a structured delay and `delays: null`, so the
 *     old handler called that day clean;
 *   - 2026-09-17 Riverside has a delay and NO REPORT AT ALL, which the old
 *     handler could not represent;
 *   - and 2026-09-15's whitespace `delays` still has to count as no delay,
 *     so nothing structured is put on that day.
 */
const DELAY_EVENTS = [
  {
    date: new Date("2026-09-14T00:00:00.000Z"),
    cause: "OTHER_TRADE",
    responsibleParty: "GC",
    responsibleName: "Baker Electric",
    startMinute: 450,
    endMinute: 690,
    workersAffected: 3,
    // Decimal(7,2) reaches a handler as something String()-able, so the
    // fixture is a string like the real column.
    hoursLost: "12.00",
    description: "Electrician in the corridor ceiling; could not close up",
    gcNotifiedHow: "EMAIL",
    gcNotifiedWho: "Dana Whitcomb (GC super)",
    gcNotifiedAt: new Date("2026-09-14T22:15:00.000Z"),
    changeOrder: null,
    job: { name: "Northgate Apartments" },
  },
  {
    // Nobody filed a report this day, and nobody told the GC. Both facts are
    // what a claim turns on, and both were invisible before.
    date: new Date("2026-09-17T00:00:00.000Z"),
    cause: "MATERIAL",
    responsibleParty: "SUPPLIER",
    responsibleName: null,
    startMinute: null,
    endMinute: null,
    workersAffected: 2,
    hoursLost: "4.50",
    description: "Board delivery never turned up",
    gcNotifiedHow: null,
    gcNotifiedWho: null,
    gcNotifiedAt: null,
    changeOrder: { number: 7 },
    job: { name: "Riverside Medical" },
  },
  {
    // A NORTHGATE delay inside Riverside's date window, and the reason it is
    // here: without it the job scope on the delay read was not load-bearing.
    // Riverside's oldest report is 15 Sep, so the `date: { gte }` bound alone
    // excluded Northgate's 14 Sep delay — and dropping the job clause
    // entirely left every assertion green. A fixture whose two filters
    // happen to exclude the same row cannot tell you which one is working.
    date: new Date("2026-09-16T00:00:00.000Z"),
    cause: "WEATHER",
    responsibleParty: "NOBODY",
    responsibleName: null,
    startMinute: null,
    endMinute: null,
    workersAffected: null,
    // Nobody recorded the hours. Must not be counted as zero-and-fine.
    hoursLost: null,
    description: "Rained out after lunch",
    gcNotifiedHow: "TEXT",
    gcNotifiedWho: "Dana Whitcomb (GC super)",
    gcNotifiedAt: new Date("2026-09-16T20:00:00.000Z"),
    changeOrder: null,
    job: { name: "Northgate Apartments" },
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
    // The 2026-1 issue (effective 4 Mar 2026) on a job advertised 10 Aug:
    // the right issue, but its double-asterisk expiration has passed by
    // TODAY, so a predetermined increase is due.
    determinationRef: "SC-023-31-2, 2026-1",
    issuedOn: new Date("2026-02-22T00:00:00.000Z"),
    expiresOn: new Date("2026-06-30T00:00:00.000Z"),
    expirationMarker: "DOUBLE",
    job: { name: "Riverside Medical", bidAdvertisedOn: new Date("2026-08-10T00:00:00.000Z"), publicWorks: true },
  },
  {
    // Link only, no file. Still producible. No issue date entered, so its
    // standing is unchecked whatever the job says.
    jurisdiction: "Davis-Bacon",
    fileName: null,
    fileUrl: null,
    sourceUrl: "https://sam.gov/wage-determination/CA20260001",
    note: null,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    determinationRef: null,
    issuedOn: null,
    expiresOn: null,
    expirationMarker: null,
    job: { name: "Northgate Apartments", bidAdvertisedOn: new Date("2026-08-10T00:00:00.000Z"), publicWorks: null },
  },
  {
    // NEITHER. A determination in name only — the row this flags. Its dates
    // say 2026-2 (issued 22 Aug, effective 1 Sep) on a job advertised 10
    // Aug: the newer issue, and the wrong one.
    jurisdiction: "California DIR",
    fileName: null,
    fileUrl: null,
    sourceUrl: null,
    note: "PM said he'd send it",
    createdAt: new Date("2026-08-02T00:00:00.000Z"),
    determinationRef: null,
    issuedOn: new Date("2026-08-22T00:00:00.000Z"),
    expiresOn: null,
    expirationMarker: null,
    job: { name: "Northgate Apartments", bidAdvertisedOn: new Date("2026-08-10T00:00:00.000Z"), publicWorks: null },
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
    // Honours the job filter AND the `date: { gte }` bound, because the real
    // one does and because that bound is what keeps a delay whose report fell
    // outside the 40 most recent from being reported as a day nobody wrote up.
    delayEvent: {
      findMany: async ({
        where,
      }: {
        where: { job?: { name?: { contains?: string } }; date?: { gte?: Date } };
      }) => {
        const wanted = where.job?.name?.contains?.toLowerCase();
        const gte = where.date?.gte;
        return DELAY_EVENTS.filter(
          (d) =>
            (wanted ? d.job.name.toLowerCase().includes(wanted) : true) &&
            (gte ? d.date.getTime() >= gte.getTime() : true),
        );
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
// The standing line judges an expiration against the viewer's day, and a
// test that read the real clock would flip from "in force" to "increase
// due" on the morning the fixture's expiration passed.
vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => TODAY }));

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

type ReportRow = {
  job: string;
  date: string | null;
  reportFiled: boolean;
  workPerformed: string | null;
  hasDelay: boolean;
  legacyDelayNote: string | null;
  delays: {
    cause: string;
    responsible: string;
    start: string | null;
    end: string | null;
    crewHoursLost: number | null;
    gcNotified: { how: string; who: string | null; at: string | null } | null;
    changeOrder: string | null;
  }[];
};

describe("daily_field_reports", () => {
  it("reads the STRUCTURED delay log, not just the superseded text box", async () => {
    // THE FINDING. `DailyFieldReport.delays` is marked SUPERSEDED in
    // operations.prisma — one free-text box, replaced 2026-09-18 by
    // DelayEvent — and this handler read only that column. So it reported
    // delays written up before the changeover and a confident ZERO for every
    // structured delay since, on the exact question a delay claim against a
    // GC is assembled from.
    //
    // Northgate's 14 Sep report has `delays: null` and a DelayEvent. Reading
    // only the old column answers hasDelay: false here.
    const rows = (await ask("daily_field_reports")).data as ReportRow[];
    const northgate = rows.find((row) => row.job === "Northgate Apartments" && row.date === "2026-09-14")!;
    expect(northgate.hasDelay).toBe(true);
    expect(northgate.delays).toHaveLength(1);
    expect(northgate.legacyDelayNote).toBeNull();
  });

  it("hands over the cause, the responsible party, the hours and the notice — not a sentence", async () => {
    // What the superseded column could never carry, and what a claim is
    // actually built from. Labelled with the same helpers <DelayLog> renders
    // from, so the box and the job's Field reports tab cannot word a cause
    // differently.
    const rows = (await ask("daily_field_reports")).data as ReportRow[];
    const delay = rows.find((row) => row.date === "2026-09-14")!.delays[0];
    expect(delay).toMatchObject({
      cause: "Another trade in the way",
      responsible: "GC — Baker Electric",
      start: "7:30 am",
      end: "11:30 am",
      crewHoursLost: 12,
    });
    expect(delay.gcNotified).toMatchObject({ how: "Email", who: "Dana Whitcomb (GC super)" });
  });

  it("keeps the legacy free-text note APART from the structured delays", async () => {
    // Merging them would invent a delay that looks measured when it is a
    // sentence somebody typed: no cause, no responsible party, no hours.
    const rows = (await ask("daily_field_reports", { jobName: "Riverside" })).data as ReportRow[];
    const legacy = rows.find((row) => row.date === "2026-09-16")!;
    expect(legacy.legacyDelayNote).toContain("Hoist down 3 hours");
    expect(legacy.delays).toEqual([]);
    expect(legacy.hasDelay).toBe(true);
  });

  it("lists a delay logged on a day NOBODY FILED A REPORT", async () => {
    // A DelayEvent needs no report — `logDelay` writes one against a job and
    // a date. Dropping it for want of a parent row is the same confident zero
    // in a smaller costume.
    const rows = (await ask("daily_field_reports")).data as ReportRow[];
    const orphan = rows.find((row) => row.date === "2026-09-17")!;
    expect(orphan.reportFiled).toBe(false);
    expect(orphan.workPerformed).toBeNull();
    expect(orphan.delays[0]).toMatchObject({ cause: "Material late or wrong", changeOrder: "CO #7" });
  });

  it("says a delay the GC was NOT told about, which is what makes one claimable", async () => {
    const rows = (await ask("daily_field_reports")).data as ReportRow[];
    expect(rows.find((row) => row.date === "2026-09-17")!.delays[0].gcNotified).toBeNull();
    expect((await ask("daily_field_reports")).summary).toMatchObject({ delaysTheGcWasNotTold: 1 });
  });

  it("counts delays, crew-hours and unreported days apart from reports", async () => {
    // Every figure computed here rather than left for the model: a count it
    // works out can differ between two runs of the same question.
    expect((await ask("daily_field_reports")).summary).toEqual({
      reports: 3,
      // 16 Sep's legacy note and 14 Sep's structured delay. One before the
      // changeover, one after — which is the whole point.
      reportsWithADelay: 2,
      reportsWithOnlyALegacyDelayNote: 1,
      delaysLogged: 3,
      daysWithADelayAndNoReportFiled: 2,
      // 12.00 + 4.50. The third delay's hours were never recorded and must
      // not be counted as zero — a blank is not a delay that cost nothing.
      crewHoursLost: 16.5,
      delaysTheGcWasNotTold: 1,
    });
  });

  it("scopes the delays to the same job as the reports", async () => {
    // Two halves of one answer describing different jobs would be worse than
    // either half alone. Northgate's delay must not appear under Riverside.
    const result = await ask("daily_field_reports", { jobName: "Riverside" });
    expect(result.summary).toEqual({
      reports: 2,
      reportsWithADelay: 1,
      reportsWithOnlyALegacyDelayNote: 1,
      delaysLogged: 1,
      daysWithADelayAndNoReportFiled: 1,
      crewHoursLost: 4.5,
      delaysTheGcWasNotTold: 1,
    });
  });

  it("does not count a whitespace-only delay as a delay", async () => {
    // An empty string is what a form submits when somebody tabbed past the
    // field. Counting it puts a delay on the record that nobody wrote.
    const rows = (await ask("daily_field_reports", { jobName: "Riverside" })).data as ReportRow[];
    expect(rows.find((row) => row.date === "2026-09-15")!.hasDelay).toBe(false);
  });

  it("says nobody WROTE ONE UP, not that nothing happened", async () => {
    // The distinction that matters. "No delays on that job" would be a
    // claim about the site; this is a claim about the paperwork.
    const result = await ask("daily_field_reports", { jobName: "Cedar" });
    expect(result.unavailable).toContain("No job matches");

    // Three reports and two delay-only days.
    const rows = (await ask("daily_field_reports")).data as unknown[];
    expect(rows.length).toBe(5);
  });

  it("keeps the newest first, with a delay-only day in its place in the order", async () => {
    // Two rows share 16 Sep — Riverside's report and Northgate's delay-only
    // day — so the job name breaks the tie and the order is total. An
    // unstable order would let the same question answer differently twice.
    const rows = (await ask("daily_field_reports")).data as ReportRow[];
    expect(rows.map((row) => `${row.date} ${row.job}`)).toEqual([
      "2026-09-17 Riverside Medical",
      "2026-09-16 Northgate Apartments",
      "2026-09-16 Riverside Medical",
      "2026-09-15 Riverside Medical",
      "2026-09-14 Northgate Apartments",
    ]);
  });

  it("cites the delay log's own page as well as the field-report list", async () => {
    // /field-reports renders only the legacy note; the structured log is on a
    // job's own Field reports tab. Citing one page for a figure the other
    // holds is a citation nobody can check.
    const result = await ask("daily_field_reports");
    expect(result.citations.map((citation) => citation.label)).toEqual(["Field reports", "Delay log"]);
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

  it("reports each row's standing — read off the entered dates, not researched", async () => {
    const rows = (await ask("wage_determinations")).data as {
      job: string;
      jurisdiction: string;
      standing: string;
      standingLine: string;
      jobBidAdvertisedOn: string | null;
      jobIsPublicWorks: boolean | null;
    }[];

    // Pick by the two fields the tool ACTUALLY returns, and fail naming what
    // was looked for. An earlier version of this test selected rows by
    // `note`, which the tool has never returned: `find` gave undefined, the
    // non-null assertion silenced the typechecker, and the failure read
    // "Cannot read properties of undefined". A selector that can miss has to
    // say so itself (CLAUDE.md: absence of a failure is not a pass).
    const rowCount = 3;
    expect(rows).toHaveLength(rowCount);
    const pick = (job: string, jurisdiction: string) => {
      const found = rows.filter((row) => row.job === job && row.jurisdiction === jurisdiction);
      if (found.length !== 1) {
        throw new Error(
          `expected exactly one ${jurisdiction} row on ${job}, got ${found.length} of ${rows
            .map((row) => `${row.job}/${row.jurisdiction}`)
            .join(", ")}`,
        );
      }
      return found[0];
    };

    // Right issue, expiration passed, double asterisk.
    const riverside = pick("Riverside Medical", "California DIR");
    expect(riverside.standing).toBe("increase_due");
    expect(riverside.standingLine).toContain("Expiration Jun 30, 2026 has passed");
    expect(riverside.jobBidAdvertisedOn).toBe("2026-08-10");
    expect(riverside.jobIsPublicWorks).toBe(true);

    // No issue date entered: unchecked, and it says which date is missing.
    const davisBacon = pick("Northgate Apartments", "Davis-Bacon");
    expect(davisBacon.standing).toBe("unchecked");
    expect(davisBacon.standingLine).toContain("issue date hasn't been entered");
    // "Nobody has said" is null, never false.
    expect(davisBacon.jobIsPublicWorks).toBe(null);

    // The newer issue on a job advertised before it took effect.
    const wrongIssue = pick("Northgate Apartments", "California DIR");
    expect(wrongIssue.standing).toBe("wrong_issue");
    expect(wrongIssue.standingLine).toContain("Not the determination in force on your bid-advertisement date (Aug 10, 2026)");
  });

  it("sums the three kinds of stale in the summary, so 'is anything stale' is one number each", async () => {
    const result = await ask("wage_determinations");
    expect(result.summary).toMatchObject({ wrongIssue: 1, increaseDue: 1, unchecked: 1 });
  });
});
