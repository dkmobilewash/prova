import { describe, expect, it, vi } from "vitest";

/**
 * open_submittals, and the one thing about it that is easy to get wrong.
 *
 * A submittal's state is DERIVED from its latest revision, never stored —
 * the rule the rest of this schema follows. That is not pedantry here. The
 * natural implementation reads `revisions[0]` from a default ordering, or
 * asks "does this submittal have any unreturned revision", and both are
 * wrong in opposite directions on the same row:
 *
 *   - reading the OLDEST revision reports a rejected-and-re-sent submittal
 *     as closed on the very day it most needs chasing;
 *   - asking "any unreturned revision" reports a submittal as open forever
 *     once a single revision was superseded without a response date.
 *
 * The fixture carries one of each, so a handler that gets the rule wrong
 * cannot pass by accident.
 */

const TODAY = "2026-09-17";

const SUBMITTALS = [
  {
    // Sent once, still out. The ordinary open case, and it is LATE.
    number: 1,
    title: "Ceiling grid — shop drawings",
    specSection: "09 51 00",
    job: { name: "Riverside Medical" },
    revisions: [
      {
        revisionNumber: 1,
        sentOn: new Date("2026-08-18T00:00:00.000Z"),
        dueBack: new Date("2026-09-01T00:00:00.000Z"),
        returnedOn: null,
      },
    ],
  },
  {
    // REJECTED at rev 1 and RE-SENT as rev 2. Open on the new revision.
    // A handler reading the oldest revision calls this closed.
    number: 2,
    title: "Fire-rated assembly",
    specSection: "07 84 00",
    job: { name: "Riverside Medical" },
    revisions: [
      {
        revisionNumber: 2,
        sentOn: new Date("2026-09-10T00:00:00.000Z"),
        dueBack: new Date("2026-09-24T00:00:00.000Z"),
        returnedOn: null,
      },
    ],
  },
  {
    // Came back. Not open, and its older revision is irrelevant.
    number: 3,
    title: "Acoustic insulation",
    specSection: null,
    job: { name: "Northgate Apartments" },
    revisions: [
      {
        revisionNumber: 2,
        sentOn: new Date("2026-08-01T00:00:00.000Z"),
        dueBack: new Date("2026-08-15T00:00:00.000Z"),
        returnedOn: new Date("2026-08-14T00:00:00.000Z"),
      },
    ],
  },
  {
    // NEVER SENT. A draft, not something anyone is waiting on — counting it
    // would put the sub's own unfinished paperwork on a list titled "what
    // the GC owes us".
    number: 4,
    title: "Sealant schedule",
    specSection: null,
    job: { name: "Northgate Apartments" },
    revisions: [],
  },
  {
    // Out, with no agreed date back. pastDue must be null, not false — we
    // do not know, and "false" is a claim that it is on time.
    number: 5,
    title: "Door hardware",
    specSection: null,
    job: { name: "Northgate Apartments" },
    revisions: [
      {
        revisionNumber: 1,
        sentOn: new Date("2026-09-15T00:00:00.000Z"),
        dueBack: null,
        returnedOn: null,
      },
    ],
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    submittal: {
      // The handler asks for the latest revision with orderBy desc + take 1.
      // The fixture already holds exactly the revision that query returns,
      // so what is under test is the RULE, not Prisma's ordering.
      findMany: async () => SUBMITTALS,
    },
    job: {
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return SUBMITTALS.some((s) => s.job.name.toLowerCase().includes(wanted)) ? { id: "job-1" } : null;
      },
    },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

async function ask(input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, "open_submittals", input);
}

type Row = {
  job: string;
  submittal: string;
  revision: number;
  daysOutstanding: number | null;
  dueBack: string | null;
  pastDue: boolean | null;
};

describe("open_submittals", () => {
  it("reports only what is still out", async () => {
    const rows = (await ask()).data as Row[];
    // Longest out first: #1 sent 30 days ago, #2 seven, #5 two.
    expect(rows.map((row) => row.submittal)).toEqual([
      "#1 Ceiling grid — shop drawings",
      "#2 Fire-rated assembly",
      "#5 Door hardware",
    ]);
  });

  it("keeps a RE-SENT submittal open, on its new revision", async () => {
    // The finding this file exists for. Reading the first revision instead
    // of the latest reports #2 as returned.
    const rows = (await ask()).data as Row[];
    const resent = rows.find((row) => row.submittal.startsWith("#2"));
    expect(resent, "a re-sent submittal must still be open").toBeDefined();
    expect(resent!.revision).toBe(2);
  });

  it("leaves out a submittal that has never been sent", async () => {
    const rows = (await ask()).data as Row[];
    expect(rows.some((row) => row.submittal.startsWith("#4"))).toBe(false);
  });

  it("leaves out one that came back", async () => {
    const rows = (await ask()).data as Row[];
    expect(rows.some((row) => row.submittal.startsWith("#3"))).toBe(false);
  });

  it("sorts longest-outstanding first, because that is the chase order", async () => {
    const rows = (await ask()).data as Row[];
    const days = rows.map((row) => row.daysOutstanding);
    expect(days).toEqual([...days].sort((a, b) => (b ?? 0) - (a ?? 0)));
    expect(days[0]).toBe(30);
  });

  it("STATES whether each is past due rather than leaving two dates for the model to subtract", async () => {
    const rows = (await ask()).data as Row[];
    expect(rows.find((row) => row.submittal.startsWith("#1"))!.pastDue).toBe(true);
    expect(rows.find((row) => row.submittal.startsWith("#2"))!.pastDue).toBe(false);
  });

  it("says null, not false, when no date back was ever agreed", async () => {
    // "false" would be a claim that it is on time, which nobody knows.
    const rows = (await ask()).data as Row[];
    expect(rows.find((row) => row.submittal.startsWith("#5"))!.pastDue).toBeNull();
  });

  it("distinguishes a job that does not exist from a job with nothing out", async () => {
    const typo = await ask({ jobName: "Rivrside" });
    expect(typo.unavailable).toContain("No job matches");
    expect(typo.data).toEqual([]);

    const real = await ask({ jobName: "Northgate" });
    expect(real.unavailable).toBeUndefined();
    expect((real.data as Row[]).every((row) => row.job === "Northgate Apartments")).toBe(true);
  });
});
