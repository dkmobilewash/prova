import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Lien waivers were reachable only at the foot of a job's Billing tab. The
 * Money area's lien tool now lands here, and this page links each billed
 * job's waivers — never an estimate's, which has no Billing tab.
 */
vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findMany: vi.fn(async () => [
        { id: "j1", name: "Oak Ave", status: "IN_PROGRESS", contact: { name: "Acme GC" } },
        { id: "j2", name: "Still pricing", status: "ESTIMATE", contact: null },
      ]),
    },
  },
}));
vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({ allowed: true, context: { company: { id: "c1" }, role: "OWNER" } })),
}));
vi.mock("@/lib/lien-deadlines-query", () => ({ loadLienDeadlines: vi.fn(async () => []) }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: vi.fn(async () => new Date("2026-10-11T00:00:00Z")) }));
vi.mock("@/components/LienDeadlinesBoard", () => ({ LienDeadlinesBoard: () => null }));

const { default: Page } = await import("./page");

describe("/lien-deadlines lien waivers", () => {
  it("links each contracted job's waivers on its Billing tab, and no estimate's", async () => {
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('id="lien-waivers"');
    expect(html).toContain('href="/jobs/j1/billing#lien-waivers"');
    expect(html).not.toContain("/jobs/j2/billing");
  });
});
