import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /jobs — the jobs list, with its search and stage filters at the TOP.
 *
 * UX test 2026-10-11: the top bar's "Jobs" only scrolled home, the list sat
 * at the bottom of it, and Enter in its search "neither filtered nor said no
 * matches". Rendered from the real page against a fake database that
 * records the query it was asked.
 */

const state = vi.hoisted(() => ({
  jobs: [] as unknown[],
  where: null as unknown,
  context: { company: { id: "co-1" }, role: "OWNER", jobFunction: null as string | null },
}));

vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        state.where = args.where;
        return state.jobs;
      }),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => state.context) }));

const { default: JobsPage } = await import("@/app/(app)/jobs/page");

async function render(params: { q?: string; status?: string } = {}) {
  return renderToStaticMarkup(await JobsPage({ searchParams: Promise.resolve(params) }));
}

const job = (id: string, name: string, status: string) => ({
  id,
  name,
  status,
  contact: { name: "Example GC" },
  lineItems: [{ quantity: 10, unitPrice: 1000 }],
  signatureRequests: [],
  invoices: [],
});

beforeEach(() => {
  state.jobs = [];
  state.where = null;
});

describe("/jobs", () => {
  it("puts the search and the stage filters above the list, and the search is a GET form Enter submits", async () => {
    state.jobs = [job("j1", "Northgate Clinic TI", "IN_PROGRESS"), job("j2", "Harbor Point deck", "ESTIMATE")];
    const html = await render();
    const form = html.match(/<form[^>]*>/)?.[0] ?? "";
    expect(form).toContain('action="/jobs"');
    expect(form).not.toMatch(/method="post"/i);
    expect(html).toMatch(/<input[^>]*type="search"[^>]*name="q"/);
    const search = html.indexOf('name="q"');
    const filters = html.indexOf(">Estimating</a>");
    const list = html.indexOf('data-tour="jobs-list"');
    expect(search).toBeGreaterThan(-1);
    expect(filters).toBeGreaterThan(search);
    expect(list).toBeGreaterThan(filters);
    expect(html).toContain('href="/jobs?status=ESTIMATE"');
    expect(html).toContain("Northgate Clinic TI");
    expect(html).toContain("Harbor Point deck");
  });

  it("filters by what was typed, against job and client name, and keeps the stage", async () => {
    state.jobs = [job("j2", "Harbor Point deck", "ESTIMATE")];
    const html = await render({ q: " Harbor ", status: "ESTIMATE" });
    expect(state.where).toEqual({
      companyId: "co-1",
      status: "ESTIMATE",
      OR: [
        { name: { contains: "Harbor", mode: "insensitive" } },
        { contact: { name: { contains: "Harbor", mode: "insensitive" } } },
      ],
    });
    // The typed text stays in the box and the stage survives a new search.
    expect(html).toContain('value="Harbor"');
    expect(html).toMatch(/<input type="hidden" name="status" value="ESTIMATE"/);
    expect(html).toContain('href="/jobs?q=Harbor"');
  });

  it("says when nothing matches, with a way out", async () => {
    const html = await render({ q: "zzz" });
    expect(html).toContain("No jobs match “zzz”");
    expect(html).toMatch(/href="\/jobs"[^>]*>Clear the search and filters</);
    expect(html).not.toContain('data-tour="jobs-list"');
  });
});
