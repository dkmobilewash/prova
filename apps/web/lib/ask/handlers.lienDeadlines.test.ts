import { describe, expect, it, vi } from "vitest";

/**
 * lien_deadlines — what the assistant says about the dates that keep a
 * sub's right to get paid.
 *
 * THE FAKES HONOUR THE WHERE CLAUSE. A fake that returns every row whatever
 * it was asked would pass a handler that forgot to scope by company or by
 * job, which are the two mistakes that matter here: another tenant's
 * deadlines in the answer, or a job filter that silently answers for the
 * whole company. So the fixture carries another company's row with a
 * matching job name, and two jobs whose names both contain "Riverside".
 */

const TODAY = "2026-09-18";

type JobRow = { id: string; companyId: string; name: string };
type DeadlineRow = {
  id: string;
  companyId: string;
  jobId: string;
  kind: string;
  otherLabel: string | null;
  dueOn: Date;
  servedOn: Date | null;
  recipient: string | null;
  note: string | null;
};

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const JOBS: JobRow[] = [
  { id: "job-tower", companyId: "company-1", name: "Riverside Tower" },
  { id: "job-annex", companyId: "company-1", name: "Riverside Annex" },
  { id: "job-maple", companyId: "company-1", name: "Maple Street" },
  // A real job with nothing entered against it.
  { id: "job-cedar", companyId: "company-1", name: "Cedar Park" },
  { id: "job-theirs", companyId: "company-2", name: "Riverside Other Tenant" },
];

const DEADLINES: DeadlineRow[] = [
  {
    id: "overdue",
    companyId: "company-1",
    jobId: "job-tower",
    kind: "PRELIMINARY_NOTICE",
    otherLabel: null,
    dueOn: d("2026-09-15"),
    servedOn: null,
    recipient: "Owner: Riverside Holdings LLC",
    note: null,
  },
  {
    id: "due-soon",
    companyId: "company-1",
    jobId: "job-annex",
    kind: "MECHANICS_LIEN",
    otherLabel: null,
    dueOn: d("2026-09-25"),
    servedOn: null,
    recipient: null,
    note: null,
  },
  {
    id: "served-late",
    companyId: "company-1",
    jobId: "job-tower",
    kind: "OTHER",
    otherLabel: "Notice of intent to lien",
    dueOn: d("2026-09-01"),
    servedOn: d("2026-09-04"),
    recipient: "GC",
    note: null,
  },
  {
    id: "far-off",
    companyId: "company-1",
    jobId: "job-maple",
    kind: "BOND_CLAIM",
    otherLabel: null,
    dueOn: d("2026-12-20"),
    servedOn: null,
    recipient: "Travelers (payment bond)",
    note: null,
  },
  {
    // Served ON TIME. Without this row the only served one is served late,
    // and a handler that filed rows as served only when they were late
    // passed every test here — found by mutation.
    id: "served-on-time",
    companyId: "company-1",
    jobId: "job-maple",
    kind: "PRELIMINARY_NOTICE",
    otherLabel: null,
    dueOn: d("2026-09-10"),
    servedOn: d("2026-09-08"),
    recipient: "Owner",
    note: null,
  },
  {
    // Another tenant's overdue notice on a job whose name ALSO matches
    // "Riverside". It must never appear, and must never be counted.
    id: "theirs",
    companyId: "company-2",
    jobId: "job-theirs",
    kind: "STOP_PAYMENT_NOTICE",
    otherLabel: null,
    dueOn: d("2026-09-01"),
    servedOn: null,
    recipient: null,
    note: null,
  },
];

type NameWhere = { companyId: string; name?: { contains: string; mode?: string } };

function jobMatches(job: JobRow, where: NameWhere) {
  if (job.companyId !== where.companyId) return false;
  if (where.name) return job.name.toLowerCase().includes(where.name.contains.toLowerCase());
  return true;
}

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    job: {
      findFirst: async ({ where }: { where: NameWhere }) => JOBS.find((job) => jobMatches(job, where)) ?? null,
      findMany: async ({ where }: { where: NameWhere }) => JOBS.filter((job) => jobMatches(job, where)),
    },
    lienDeadline: {
      findMany: async ({ where }: { where: { companyId: string; jobId?: { in: string[] } } }) =>
        DEADLINES.filter(
          (row) => row.companyId === where.companyId && (!where.jobId || where.jobId.in.includes(row.jobId)),
        ).map((row) => ({
          ...row,
          job: { name: (JOBS.find((job) => job.id === row.jobId) as JobRow).name },
        })),
    },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

type Group = { job: string; unserved: Record<string, unknown>[]; served: Record<string, unknown>[] };

async function ask(input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool(
    { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
    "lien_deadlines",
    input,
  );
}

const groupFor = (jobs: Group[], name: string) => jobs.find((group) => group.job === name) as Group;

describe("lien_deadlines", () => {
  it("summarises overdue unserved, due within 14 days, and served — for this company only", async () => {
    const result = await ask();
    // Another tenant's overdue row would make overdueUnserved 2.
    expect(result.summary).toEqual({ overdueUnserved: 1, dueWithin14Days: 1, served: 2 });
  });

  it("files a notice served on time among the served, with no late note", async () => {
    const { jobs } = (await ask()).data as { jobs: Group[] };
    const maple = groupFor(jobs, "Maple Street");
    expect(maple.served).toEqual([
      { what: "Preliminary notice", recipient: "Owner", deadline: "2026-09-10", deadlineSource: "entered", servedOn: "2026-09-08" },
    ]);
    expect(maple.unserved.map((row) => row.what)).toEqual(["Payment bond claim"]);
  });

  it("never shows another company's deadline, even on a job with a matching name", async () => {
    const { jobs } = (await ask({ jobName: "Riverside" })).data as { jobs: Group[] };
    expect(jobs.map((group) => group.job)).not.toContain("Riverside Other Tenant");
  });

  it("reports an unserved overdue deadline with how many days overdue", async () => {
    const { jobs } = (await ask()).data as { jobs: Group[] };
    const tower = groupFor(jobs, "Riverside Tower");
    expect(tower.unserved).toEqual([
      {
        what: "Preliminary notice",
        recipient: "Owner: Riverside Holdings LLC",
        deadline: "2026-09-15",
        deadlineSource: "entered",
        state: "overdue",
        daysOverdue: 3,
      },
    ]);
  });

  it("reports days LEFT on one not yet due, and never both numbers", async () => {
    const { jobs } = (await ask()).data as { jobs: Group[] };
    const [annex] = groupFor(jobs, "Riverside Annex").unserved;
    expect(annex.daysLeft).toBe(7);
    expect(annex).not.toHaveProperty("daysOverdue");
    expect(annex.state).toBe("due_soon");
  });

  it("keeps a late-served notice among the SERVED, noting the fact without judging it", async () => {
    const { jobs } = (await ask()).data as { jobs: Group[] };
    const tower = groupFor(jobs, "Riverside Tower");
    expect(tower.served).toHaveLength(1);
    expect(tower.served[0].what).toBe("Notice of intent to lien");
    expect(tower.served[0].servedOn).toBe("2026-09-04");
    expect(String(tower.served[0].note)).toContain("for counsel");
    expect(tower.unserved.some((row) => row.what === "Notice of intent to lien")).toBe(false);
  });

  it("answers for EVERY job the name matches, not just the first", async () => {
    const { jobs } = (await ask({ jobName: "riverside" })).data as { jobs: Group[] };
    expect(jobs.map((group) => group.job).sort()).toEqual(["Riverside Annex", "Riverside Tower"]);
  });

  it("filters to the named job — Maple's bond claim is not in a Riverside answer", async () => {
    const result = await ask({ jobName: "Riverside" });
    const { jobs } = result.data as { jobs: Group[] };
    expect(jobs.map((group) => group.job)).not.toContain("Maple Street");
    expect(result.summary).toEqual({ overdueUnserved: 1, dueWithin14Days: 1, served: 1 });
  });

  it("says nothing has been ENTERED — never that no deadline is running — when a job has none", async () => {
    // The most dangerous thing this tool could say is a quiet "none". A job
    // with nothing entered is a job whose date nobody has looked up yet.
    const result = await ask({ jobName: "Cedar" });
    expect(result.unavailable).toContain("No lien deadline has been entered for that job");
    expect(result.unavailable).toContain("not the same as no deadline running");
    expect(result.unavailable).toContain("Do not work one out");
    expect(result.summary).toEqual({ overdueUnserved: 0, dueWithin14Days: 0, served: 0 });

    // And a job that HAS rows gets no such message.
    expect((await ask({ jobName: "Maple" })).unavailable).toBeUndefined();
  });

  it("refuses a job name that matches nothing, rather than answering 'no deadlines'", async () => {
    const result = await ask({ jobName: "Rivrside" });
    expect(result.data).toBeNull();
    expect(result.unavailable).toBe('No job matches "Rivrside".');
  });

  it("is not ALSO listed as a known gap — that list is injected into the system prompt", async () => {
    // Found by mutation: restoring the old "lien deadlines, preliminary
    // notices or stop notices" KNOWN_GAPS entry failed nothing, and it would
    // tell the model to refuse the exact question this tool answers.
    const { KNOWN_GAPS } = await import("./tools");
    expect(KNOWN_GAPS.filter((gap) => /lien|preliminary notice|stop notice/i.test(gap.topic))).toEqual([]);
  });

  it("tells the model, in its own description, that it never computes a deadline", async () => {
    const { TOOLS } = await import("./tools");
    const description = TOOLS.find((tool) => tool.name === "lien_deadlines")?.description ?? "";
    expect(description).toContain("NEVER COMPUTES A LEGAL DEADLINE");
    expect(description).toContain("NOT evidence that no deadline is running");
  });

  it("cites the page it answers from", async () => {
    const result = await ask();
    expect(result.citations).toEqual([{ label: "Lien deadlines", href: "/lien-deadlines" }]);
  });
});
