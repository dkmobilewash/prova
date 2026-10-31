import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C Stream Bid's bid page renders the CRM's own bid workspace
 * (`components/ai-bid/BidWorkspace.tsx`) with `surface="bid"`. The component's
 * own behaviour is pinned by `components/ai-bid/aiBid.render.test.tsx`
 * (unchanged by this); THIS file renders the real Bid page against real-shaped
 * data — including the CRM-pointing links the agents store — and checks what
 * Bid promises: every step is there, the access gate and company scoping are
 * the CRM page's, there is no Ask, and not one anchor leaves /bid.
 */

let allowed = true;
let loaded: unknown = null;
const loader = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

const context = { company: { id: "company-1", name: "Test Drywall" }, id: "user-1", role: "OWNER", jobFunction: null };

vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed, context })) }));
vi.mock("@/lib/agents/bidWorkspace", () => ({
  loadBidWorkspace: loader.mockImplementation(async () => loaded),
}));
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: vi.fn(async () => "America/Los_Angeles") }));
vi.mock("@/lib/actions/agentFindings", () => ({ dismissFinding: vi.fn(), markFindingWrong: vi.fn() }));
vi.mock("@/lib/actions/agents", () => ({ runAgentNow: vi.fn() }));
vi.mock("@/lib/actions/bidOutcomes", () => ({ recordBidOutcome: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound }));

const finding = (id: string, href: string, fixHref: string | null) => ({
  id,
  agent: "ESTIMATE_CHECK",
  kind: "missing_scope",
  severity: "flag",
  title: `Finding ${id}`,
  body: "Body",
  sources: [
    { label: "The GC", href: "/contacts/c1" },
    { label: "This bid", href },
    { label: "Pipeline", href: "/pipeline" },
    { label: "Web page", url: "https://example.com/spec" },
  ],
  fixHref,
  bidInvitationId: "b1",
  bidProjectName: "Westside Medical Office",
  createdAt: new Date("2026-10-14T15:00:00Z"),
  dismissedAt: null,
  runId: "r1",
});

function workspace() {
  return {
    bid: {
      id: "b1",
      projectName: "Westside Medical Office",
      gcName: "Acme GC",
      contactId: "c1",
      dueDate: new Date("2026-11-04T00:00:00Z"),
      status: "SUBMITTED",
      bidAmount: 120000,
      tradeScope: null,
    },
    research: [finding("r1", "/ai/bids/b1", "/ai/bids/b1")],
    estimateCheck: [finding("e1", "/jobs/j1/estimate", "/jobs/j1/estimate"), finding("e2", "/backcharges", "/pipeline")],
    addenda: [{ id: "a1", reference: "Addendum 1", issuedOn: null, read: false, openDecisions: 1, href: "/ai/bids/b1" }],
    decision: { recommendation: null, outcome: null },
    lastRuns: [],
    subject: { type: "BidInvitation" as const, id: "b1" },
  };
}

async function render(tab?: string, id = "b1") {
  const { default: Page } = await import("@/app/bid/(signed-in)/bids/[id]/page");
  const element = (await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab }) })) as {
    type: unknown;
    props: unknown;
  };
  return renderToStaticMarkup(element as never);
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

beforeEach(() => {
  allowed = true;
  loaded = workspace();
  loader.mockClear();
  notFound.mockClear();
});

describe("/bid/bids/<id> is the bid's own page", () => {
  it("shows the bid, its four steps and the Research step by default", async () => {
    const html = await render();
    expect(html).toContain("Westside Medical Office");
    expect(html).toContain("Acme GC");
    for (const step of ["Research", "Addenda", "Decision"]) expect(html).toContain(step);
    expect(html).toContain('data-bid-workspace');
    expect(html).toContain("Finding r1");
  });

  it("opens each step from ?tab=", async () => {
    expect(await render("estimate")).toContain("Finding e1");
    expect(await render("addenda")).toContain("Addendum 1");
    const decision = await render("decision");
    expect(decision).toContain("Recommendation");
    expect(decision).toContain("Outcome");
  });

  it("looks the bid up by id AND the caller's company", async () => {
    await render();
    expect(loader).toHaveBeenCalledWith("b1", "company-1");
  });

  it("is a 404 for a bid that is not this company's (the loader finds nothing)", async () => {
    loaded = null;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("shows Bid's no-access page, and loads nothing, without the estimating capability", async () => {
    allowed = false;
    const html = await render();
    expect(html).not.toContain("Westside Medical Office");
    expect(loader).not.toHaveBeenCalled();
  });

  it("has NO Ask panel and no earlier conversations, and the Decision step is one column", async () => {
    const html = await render("decision");
    expect(html).not.toContain("Ask about this bid");
    expect(html).not.toContain("Your earlier questions");
    expect(html).not.toContain("lg:grid-cols-[minmax(0,1fr)_380px]");
  });

  it("keeps every link inside Bid on every step — the stored CRM links are re-pointed or drawn as words", async () => {
    const all: string[] = [];
    for (const tab of ["research", "estimate", "addenda", "decision"]) {
      const html = await render(tab);
      for (const link of hrefs(html)) {
        all.push(link);
        const ok = link.startsWith("?tab=") || link.startsWith("/bid/") || link.startsWith("https://example.com/");
        expect(ok, `${tab}: ${link}`).toBe(true);
      }
    }
    // It looked at links, and the two it maps are among them.
    expect(all.length).toBeGreaterThan(8);
    expect(all).toContain("/bid/bids");
    expect(all).toContain("/bid/bids/b1");
    expect(all).toContain("/bid/estimates/j1/estimate");
    // The GC's contact page is a CRM screen: not a link, but the name is still said.
    const html = await render("research");
    expect(html).toContain("The GC");
    expect(html).not.toContain("/contacts/");
    expect(html).not.toContain("Open the bid");
    expect(html).not.toContain('href="/ai');
  });

  it("an empty Addenda step does not send a person to the GC's contact page", async () => {
    (loaded as { addenda: unknown[] }).addenda = [];
    const html = await render("addenda");
    expect(html).toContain("No addenda logged on this bid.");
    expect(html).not.toContain("Log one on the bid");
    expect(hrefs(html).every((l) => l.startsWith("?tab=") || l.startsWith("/bid/"))).toBe(true);
  });

  it("bounds the source chips to the page (a long label truncates in its chip; at 375px it widened the page to 846px)", async () => {
    expect(await render("research")).toContain("flex min-w-0 max-w-full flex-wrap gap-1.5");
  });

  it("the breadcrumb leads back to the bid log", async () => {
    const html = await render();
    expect(html).toContain('href="/bid/bids"');
    expect(html).toContain("← Back to your bids");
    expect(html).not.toContain("Agent activity");
  });
});
