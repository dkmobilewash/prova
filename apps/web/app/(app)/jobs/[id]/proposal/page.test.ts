import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The proposal opened FOR ONE GC (`?invitation=<id>`), rendered for real.
 *
 * What a person reads is the claim: this GC is addressed by the name on ITS
 * invitation, the figure is THAT GC's price, the mode choice survives, and with
 * no invitation the page is today's page. The query that finds the invitation
 * is the other half - it must be this company's and this estimate's, because a
 * stale link that fell back to the generic letter would hand a GC a document
 * that looks addressed to them and is not.
 */

const context = { company: { id: "company-1", name: "Test Drywall" }, id: "u1", role: "OWNER", jobFunction: null };

type Invitation = {
  id: string;
  projectName: string;
  contact: { name: string; email: string | null; people: [] };
  priceAdjustAmount: number | null;
  priceAdjustPercent: number | null;
  priceAdjustReason: string | null;
  lines: [];
};

const GC_A: Invitation = {
  id: "inv-a",
  projectName: "Mercy Hospital - Tower B (Acme's name for it)",
  contact: { name: "Acme GC", email: "bids@acme.example", people: [] },
  priceAdjustAmount: null,
  priceAdjustPercent: null,
  priceAdjustReason: null,
  lines: [],
};
const GC_B: Invitation = {
  id: "inv-b",
  projectName: "Mercy Tower B Interiors",
  contact: { name: "BuildCo", email: null, people: [] },
  priceAdjustAmount: null,
  priceAdjustPercent: -5,
  priceAdjustReason: "second job for them",
  lines: [],
};
const GC_BAD: Invitation = { ...GC_B, id: "inv-bad", priceAdjustPercent: null, priceAdjustAmount: -500_000 };

const invitationFindFirst = vi.fn<(args: { where: Record<string, unknown> }) => Promise<Invitation | null>>();
const projectInvitations = [
  { id: "inv-a", projectName: GC_A.projectName, contact: { name: "Acme GC" } },
  { id: "inv-b", projectName: GC_B.projectName, contact: { name: "BuildCo" } },
];

// Two lines: 1,000 SF at $10 and 200 SF at $5 = $11,000.00.
const job = {
  id: "job-1",
  name: "Tower B (our name)",
  scope: null,
  projectLocation: null,
  contact: { name: "First GC on the estimate" },
  lineItems: [
    { id: "l1", description: "Board", unit: "SF", quantity: 1000, unitPrice: 10, budgetedUnitCost: 6, costCategory: null, tradeScope: null, wallTypeComponent: null },
    { id: "l2", description: "Tape", unit: "SF", quantity: 200, unitPrice: 5, budgetedUnitCost: 3, costCategory: null, tradeScope: null, wallTypeComponent: null },
  ],
  proposalClauses: [],
};

vi.mock("@prova/db", () => ({
  prisma: {
    job: { findFirst: vi.fn(async () => job) },
    proposalClauseDraft: { findMany: vi.fn(async () => []) },
    proposalClause: { findMany: vi.fn(async () => []) },
    jobBidRecap: { findFirst: vi.fn(async () => null) },
    bidInvitation: {
      findFirst: (args: { where: Record<string, unknown> }) => invitationFindFirst(args),
      findMany: vi.fn(async () => projectInvitations),
    },
    agentFinding: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/authz", () => ({ requireCapability: async () => ({ context, allowed: true }) }));
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: async () => "UTC" }));
vi.mock("@/lib/estimating/proposal-facts-query", () => ({ loadProposalFacts: async () => [] }));
vi.mock("@prova/integrations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prova/integrations")>()),
  emailSetupProblem: () => null,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
// The client widgets are not the subject; they render as markers.
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/components/NoAccess", () => ({ NoAccess: () => null }));
vi.mock("@/components/ProposalDrafts", () => ({ ProposalDrafts: () => null }));
vi.mock("@/components/ProposalClauses", () => ({
  JobProposalClauseBuilder: () => null,
  JobProposalClauseRow: () => null,
}));
vi.mock("@/components/BidPackageBuilder", () => ({
  BidPackageBuilder: ({ submit }: { submit?: { bidInvitationId: string; gcName: string } }) =>
    createElement("i", { "data-submit": submit ? `${submit.bidInvitationId}:${submit.gcName}` : "none" }),
}));

const { default: JobProposalPage } = await import("./page");

async function render(search: { mode?: string; invitation?: string }, surface?: "crm" | "bid") {
  const element = await JobProposalPage({
    params: Promise.resolve({ id: "job-1" }),
    searchParams: Promise.resolve(search),
    surface,
  });
  return renderToStaticMarkup(element);
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

beforeEach(() => {
  invitationFindFirst.mockReset();
  invitationFindFirst.mockImplementation(async ({ where }) => {
    const id = where.id as string | undefined;
    if (!id) return null; // no linked bid on this job
    return [GC_A, GC_B, GC_BAD].find((row) => row.id === id) ?? null;
  });
});

describe("proposal with no invitation - today's page", () => {
  it("is addressed to the job's GC, titled with the job's name, and priced at the estimate", async () => {
    const html = await render({});
    expect(text(html)).toContain("Proposal — Tower B (our name)");
    expect(text(html)).toContain("Test Drywall to First GC on the estimate");
    expect(text(html)).toContain("$11,000.00");
    expect(html).not.toContain("gc-price-note");
    // The linked-bid lookup is the old one: by the job, never by an id.
    expect(invitationFindFirst.mock.calls[0][0].where).toEqual({ wonJobId: "job-1", companyId: "company-1" });
  });

  it("mode links carry no invitation parameter", async () => {
    const html = await render({ mode: "scope" });
    expect(html).toContain('href="/jobs/job-1/proposal?mode=lump"');
    expect(html).toContain('href="/jobs/job-1/proposal?mode=itemized"');
    const nav = html.slice(html.indexOf('aria-label="Price presentation"'));
    expect(nav.slice(0, nav.indexOf("</nav>"))).not.toContain("invitation=");
    // The one addition is a print:hidden "Proposal for" switcher, so a sender
    // can open the letter for a GC; the document under it is unchanged.
    const switcher = html.slice(html.indexOf('data-proposal="gc-switcher"') - 120);
    expect(switcher.slice(0, switcher.indexOf("</nav>"))).toContain("print:hidden");
  });
});

describe("proposal opened for one invitation", () => {
  it("addresses the GC by the name on its invitation and uses the invitation's project name", async () => {
    const html = await render({ invitation: "inv-a" });
    expect(text(html)).toContain("Proposal — Mercy Hospital - Tower B (Acme");
    expect(text(html)).toContain("Test Drywall to Acme GC");
    expect(text(html)).not.toContain("First GC on the estimate");
    expect(html).toContain('data-submit="inv-a:Acme GC"');
  });

  it("uses that GC's price: -5% off $11,000.00 is $10,450.00, and says so above the document", async () => {
    const html = await render({ invitation: "inv-b" });
    expect(text(html)).toContain("Test Drywall to BuildCo");
    expect(text(html)).toContain("$10,450.00");
    expect(text(html)).not.toMatch(/Lump sum[^$]*\$11,000\.00/);
    const note = html.slice(html.indexOf("gc-price-note"));
    expect(text(note.slice(0, note.indexOf("</p>")))).toContain("estimate $11,000.00, adjusted −5% (−$550.00 — second job for them) = $10,450.00");
  });

  it("the reason sits in a print:hidden note and never in the document", async () => {
    const html = await render({ invitation: "inv-b" });
    const at = html.indexOf("second job for them");
    expect(at).toBeGreaterThan(-1);
    expect(html.lastIndexOf("<p", at)).toBe(html.lastIndexOf('<p class="mb-6', at));
    expect(html.slice(html.lastIndexOf("<p", at), at)).toContain("print:hidden");
    expect(html.split("second job for them").length).toBe(2);
  });

  it("keeps the mode choice: the mode links and the switcher carry both parameters", async () => {
    const html = await render({ mode: "itemized", invitation: "inv-b" });
    expect(html).toContain('href="/jobs/job-1/proposal?mode=lump&amp;invitation=inv-b"');
    expect(html).toContain('href="/jobs/job-1/proposal?mode=scope&amp;invitation=inv-b"');
    expect(html).toContain('href="/jobs/job-1/proposal?mode=itemized&amp;invitation=inv-a"');
    expect(html).toContain('href="/jobs/job-1/proposal?mode=itemized"');
  });

  it("itemized at a GC's price: the lines, one adjustment row, and the GC's total", async () => {
    const html = await render({ mode: "itemized", invitation: "inv-b" });
    expect(html).toContain("gc-adjustment-row");
    expect(text(html)).toContain("Price adjustment −$550.00");
    expect(text(html)).toContain("Total bid $10,450.00");
  });

  it("by scope at a GC's price: the figures printed add up to that price", async () => {
    const html = await render({ mode: "scope", invitation: "inv-b" });
    expect(text(html)).toContain("Total bid $10,450.00");
  });

  it("an invitation this estimate does not price is a 404 - never the generic letter", async () => {
    await expect(render({ invitation: "someone-elses" })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the lookup is this company's and this estimate's, and nothing else", async () => {
    await render({ invitation: "inv-a" });
    expect(invitationFindFirst.mock.calls[0][0].where).toEqual({
      id: "inv-a",
      companyId: "company-1",
      OR: [{ bidProject: { estimateJobId: "job-1" } }, { wonJobId: "job-1" }],
    });
  });

  it("an adjustment that no longer makes a price prints no document, only the sentence", async () => {
    const html = await render({ invitation: "inv-bad" });
    expect(html).toContain("gc-price-problem");
    expect(text(html)).toContain("can't be printed");
    expect(text(html)).not.toContain("Test Drywall to");
  });

  it("the Bid surface keeps its links inside Bid", async () => {
    const html = await render({ invitation: "inv-a" }, "bid");
    expect(html).toContain('href="/bid/estimates/job-1/proposal?mode=lump&amp;invitation=inv-a"');
    expect(html).not.toMatch(/href="\/jobs\//);
  });
});
