import { describe, expect, it, vi } from "vitest";

/**
 * retainage_held, and the one number in it that must not be derived here.
 *
 * Issue #97: the metric bar and the Today card each built their own
 * company-wide retainage read, one of them reused a
 * CONTRACTED/IN_PROGRESS job list, and every COMPLETED job's retainage
 * vanished from it — which is precisely the money a sub is still chasing,
 * since retainage comes back at closeout.
 *
 * So the company total here comes from `loadRetainageHeld` and nowhere
 * else, while the per-job rows are built the way /cash-flow builds its
 * table. The fixture makes the loader disagree with the rows ON PURPOSE.
 * That can't happen in production — the two are arithmetically identical —
 * but it is the only way to prove which one the summary is reading, and a
 * handler that quietly summed its own rows would pass every other test in
 * this file.
 */

const JOBS = [
  {
    id: "job-1",
    name: "Riverside Medical",
    status: "IN_PROGRESS",
    substantialCompletionDate: null,
    contact: { name: "Acme GC" },
    invoices: [{ retainageWithheld: 5000 }, { retainageWithheld: 2000 }],
    retainageReleases: [{ amount: 1000 }],
  },
  {
    // COMPLETE, and still holding money. The job #97 dropped.
    id: "job-2",
    name: "Maple Street",
    status: "COMPLETE",
    substantialCompletionDate: new Date("2026-05-01T00:00:00.000Z"),
    contact: { name: "Turner" },
    invoices: [{ retainageWithheld: 4000 }],
    retainageReleases: [],
  },
  {
    // Fully released: nothing held, so it is not a row.
    id: "job-3",
    name: "Harborview",
    status: "COMPLETE",
    substantialCompletionDate: new Date("2026-01-01T00:00:00.000Z"),
    contact: { name: "Skanska" },
    invoices: [{ retainageWithheld: 3000 }],
    retainageReleases: [{ amount: 3000 }],
  },
];

// Deliberately NOT 10,000 (the rows sum to 6,000 + 4,000). If the summary
// ever starts summing the rows, this number disappears and the test says so.
const LOADER_TOTAL = 987_654;

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    job: {
      findMany: async () => JOBS,
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return JOBS.some((job) => job.name.toLowerCase().includes(wanted)) ? { id: "job-1" } : null;
      },
    },
  },
}));

vi.mock("@/lib/retainage-query", () => ({ loadRetainageHeld: async () => LOADER_TOTAL }));

async function ask(input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, "retainage_held", input);
}

describe("retainage_held", () => {
  it("takes the company figure from the one loader, not from summing its own rows", async () => {
    const result = await ask();
    expect(result.summary?.companyWideStillHeld).toBe(LOADER_TOTAL);
  });

  it("keeps a COMPLETE job's balance, which is exactly the money #97 lost", async () => {
    const rows = (await ask()).data as Array<Record<string, unknown>>;
    const maple = rows.find((row) => row.job === "Maple Street")!;
    expect(maple.stillHeld).toBe(4000);
    expect(maple.jobStatus).toBe("COMPLETE");
  });

  it("computes each balance as withheld less released, and drops the ones at zero", async () => {
    const rows = (await ask()).data as Array<Record<string, unknown>>;
    const riverside = rows.find((row) => row.job === "Riverside Medical")!;
    expect(riverside).toMatchObject({ withheldToDate: 7000, releasedToDate: 1000, stillHeld: 6000 });
    // Fully released: withheld 3,000, released 3,000, nothing held.
    expect(rows.map((row) => row.job)).not.toContain("Harborview");
    // Biggest balance first, so "who is holding the most" needs no sorting.
    expect(rows.map((row) => row.job)).toEqual(["Riverside Medical", "Maple Street"]);
  });

  it("flags a balance with no completion date, because there is no date to chase it on", async () => {
    const result = await ask();
    const rows = result.data as Array<Record<string, unknown>>;
    expect(rows.find((row) => row.job === "Riverside Medical")!.substantialCompletionDate).toBeNull();
    expect(rows.find((row) => row.job === "Maple Street")!.substantialCompletionDate).toBe("2026-05-01");
    expect(result.summary?.jobsWithNoCompletionDate).toBe(1);
  });

  it("narrows the rows on a job name without narrowing the company figure", async () => {
    // The company total answers "how much is being held on us" and does not
    // change because the question named one job. Summing the filtered rows
    // into it would make the same question return different totals
    // depending on how it was asked.
    const result = await ask({ jobName: "Maple" });
    expect((result.data as unknown[]).length).toBe(1);
    expect(result.summary?.companyWideStillHeld).toBe(LOADER_TOTAL);
  });

  it("says no job matches a typo rather than reporting no retainage on it", async () => {
    const typo = await ask({ jobName: "Mapel" });
    expect(typo.unavailable).toBe('No job matches "Mapel".');
  });
});
