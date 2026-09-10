import { describe, expect, it, vi } from "vitest";

/**
 * Issue #103, finding 3: `open_rfis` (and `open_punch_list`,
 * `drawing_currency`, `material_deliveries` — same shape) filtered their
 * OWN rows by job name after the fact. A typo that matches no real job
 * produces the identical empty array to a real job with nothing open on
 * it, so both got the same job-silent sentence — "No RFIs are sent and
 * awaiting an answer" — which reads as company-wide good news rather than
 * "there is no job called that."
 *
 * `job_margin` already got this right (it queries `Job` directly and says
 * "No active job matches that name."); the fix pulls that same check out
 * into `jobNameMismatch` and runs it in the other handlers first.
 *
 * The one real job in this fixture is "Riverside Medical". The company
 * also has an open RFI on it, so the three cases below are:
 *   1. a typo that matches no job at all,
 *   2. the real job name, which has an open RFI (the honest non-empty case),
 *   3. a job name substring that matches nothing.
 */

const RFI = {
  number: 12,
  subject: "Ceiling grid clearance",
  sentOn: new Date("2026-08-01T00:00:00.000Z"),
  dueBy: new Date("2026-08-15T00:00:00.000Z"),
  job: { name: "Riverside Medical — Level 4", contact: { name: "Acme GC" } },
};

const JOBS = [{ id: "job-1", name: "Riverside Medical — Level 4" }];

vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findFirst: async ({ where }: { where: { name: { contains: string } } }) =>
        JOBS.find((j) => j.name.toLowerCase().includes(where.name.contains.toLowerCase())) ?? null,
    },
    rfi: {
      findMany: async () => [RFI],
    },
  },
}));

async function askOpenRfis(jobName?: string) {
  const { runTool } = await import("./handlers");
  return runTool(
    { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
    "open_rfis",
    { jobName },
  );
}

describe("open_rfis job-name resolution", () => {
  it("says no job matches, rather than 'nothing open', on a typo'd job name", async () => {
    const result = await askOpenRfis("Rivrside");
    expect(result.data).toEqual([]);
    expect(result.unavailable).toBe('No job matches "Rivrside".');
    // The exact old-code failure: this sentence must never stand in for a
    // typo'd job name.
    expect(result.unavailable).not.toMatch(/no rfis are sent/i);
  });

  it("answers with the real RFI when the job name actually matches", async () => {
    const result = await askOpenRfis("riverside");
    expect(result.unavailable).toBeUndefined();
    expect((result.data as Array<{ subject: string }>)[0].subject).toBe("Ceiling grid clearance");
  });

  it("still says 'no job matches' for an unrelated but real-looking name", async () => {
    const result = await askOpenRfis("Harborview");
    expect(result.unavailable).toBe('No job matches "Harborview".');
  });

  it("answers company-wide, honestly, when no job name was given at all", async () => {
    const result = await askOpenRfis(undefined);
    expect(result.unavailable).toBeUndefined();
    expect((result.data as unknown[]).length).toBe(1);
  });
});
