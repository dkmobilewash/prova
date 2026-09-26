import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * takeoff_currency — whether the quantities came off drawings that are still
 * current.
 *
 * FIVE THINGS THIS FILE EXISTS TO HOLD STILL, and the first two are the whole
 * reason the tool was written rather than the feature being left unreadable:
 *
 *  1. IT NEVER RE-MEASURES. The strongest sentence available is carried out
 *     of `lib/takeoff-currency.ts` verbatim and ends "go and check what moved
 *     — nothing here re-measures anything". A handler that summarised that in
 *     its own words would be the first step toward a corrected quantity, and
 *     a corrected quantity here is a guess printed beside real measurements.
 *  2. UNKNOWABLE SURVIVES AS ITSELF. A plan with no issue date is neither
 *     current nor superseded. Flattening it to current is the dangerous half
 *     of that guess, so the row must say UNKNOWABLE and the count must be
 *     reported separately from the superseded one.
 *  3. IT IS NOT `drawing_currency`. That tool reads `DrawingSet` /
 *     `DrawingRevision` — the job's paper trail. This reads `TakeoffPlan`,
 *     the sheet somebody was emailed with an invitation to bid, and compares
 *     it BY DATE against revisions and addenda. `takeoff.prisma` says the two
 *     must not become each other; the fake below records every model touched,
 *     so a handler that reached for the register instead is caught.
 *  4. The fake HONOURS the where clause, so a handler that forgot to scope by
 *     company returns the other company's job and goes red. A fake that
 *     returned its fixture regardless would pass that mistake.
 *  5. AN EMPTY ANSWER IS NOT GOOD NEWS. With nothing measured anywhere, the
 *     refusal has to say so rather than read as "your quantities are current".
 */

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-26" }));
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: async () => "2026-09-26",
  viewerTimeZone: async () => "UTC",
}));

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type JobRow = { id: string; companyId: string; name: string; status: string; hasPlans: boolean };

const JOBS: JobRow[] = [
  { id: "job-riverside", companyId: "company-1", name: "Riverside Medical", status: "ESTIMATE", hasPlans: true },
  { id: "job-maple", companyId: "company-1", name: "Maple Street Lofts", status: "ESTIMATE", hasPlans: true },
  // No plans: not a job whose quantities are suspect, a job with no takeoff.
  { id: "job-cedar", companyId: "company-1", name: "Cedar Park", status: "IN_PROGRESS", hasPlans: false },
  // ANOTHER COMPANY'S job. Must never appear in company-1's answer.
  { id: "job-other", companyId: "company-2", name: "SOMEONE ELSE'S TAKEOFF", status: "ESTIMATE", hasPlans: true },
];

/** jobId -> the plans measured on it. */
const PLANS: Record<string, { id: string; fileName: string | null; revisionLabel: string | null; sheetIssuedOn: Date | null; pages: { _count: { measurements: number } }[] }[]> = {
  "job-riverside": [
    {
      id: "plan-rev2",
      fileName: "A2-01 Level 4.pdf",
      revisionLabel: "Rev 2",
      sheetIssuedOn: day("2026-09-04"),
      // Eighteen measurements across two sheets of the same plan.
      pages: [{ _count: { measurements: 11 } }, { _count: { measurements: 7 } }],
    },
    {
      id: "plan-undated",
      fileName: "A2-02 reflected ceiling.pdf",
      revisionLabel: null,
      // The honest common case: nobody wrote the title-block date down.
      sheetIssuedOn: null,
      pages: [{ _count: { measurements: 3 } }],
    },
  ],
  "job-maple": [
    {
      id: "plan-current",
      fileName: "Maple A1.pdf",
      revisionLabel: "Rev 1",
      sheetIssuedOn: day("2026-09-20"),
      pages: [{ _count: { measurements: 5 } }],
    },
  ],
  "job-other": [
    {
      id: "plan-other",
      fileName: "NOT OURS.pdf",
      revisionLabel: "Rev 9",
      sheetIssuedOn: day("2026-01-01"),
      pages: [{ _count: { measurements: 99 } }],
    },
  ],
};

/** jobId -> the job's own drawing register. */
const SETS: Record<string, { name: string; revisions: { id: string; label: string; issuedOn: Date; description: string | null }[] }[]> = {
  "job-riverside": [
    {
      name: "Level 4 Architectural",
      revisions: [
        // Issued BEFORE the sheet that was measured: not a supersession.
        { id: "r1", label: "Rev 1", issuedOn: day("2026-08-20"), description: null },
        // Issued AFTER it. This is the one.
        { id: "r3", label: "Rev 3", issuedOn: day("2026-09-11"), description: "Corridor 4B moved 2'-0\" east" },
      ],
    },
  ],
  "job-maple": [],
  "job-other": [],
};

/** jobId -> addenda on a bid somebody LINKED to that job, priced scope only. */
const ADDENDA: Record<string, { id: string; reference: string; issuedOn: Date | null; impactNote: string | null }[]> = {
  "job-riverside": [
    { id: "a4", reference: "Addendum 4", issuedOn: day("2026-09-18"), impactNote: "Soffit detail at the lobby" },
    // No issue date: cannot be placed in time, so it cannot supersede
    // anything — and cannot be said not to. Reported, never dropped.
    { id: "a5", reference: "Addendum 5", issuedOn: null, impactNote: null },
  ],
  "job-maple": [],
  "job-other": [],
};

const touched = new Set<string>();

const jobFindMany = vi.fn(
  async ({ where, take }: { where: { companyId: string; name?: { contains: string } }; take?: number }) => {
    const rows = JOBS.filter(
      (job) =>
        job.companyId === where.companyId &&
        job.hasPlans &&
        (!where.name || job.name.toLowerCase().includes(where.name.contains.toLowerCase())),
    );
    return (take ? rows.slice(0, take) : rows).map((job) => ({ id: job.id, name: job.name, status: job.status }));
  },
);

const jobCount = vi.fn(async ({ where }: { where: { companyId: string; name?: { contains: string } } }) =>
  JOBS.filter(
    (job) =>
      job.companyId === where.companyId &&
      job.hasPlans &&
      (!where.name || job.name.toLowerCase().includes(where.name.contains.toLowerCase())),
  ).length,
);

const jobFindFirst = vi.fn(async ({ where }: { where: { companyId: string; name?: { contains: string } } }) => {
  const match = JOBS.find(
    (job) =>
      job.companyId === where.companyId &&
      (!where.name || job.name.toLowerCase().includes(where.name.contains.toLowerCase())),
  );
  return match ? { id: match.id } : null;
});

const takeoffPlanFindMany = vi.fn(async ({ where }: { where: { jobId: string; companyId: string } }) => {
  const job = JOBS.find((row) => row.id === where.jobId);
  if (!job || job.companyId !== where.companyId) return [];
  return PLANS[where.jobId] ?? [];
});

const drawingSetFindMany = vi.fn(async ({ where }: { where: { jobId: string; companyId: string } }) => {
  const job = JOBS.find((row) => row.id === where.jobId);
  if (!job || job.companyId !== where.companyId) return [];
  return SETS[where.jobId] ?? [];
});

const bidInvitationFindMany = vi.fn(async ({ where }: { where: { companyId: string; wonJobId: string } }) => {
  const job = JOBS.find((row) => row.id === where.wonJobId);
  if (!job || job.companyId !== where.companyId) return [];
  const addenda = ADDENDA[where.wonJobId] ?? [];
  return addenda.length > 0 ? [{ addenda }] : [];
});

vi.mock("@prova/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/db")>();
  const models: Record<string, unknown> = {
    job: { findMany: jobFindMany, count: jobCount, findFirst: jobFindFirst },
    takeoffPlan: { findMany: takeoffPlanFindMany },
    drawingSet: { findMany: drawingSetFindMany },
    bidInvitation: { findMany: bidInvitationFindMany },
  };
  return {
    Prisma: real.Prisma,
    prisma: new Proxy(models, {
      get(target, key: string) {
        touched.add(key);
        return (
          target[key] ?? {
            findMany: async () => [],
            findFirst: async () => null,
            findUnique: async () => null,
            count: async () => 0,
          }
        );
      },
    }),
  };
});

const OWNER = { role: "OWNER" as const, jobFunction: null };

async function ask(jobName?: string, principal: { role: "OWNER" | "MEMBER"; jobFunction: string | null } = OWNER) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: principal as never }, "takeoff_currency", { jobName });
}

type Row = {
  job: string;
  jobStatus: string;
  headline: string | null;
  measurementsOnSupersededPlans: number;
  supersededPlans: number;
  plansWithNoIssueDate: number;
  addendaWithNoIssueDate: string[];
  plans: { state: string; sentence: string; issuedSince: { kind: string; label: string; issuedOn: string; note: string | null }[] }[];
};

const rowsOf = (data: unknown) => (data as { rows: Row[] }).rows;

beforeEach(() => {
  touched.clear();
  jobFindMany.mockClear();
  jobCount.mockClear();
  takeoffPlanFindMany.mockClear();
  drawingSetFindMany.mockClear();
  bidInvitationFindMany.mockClear();
});

describe("takeoff_currency", () => {
  it("answers only about this company's jobs, and only ones with a measured plan", async () => {
    const rows = rowsOf((await ask()).data);
    expect(rows.map((row) => row.job)).toEqual(["Riverside Medical", "Maple Street Lofts"]);
    expect(rows.map((row) => row.job)).not.toContain("SOMEONE ELSE'S TAKEOFF");
    // Cedar Park has no plans and is therefore not a job with suspect numbers.
    expect(rows.map((row) => row.job)).not.toContain("Cedar Park");
    expect(jobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-1" }) }),
    );
  });

  it("names the revision issued since, and how many measurements came off the superseded sheet", async () => {
    const riverside = rowsOf((await ask("Riverside")).data).find((row) => row.job === "Riverside Medical")!;
    expect(riverside.supersededPlans).toBe(1);
    // 11 + 7 on the two sheets of the plan measured off Rev 2.
    expect(riverside.measurementsOnSupersededPlans).toBe(18);
    const superseded = riverside.plans.find((plan) => plan.state === "SUPERSEDED")!;
    expect(superseded.issuedSince.map((item) => item.label)).toEqual([
      // Newest first, and both kinds: a revision on the job's register and an
      // addendum on the bid linked to it.
      "Addendum 4",
      "Level 4 Architectural Rev 3",
    ]);
    expect(superseded.issuedSince[1].note).toContain("Corridor 4B");
  });

  it("carries the library's refusal to re-measure out in the sentence itself", async () => {
    // THE ASSERTION THIS FILE IS FOR. The handler must not paraphrase.
    const riverside = rowsOf((await ask("Riverside")).data).find((row) => row.job === "Riverside Medical")!;
    const superseded = riverside.plans.find((plan) => plan.state === "SUPERSEDED")!;
    expect(superseded.sentence).toMatch(/nothing here re-measures anything/i);
    expect(superseded.sentence).toMatch(/go and check what moved/i);
    expect(riverside.headline).toMatch(/Nothing has been re-measured/i);
    expect(riverside.headline).toMatch(/18 measurements/);
  });

  it("keeps a plan with no issue date UNKNOWABLE rather than calling it current", async () => {
    const riverside = rowsOf((await ask("Riverside")).data).find((row) => row.job === "Riverside Medical")!;
    expect(riverside.plansWithNoIssueDate).toBe(1);
    const unknowable = riverside.plans.find((plan) => plan.state === "UNKNOWABLE")!;
    expect(unknowable.state).not.toBe("CURRENT");
    expect(unknowable.sentence).toMatch(/No issue date recorded/i);
    // And nothing is claimed to have superseded it — it cannot be placed.
    expect(unknowable.issuedSince).toEqual([]);
  });

  it("reports an undated addendum separately instead of dropping it", async () => {
    const riverside = rowsOf((await ask("Riverside")).data).find((row) => row.job === "Riverside Medical")!;
    expect(riverside.addendaWithNoIssueDate).toEqual(["Addendum 5"]);
    // And it is NOT counted as having superseded anything.
    const superseded = riverside.plans.find((plan) => plan.state === "SUPERSEDED")!;
    expect(superseded.issuedSince.map((item) => item.label)).not.toContain("Addendum 5");
  });

  it("says a job whose sheet nothing has followed is current", async () => {
    const maple = rowsOf((await ask()).data).find((row) => row.job === "Maple Street Lofts")!;
    expect(maple.plans.map((plan) => plan.state)).toEqual(["CURRENT"]);
    // No banner: there is nothing to warn about.
    expect(maple.headline).toBeNull();
    expect(maple.measurementsOnSupersededPlans).toBe(0);
  });

  it("sums the counts across every job it read, so nothing has to be counted from the rows", async () => {
    const { summary } = await ask();
    expect(summary).toMatchObject({
      jobsWithMeasuredPlans: 2,
      jobsReviewed: 2,
      supersededPlans: 1,
      plansWithNoIssueDate: 1,
      measurementsOnSupersededPlans: 18,
    });
  });

  it("links to the Takeoff tab of each job with something to check, and no others", async () => {
    const { links } = await ask();
    expect(links).toEqual([
      { label: "Riverside Medical", href: "/jobs/job-riverside/takeoff", detail: expect.stringContaining("18 measurements") },
    ]);
  });

  it("says an empty answer is not a statement that the quantities are current", async () => {
    jobFindMany.mockResolvedValueOnce([]);
    jobCount.mockResolvedValueOnce(0);
    const result = await ask();
    expect(result.unavailable).toMatch(/not a statement that your quantities are current/i);
  });

  it("tells a typo from a real job with nothing to report", async () => {
    // Finding 3 of issue #103: without this, "Rivrside" and a clean job read
    // identically.
    const result = await ask("Rivrside");
    expect(result.unavailable).toBe('No job matches "Rivrside".');
    expect(jobFindMany).not.toHaveBeenCalled();
  });

  it("says so when it read fewer jobs than exist, rather than answering for the set it read", async () => {
    jobCount.mockResolvedValueOnce(57);
    const data = (await ask()).data as { jobsWithMeasuredPlans: number; jobsReviewed: number; note?: string };
    expect(data.jobsWithMeasuredPlans).toBe(57);
    expect(data.jobsReviewed).toBe(2);
    expect(data.note).toMatch(/not every job/i);
  });

  it("never touches the drawing register as its source of measured sheets", async () => {
    await ask();
    // Anti-vacuity first: the proxy did see the reads this tool makes.
    expect(touched.has("takeoffPlan")).toBe(true);
    expect(takeoffPlanFindMany).toHaveBeenCalled();
    // `drawingSet` IS read, deliberately — it is what a measured sheet is
    // compared AGAINST — but only ever for the job's own revisions, and never
    // in place of the plans.
    expect(drawingSetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-1" }) }),
    );
  });

  it("reaches the bid side only through the job somebody linked it to", async () => {
    await ask();
    for (const call of bidInvitationFindMany.mock.calls) {
      // Never a fuzzy name match: one GC sends three invitations per building,
      // so anything looser would warn about another project's measurements.
      expect(call[0].where).toMatchObject({ companyId: "company-1" });
      expect(typeof call[0].where.wonJobId).toBe("string");
    }
  });

  it("is refused to somebody without job-cost access, before any read", async () => {
    const result = await ask(undefined, { role: "MEMBER", jobFunction: "FIELD" });
    expect(result.data).toBeNull();
    expect(jobFindMany).not.toHaveBeenCalled();
    expect(takeoffPlanFindMany).not.toHaveBeenCalled();
  });
});
