import { describe, expect, it, vi } from "vitest";

/**
 * "Nothing to report" and "nothing on file" are different answers, and the
 * second one is usually the bigger finding.
 *
 * FOUND BY ASKING THE LIVE BOX, not by review. `certification_expiry` was
 * asked "whose certifications are about to expire?" against a database with
 * ZERO certifications and answered:
 *
 *   "Nothing expiring — no expired or soon-to-expire certifications, and
 *    every one on file has a date."
 *
 * Every clause of that is true. "Every one on file has a date" is true of
 * an empty set — the same vacuous truth this branch kept catching in its own
 * tests, shipped this time in a sentence a person reads. And for a union sub
 * "nobody has any cards recorded" is a compliance gap, not a clean bill.
 *
 * Both tools that had a reassuring empty state now distinguish the two. The
 * ones that already said it properly — warranty_obligations' "that is not
 * the same as being clear, nothing was entered", daily_field_reports'
 * "nobody wrote one up, not that nothing happened" — were right because
 * somebody thought about them, which is exactly why these two were not.
 */

const EMPTY: unknown[] = [];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    workerCertification: { findMany: async () => EMPTY },
    submittal: { findMany: async () => EMPTY },
    job: { findFirst: async () => ({ id: "job-1" }) },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-17" }));

async function ask(name: string, input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, name as any, input);
}

describe("an empty register is not a clean bill", () => {
  it("certification_expiry says nothing is RECORDED, not that nothing is expiring", async () => {
    const result = await ask("certification_expiry");
    expect(result.unavailable).toMatch(/gap in the records/i);
    // The old sentence, which was true and misleading. It must not come back.
    expect(result.unavailable).not.toMatch(/every one on file has a date/i);
    expect(result.unavailable).not.toMatch(/^No certification is expired or expiring/);
  });

  it("open_submittals says none has been RAISED, not that they all came back", async () => {
    const result = await ask("open_submittals");
    expect(result.unavailable).toMatch(/No submittal has been raised at all/i);
    expect(result.unavailable).not.toMatch(/every submittal sent has come back/i);
  });
});
