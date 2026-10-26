import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * C Stream Bid's bid log renders the CRM's own log (`components/BidLog.tsx`)
 * with `surface="bid"`. The CRM's rendering is pinned by
 * `app/(app)/bids/page.test.ts` (unchanged by this); THIS file renders the
 * real Bid page against real-shaped rows and checks what Bid promises: the
 * whole log is there, and not one anchor leaves /bid.
 */

const dec = (n: number) => ({ toString: () => String(n) });

type Row = Record<string, unknown> & { id: string };

function invitation(over: Partial<Row> & { id: string }): Row {
  return {
    contactId: "gc-1",
    status: "SUBMITTED",
    bidAmount: null,
    projectName: "Westside Medical Office",
    tradeScope: null,
    dueDate: null,
    contact: { name: "Acme GC" },
    quotes: [],
    lines: [],
    addenda: [],
    requirements: [],
    specSections: [],
    outcome: null,
    wonJob: null,
    notes: null,
    bidProject: null,
    ...over,
  };
}

function project(estimate: boolean) {
  return {
    id: "p1",
    name: "Westside Medical Office",
    siteAddress: null,
    siteCity: null,
    owner: null,
    architect: null,
    bidDueDate: null,
    primeAwardedContactId: null,
    primeAwardedName: null,
    primeAwardedOn: null,
    primeAwardedContact: null,
    estimateJob: estimate
      ? { id: "job-1", name: "Westside Medical Office", lineItems: [{ quantity: dec(1000), unitPrice: dec(10) }] }
      : null,
    invitations: [
      { id: "i1", contactId: "gc-1", status: "SUBMITTED", bidAmount: null, contact: { name: "Acme GC" } },
      { id: "i2", contactId: "gc-2", status: "INVITED", bidAmount: null, contact: { name: "BuildCo" } },
    ],
  };
}

let bids: Row[] = [];
let allowed = true;

const context = {
  company: { id: "company-1", name: "Test Drywall" },
  id: "user-1",
  name: "Tester",
  email: null,
  role: "OWNER",
  jobFunction: null,
};

vi.mock("@prova/db", () => ({
  prisma: {
    bidInvitation: { findMany: vi.fn(async () => bids) },
    vendor: { findMany: vi.fn(async () => []) },
    contact: { findMany: vi.fn(async () => [{ id: "gc-1", name: "Acme GC" }]) },
    bidProject: { findMany: vi.fn(async () => []) },
  },
  BidInvitationStatus: {},
  TradeScope: {},
  Prisma: {},
}));
vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed, context })) }));
vi.mock("@/lib/bid-outcome-query", () => ({
  loadBidOutcomes: vi.fn(async () => new Map()),
  loadLinkableJobs: vi.fn(async () => []),
}));

async function render(searchParams: Record<string, string> = {}) {
  const { default: Page } = await import("@/app/bid/(signed-in)/bids/page");
  const element = await Page({ searchParams: Promise.resolve(searchParams) });
  // The page returns `<BidLog surface="bid" …/>` (the census requires the JSX
  // form so it can read the prop); an async component cannot be rendered by
  // renderToStaticMarkup, so run it the way Next does: call it, await it.
  const rendered = typeof element.type === "function" ? await (element.type as (props: unknown) => unknown)(element.props) : element;
  return renderToStaticMarkup(rendered as never);
}

/** Every anchor the page drew. */
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("/bid/bids is the full bid log", () => {
  it("shows the heading, the log-a-bid button and each GC on a shared project", async () => {
    const shared = project(true);
    bids = [
      invitation({ id: "i1", bidProject: shared, dueDate: new Date("2026-11-04T00:00:00.000Z") }),
      invitation({ id: "i2", contactId: "gc-2", contact: { name: "BuildCo" }, status: "INVITED", bidProject: shared }),
    ];
    const html = await render({ view: "all" });
    expect(html).toContain(">Bids</h1>");
    expect(html).toContain("+ Log a bid");
    // The project heading with BOTH GCs under it (BidProjectOutcomes), and each row's panel.
    expect(html).toContain('data-bids="project-group"');
    expect(html).toContain("Acme GC");
    expect(html).toContain("BuildCo");
    expect(html).toContain('data-bids="project-panel"');
    // The editable details, the row's working panels, the per-GC price table.
    expect(html).toContain('data-bids="edit-details"');
    expect(html).toContain('data-bids="row-panels"');
    expect(html).toContain('data-bids="gc-prices"');
  });

  it("links the estimate and each GC's proposal INSIDE Bid", async () => {
    const shared = project(true);
    bids = [invitation({ id: "i1", bidProject: shared }), invitation({ id: "i2", contactId: "gc-2", bidProject: shared })];
    const html = await render({ view: "all" });
    const links = hrefs(html);
    expect(links).toContain("/bid/estimates/job-1");
    expect(links).toContain("/bid/estimates/job-1/proposal?invitation=i1");
    expect(links).toContain("/bid/estimates/job-1/proposal?invitation=i2");
  });

  it("offers 'Start the estimate' while the project has none", async () => {
    const shared = project(false);
    bids = [invitation({ id: "i1", bidProject: shared }), invitation({ id: "i2", contactId: "gc-2", bidProject: shared })];
    const html = await render({ view: "all" });
    expect(html).toContain("Start the estimate");
  });

  it("not one anchor leaves /bid, on a populated, a declined and a filtered log", async () => {
    const shared = project(true);
    bids = [
      invitation({ id: "i1", bidProject: shared }),
      invitation({ id: "i2", contactId: "gc-2", bidProject: shared }),
      invitation({ id: "d1", status: "DECLINED", projectName: "Declined job", declineReason: "CAPACITY" }),
      invitation({ id: "w1", status: "WON", projectName: "Won job", bidAmount: 5000 }),
    ];
    const views: Record<string, string>[] = [
      { view: "all" },
      { view: "all", all: "1" },
      { view: "all", status: "DECLINED" },
      { view: "due" },
      {},
    ];
    for (const params of views) {
      const html = await render(params);
      const bad = hrefs(html).filter((h) => !(h.startsWith("/bid") || h.startsWith("#") || h.startsWith("?")));
      expect(bad, JSON.stringify(params)).toEqual([]);
    }
  });

  it("draws the GC as plain text (Bid has no GC page), and links the bid name to Bid's own bid page", async () => {
    bids = [invitation({ id: "d1", status: "DECLINED", projectName: "Declined job", declineReason: null })];
    const html = await render({ view: "all" });
    expect(html).toContain("Declined job");
    expect(html).not.toContain("/contacts/");
    expect(html).not.toContain("/ai/bids/");
    expect(hrefs(html)).toContain("/bid/bids/d1");
    // The GC's name is said, and is not a link.
    expect(html).toContain("Acme GC");
    expect(html).not.toMatch(/<a [^>]*>Acme GC<\/a>/);
  });

  it("links the regret letter of a DECLINED bid inside Bid, and of no other bid", async () => {
    bids = [
      invitation({ id: "d1", status: "DECLINED", projectName: "Declined job", declineReason: null }),
      invitation({ id: "s1", status: "SUBMITTED", projectName: "Submitted job" }),
    ];
    const links = hrefs(await render({ view: "all" }));
    expect(links).toContain("/bid/bids/d1/regret");
    expect(links).not.toContain("/bid/bids/s1/regret");
    expect(links.some((h) => h.startsWith("/bids/"))).toBe(false);
  });

  it("the due-soon view's way out is Bid's own full log", async () => {
    // The due query reads its own rows, so nothing is due here; this asserts
    // the empty due view's "See all bids" link. The due ROWS' link (to the
    // same bid's row in /bid/bids?view=all&all=1#<id>) is the `?? ` fallback in
    // BidLog and is walked in the e2e spec.
    bids = [];
    const html = await render({ view: "due" });
    expect(hrefs(html)).toContain("/bid/bids?view=all");
  });

  it("with no bids says so in Bid's own words and offers the log button", async () => {
    bids = [];
    const html = await render({ view: "all" });
    expect(html).toContain('data-bid="bids-empty"');
    expect(html).toContain("+ Log a bid");
    expect(html).not.toContain("Open your contacts");
  });

  it("refuses a person without estimating, in Bid's shell", async () => {
    allowed = false;
    try {
      bids = [];
      const html = await render();
      expect(html).not.toContain("+ Log a bid");
      expect(hrefs(html).every((h) => h.startsWith("/bid"))).toBe(true);
    } finally {
      allowed = true;
    }
  });
});
