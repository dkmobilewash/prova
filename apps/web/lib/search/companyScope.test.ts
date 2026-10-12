import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NO SEARCH QUERY MAY RUN WITHOUT THE CALLER'S COMPANY IN ITS WHERE.
 *
 * `providers.dbtest.ts` proves this against a real scratch Postgres, which
 * means it proves it only when somebody runs the db suite. This proves it on
 * every `pnpm test`: a mocked client records every `findMany` the providers
 * and `recentJobs` make, and each one must carry `companyId` — directly, or
 * through `job.companyId` for the two models (change orders, invoices) that
 * have no column of their own. A provider that forgot the filter would
 * return every company's rows, and a mock cannot tell the difference
 * between one company and many, so the assertion is on the WHERE itself.
 *
 * THE COUNT IS ASSERTED TOO (CLAUDE.md: a check that derives its input has
 * two failure modes). If a provider stopped calling `findMany` — or a new one
 * used `findFirst` — "every recorded call is scoped" would pass on an empty
 * list. So the number of calls must equal the number of providers, plus one
 * for `recentJobs`.
 */

const calls: { model: string; args: { where?: Record<string, unknown>; take?: number } }[] = [];

vi.mock("@prova/db", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, model: string) => ({
        findMany: vi.fn(async (args: { where?: Record<string, unknown>; take?: number }) => {
          calls.push({ model, args });
          return [];
        }),
      }),
    },
  ),
}));

const { SEARCH_PROVIDERS, recentJobs } = await import("./providers");

const COMPANY = "company_A";

function scopedTo(where: Record<string, unknown> | undefined): string | undefined {
  if (!where) return undefined;
  if (typeof where.companyId === "string") return where.companyId;
  const job = where.job as { companyId?: unknown } | undefined;
  return typeof job?.companyId === "string" ? job.companyId : undefined;
}

describe("every search query is scoped to the caller's company", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("each provider filters on the company it was given", async () => {
    // A query with digits too, so the number-match branches run as well.
    for (const provider of SEARCH_PROVIDERS) {
      await provider.search({ companyId: COMPANY, query: "north 27", terms: ["north", "27"], limit: 6 });
    }
    expect(calls).toHaveLength(SEARCH_PROVIDERS.length);
    for (const call of calls) {
      expect(scopedTo(call.args.where), `${call.model} query is not scoped to the company`).toBe(COMPANY);
    }
  });

  // The palette searches as you type and fans out to every provider at
  // once; one query without a `take` reads a whole table per keystroke.
  it("each provider is bounded by the limit it was given", async () => {
    for (const provider of SEARCH_PROVIDERS) {
      await provider.search({ companyId: COMPANY, query: "north", terms: ["north"], limit: 6 });
    }
    expect(calls).toHaveLength(SEARCH_PROVIDERS.length);
    for (const call of calls) expect(call.args.take, `${call.model} query has no take`).toBe(6);
  });

  it("recentJobs filters on the company it was given", async () => {
    await recentJobs(COMPANY);
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("job");
    expect(scopedTo(calls[0].args.where)).toBe(COMPANY);
  });
});
