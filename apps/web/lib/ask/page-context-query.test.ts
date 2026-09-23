import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `resolvePageJob` is the security boundary for the page hint, so what is
 * asserted here is not "does it return a job" — it is "does the query it
 * sends the database carry the company scope".
 *
 * Prisma is faked rather than seeded because the question is about the
 * WHERE CLAUSE, not about rows. A test that seeded two companies and
 * checked the wrong one came back empty would pass just as well against a
 * post-query `if (job.companyId !== companyId)` check — which is the same
 * protection with one more place to forget it. Reading the argument pins
 * the scope where it actually belongs.
 */

const findFirst = vi.fn();
vi.mock("@prova/db", () => ({ prisma: { job: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

const { resolvePageJob } = await import("./page-context-query");

const ID = "cmtx3b4x20007d0pe9ebyh1m4";
const COMPANY = "company_1";

beforeEach(() => {
  findFirst.mockReset();
  findFirst.mockResolvedValue({ id: ID, name: "Riverside Medical Office Building" });
});

describe("resolvePageJob", () => {
  it("SCOPES THE QUERY TO THE CALLER'S COMPANY — the whole point of this module", () => {
    return resolvePageJob(COMPANY, `/jobs/${ID}`).then(() => {
      expect(findFirst).toHaveBeenCalledTimes(1);
      const where = findFirst.mock.calls[0][0].where;
      expect(where).toEqual({ id: ID, companyId: COMPANY });
      // Spelled out separately so a partial match cannot pass: dropping
      // either half is a different bug and both must fail loudly.
      expect(where.companyId).toBe(COMPANY);
      expect(where.id).toBe(ID);
    });
  });

  it("returns the job when it is this company's", async () => {
    await expect(resolvePageJob(COMPANY, `/jobs/${ID}`)).resolves.toEqual({
      id: ID,
      name: "Riverside Medical Office Building",
    });
  });

  it("returns null for another company's job — no row, no oracle", async () => {
    // What the database does to a scoped query that matches nothing. The
    // caller must not be able to tell this apart from a path that named
    // nothing at all, which is why there is no distinct error for it.
    findFirst.mockResolvedValue(null);
    await expect(resolvePageJob(COMPANY, `/jobs/${ID}`)).resolves.toBeNull();
  });

  it("DOES NOT TOUCH THE DATABASE for a path that is not a job page", async () => {
    // Cheap, and it is also the guard against a malformed segment becoming
    // a lookup: the parser rejects it before any query is built.
    for (const path of ["/dashboard", "/jobs", "/jobs/' OR 1=1--", "/jobs/../../etc/passwd", "", undefined]) {
      await expect(resolvePageJob(COMPANY, path as string | undefined)).resolves.toBeNull();
    }
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("selects only the id and the name, so nothing else can leak into a prompt", async () => {
    await resolvePageJob(COMPANY, `/jobs/${ID}`);
    expect(findFirst.mock.calls[0][0].select).toEqual({ id: true, name: true });
  });
});
