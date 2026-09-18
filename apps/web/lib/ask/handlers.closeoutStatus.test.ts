import { describe, expect, it, vi } from "vitest";

/**
 * closeout_status — the last of the money, and what is standing in front
 * of it.
 *
 * Two things are asserted here that a reasonable implementation would get
 * wrong without noticing:
 *
 *   - BLOCKER ORDER IS DATA. `closeoutReadiness` returns them most-binding
 *     first so a caller rendering one shows the thing to do next. Sorting,
 *     filtering or de-duplicating them here would silently replace that
 *     judgement with an arbitrary one.
 *   - RETAINAGE IS NOT A BLOCKER. It rides alongside. Folding it into the
 *     list turns "what is stopping us" into a list with an item nobody can
 *     action, and hides the sentence that makes the real ones matter —
 *     this is what they are costing.
 *
 * The labels come from `closeoutPackageLabels`, which /closeout renders, so
 * the answer and the screen cannot describe the same job differently.
 */

const TODAY = "2026-09-17";

const JOBS = [
  {
    id: "job-1",
    name: "Riverside Medical",
    clientName: "Brackett Construction",
    status: "IN_PROGRESS",
    items: [],
    warranty: null,
    requests: [],
    submissions: [],
    openPunchItems: 4,
    retainageBalance: 13_393,
    readiness: {
      stage: "NOT_READY",
      // Deliberately NOT alphabetical and NOT smallest-first, so a handler
      // that sorts produces a different array.
      blockers: [
        { kind: "OPEN_PUNCH_ITEMS", count: 4 },
        { kind: "REQUIRED_ITEMS", count: 2 },
      ],
      retainageAtStake: 13_393,
      daysWithGc: null,
    },
  },
  {
    // Nothing asserted at all. "No checklist" is a blocker, not a pass —
    // and its sentence is the one most worth preserving verbatim.
    id: "job-2",
    name: "Northgate Apartments",
    clientName: "Halvorsen Builders",
    status: "CONTRACTED",
    items: [],
    warranty: null,
    requests: [],
    submissions: [],
    openPunchItems: 0,
    retainageBalance: 0,
    readiness: {
      stage: "NOT_READY",
      blockers: [{ kind: "NO_CHECKLIST", count: 0 }],
      retainageAtStake: 0,
      daysWithGc: null,
    },
  },
  {
    // Clean, submitted, and the GC has been sitting on it for 22 days.
    id: "job-3",
    name: "Cedar Park Elementary",
    clientName: "Halvorsen Builders",
    status: "COMPLETE",
    items: [],
    warranty: null,
    requests: [],
    submissions: [],
    openPunchItems: 0,
    retainageBalance: 6_710,
    readiness: { stage: "AWAITING_GC", blockers: [], retainageAtStake: 6_710, daysWithGc: 22 },
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    job: {
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return JOBS.some((job) => job.name.toLowerCase().includes(wanted)) ? { id: "job-1" } : null;
      },
    },
  },
}));

vi.mock("@/lib/closeout-query", () => ({ loadCloseoutJobs: async () => JOBS }));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

type Row = {
  job: string;
  gc: string | null;
  stage: string;
  blockers: string[];
  openPunchItems: number;
  retainageAtStake: number;
  daysWithGc: number | null;
};

async function ask(input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, "closeout_status", input);
}

describe("closeout_status", () => {
  it("keeps the blockers in the order the readiness gave them", async () => {
    // Most binding first. Re-sorting here replaces a considered order with
    // an arbitrary one, and the caller showing only the first is then
    // showing the wrong thing to do next.
    const rows = (await ask()).data as Row[];
    expect(rows.find((row) => row.job === "Riverside Medical")!.blockers).toEqual([
      "4 punch items still open",
      "2 required documents outstanding",
    ]);
  });

  it("keeps retainage OUT of the blocker list and beside it", async () => {
    const rows = (await ask()).data as Row[];
    const riverside = rows.find((row) => row.job === "Riverside Medical")!;
    expect(riverside.retainageAtStake).toBe(13_393);
    for (const blocker of riverside.blockers) {
      expect(blocker).not.toMatch(/retainage/i);
    }
  });

  it("says nothing has been ASSERTED, which is not the same as nothing being wrong", async () => {
    const rows = (await ask()).data as Row[];
    expect(rows.find((row) => row.job === "Northgate Apartments")!.blockers).toEqual([
      "no closeout checklist yet, so nothing has been asserted",
    ]);
  });

  it("reports a clean job with nothing blocking, and how long the GC has had it", async () => {
    const rows = (await ask()).data as Row[];
    const cedar = rows.find((row) => row.job === "Cedar Park Elementary")!;
    expect(cedar.blockers).toEqual([]);
    expect(cedar.daysWithGc).toBe(22);
    expect(cedar.retainageAtStake).toBe(6_710);
  });

  it("uses the page's own word for the stage rather than the enum", async () => {
    // A fabricated stage would come back undefined from stageLabel, so this
    // also pins the fixture to the real CloseoutStage union.
    const rows = (await ask()).data as Row[];
    expect(rows.map((row) => row.stage)).toEqual([
      "Not ready to submit",
      "Not ready to submit",
      "With the GC",
    ]);
  });

  it("counts how many jobs are actually blocked", async () => {
    expect((await ask()).summary).toEqual({ jobs: 3, jobsBlocked: 2 });
  });

  it("distinguishes a job that does not exist from a job with nothing on it", async () => {
    const typo = await ask({ jobName: "Rivrside" });
    expect(typo.unavailable).toContain("No job matches");

    const real = await ask({ jobName: "Cedar" });
    expect(real.unavailable).toBeUndefined();
    expect((real.data as Row[]).map((row) => row.job)).toEqual(["Cedar Park Elementary"]);
  });
});
