import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route's half of the company guarantee: the company comes from the
 * SESSION, and a `companyId` in the query string is ignored. The providers'
 * half — that every query filters on the id it is handed — is
 * lib/search/companyScope.test.ts.
 */

const context = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
const wheres = vi.hoisted(() => [] as { model: string; where: unknown }[]);

vi.mock("@/lib/auth", () => ({ requireApiContext: async () => context.value }));
vi.mock("@prova/db", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, model: string) => ({
        findMany: async (args: { where: unknown }) => {
          wheres.push({ model, where: args.where });
          return [];
        },
      }),
    },
  ),
}));

const { GET } = await import("./route");

const call = (qs: string) => GET(new Request(`http://localhost/api/search${qs}`));

describe("GET /api/search", () => {
  beforeEach(() => {
    wheres.length = 0;
    context.value = null;
  });

  it("answers 401 with no session and runs no query", async () => {
    const res = await call("?q=north");
    expect(res.status).toBe(401);
    expect(wheres).toHaveLength(0);
  });

  it("scopes every query to the session's company, never the query string's", async () => {
    context.value = { companyId: "mine", role: "OWNER", jobFunction: null, company: { isProvaOperator: false } };
    const res = await call("?q=north&companyId=theirs");
    expect(res.status).toBe(200);
    expect(wheres.length).toBeGreaterThan(0);
    for (const { where } of wheres) expect(JSON.stringify(where)).toContain('"companyId":"mine"');
    expect(JSON.stringify(wheres)).not.toContain("theirs");
  });

  it("empty query: recent jobs for the session's company, plus actions and pages", async () => {
    context.value = { companyId: "mine", role: "OWNER", jobFunction: null, company: { isProvaOperator: false } };
    const body = await (await call("?q=")).json();
    expect(wheres).toEqual([expect.objectContaining({ model: "job", where: { companyId: "mine" } })]);
    expect(body.actions.length).toBeGreaterThan(0);
    expect(body.navPages.some((p: { href: string }) => p.href === "/dashboard")).toBe(true);
  });
});
