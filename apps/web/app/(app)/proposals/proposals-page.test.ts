import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /proposals (declutter, 2026-10-13): the add form waits behind "Add clause",
 * and each clause is a read-only row whose edit form opens on click — every
 * clause used to be an always-open edit form. Rendered from the real page.
 */

vi.mock("@prova/db", () => ({
  prisma: {
    proposalClause: {
      findMany: vi.fn(async () => [{ id: "c-1", kind: "EXCLUSION", text: "Excluded: owner-furnished dumpsters" }]),
    },
  },
}));
vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({ allowed: true, context: { company: { id: "co-1" }, role: "OWNER" } })),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/proposals", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => ({
  addProposalClauseToJob: vi.fn(),
  createProposalClause: vi.fn(),
  deleteProposalClause: vi.fn(),
  removeProposalClause: vi.fn(),
  updateProposalClause: vi.fn(),
}));

const { default: ProposalsPage } = await import("@/app/(app)/proposals/page");

describe("/proposals", () => {
  it("keeps the add form behind its button", async () => {
    const html = renderToStaticMarkup(await ProposalsPage());
    expect(html).toMatch(/data-tour="proposals-add"[^>]*><button[^>]*>Add clause</);
    expect(html).not.toContain('placeholder="Excluded: owner-furnished dumpsters"');
  });

  it("shows each clause as a closed row that opens into its edit form", async () => {
    const html = renderToStaticMarkup(await ProposalsPage());
    const row = html.match(/<details name="proposal-clause"[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(row, "the clause rendered as a row").toContain("Excluded: owner-furnished dumpsters");
    expect(row).not.toMatch(/<details[^>]* open/);
    // The edit form is inside the row, not on the page around it.
    expect(row).toContain('aria-label="Clause text"');
    expect(html.split('aria-label="Clause text"').length - 1).toBe(1);
  });
});
