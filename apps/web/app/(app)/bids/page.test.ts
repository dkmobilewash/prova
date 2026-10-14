import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /bids's "total won value" -- issue #79.
 *
 * There was no test on this page's total-won-value logic before this file.
 * The bug: `wonBids = bids.filter(b => b.status === "WON" && b.bidAmount
 * != null)` dropped a won bid with no amount out of BOTH the sum and the
 * count, so a number that read as a total was really a floor with nothing
 * on screen saying so -- and if every won bid was unpriced, the whole line
 * vanished (`wonBids.length > 0 && …`), the worst version, because nothing
 * on screen said anything was missing either.
 *
 * The fix reuses lib/bid-pipeline.ts's summariseWonValue/valueIsPartial,
 * the same arithmetic /pipeline already renders "at least $X — N won bids
 * have no amount recorded" from -- so these tests render the real page
 * against real rows rather than re-testing bid-pipeline.ts's own unit
 * tests a second time.
 */

type Bid = {
  id: string;
  contactId: string;
  status: "INVITED" | "SUBMITTED" | "WON" | "LOST" | "DECLINED";
  bidAmount: number | null;
  projectName: string;
  tradeScope: string | null;
  dueDate: Date | null;
  contact: { name: string };
  /** Quotes received for levelling. Empty here -- see the vendor stub above. */
  quotes: [];
  /** The alternates/unit prices/allowances on the bid. Empty here: this
   * file's subject is the won-value line, and `lib/bid-lines.test.ts` covers
   * the totals against its own fixtures. */
  lines: [];
  /** The addenda and ITB items behind the responsiveness panel. Empty here:
   * this file's subject is the won-value line, and
   * `lib/bid-responsiveness.test.ts` covers the checks against its own
   * fixtures. */
  addenda: [];
  requirements: [];
  specSections: [];
  declineReason?: string | null;
};

function bid(over: Partial<Bid> & { id: string }): Bid {
  return {
    contactId: "contact-1",
    status: "INVITED",
    bidAmount: null,
    projectName: "Some project",
    tradeScope: null,
    dueDate: null,
    contact: { name: "Acme GC" },
    quotes: [],
    lines: [],
    addenda: [],
    requirements: [],
    specSections: [],
    ...over,
  };
}

let bids: Bid[] = [];

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
    // The levelling panel's supplier picker. Empty is the honest stub: these
    // fixtures carry no quotes, and `lib/bid-levelling.test.ts` covers the
    // comparison against its own.
    vendor: { findMany: vi.fn(async () => []) },
    contact: { findMany: vi.fn(async () => [{ id: "gc-1", name: "Acme GC" }]) },
  },
  BidInvitationStatus: {},
  TradeScope: {},
  // Back to an empty stub, and that is the POINT: lib/change-order.ts no
  // longer builds a Decimal at module scope, so this page's import graph can
  // be walked with Prisma mocked away. `moduleScopePrismaCensus.test.ts`
  // keeps it that way.
  //
  // main's version of this line stubbed a Decimal class — the per-branch
  // workaround that three branches wrote independently before anybody looked
  // at the cause. It is dead now rather than wrong, and keeping it would
  // leave the root fix untested from here.
  Prisma: {},
}));
vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed: true, context })) }));
// The bid->job outcome queries are stubbed rather than mocked deeply: this
// file's subject is the won-value line, and `lib/bid-outcome.test.ts` covers
// the comparison arithmetic against its own fixtures. Returning EMPTY is the
// honest stub -- no bid here is linked to a job -- and the test below asserts
// that a won bid still offers the link, so the stub cannot hide the wiring.
vi.mock("@/lib/bid-outcome-query", () => ({
  loadBidOutcomes: vi.fn(async () => new Map()),
  loadLinkableJobs: vi.fn(async () => []),
}));

async function render(searchParams: Record<string, string> = {}) {
  const { default: Page } = await import("@/app/(app)/bids/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

/**
 * A bid invitation could only be logged from a GC's own contact page
 * (contractor click test, 2026-10-11). /bids now carries "+ Log a bid",
 * and `?new=1` (the Jobs & bids card and the command palette) opens it with
 * a GC picker.
 */
describe("Log a bid from /bids", () => {
  it("offers the button, collapsed, by default", async () => {
    bids = [bid({ id: "1", status: "INVITED", bidAmount: null, projectName: "Open" })];
    const html = await render();
    expect(html).toContain("+ Log a bid");
    expect(html).not.toContain('name="contactId"');
  });

  it("opens with the GC picker on ?new=1", async () => {
    bids = [bid({ id: "1", status: "INVITED", bidAmount: null, projectName: "Open" })];
    const html = await render({ new: "1" });
    expect(html).toMatch(/<select[^>]*name="contactId"/);
    expect(html).toContain('<option value="gc-1">Acme GC</option>');
    expect(html).toContain('name="projectName"');
  });
});

// UX test 2026-10-11 (#33): no bid opened its own page, so Research,
// Estimate check, Addenda and Decision were unreachable from any list.
describe("a bid's name opens its own page", () => {
  it("links the project name to /ai/bids/<id> and the GC to its contact", async () => {
    bids = [bid({ id: "b7", projectName: "Pell Riverfront Tower" })];
    const html = await render();
    expect(html).toMatch(/<a [^>]*href="\/ai\/bids\/b7"[^>]*>Pell Riverfront Tower<\/a>/);
    expect(html).toContain('href="/contacts/contact-1"');
  });
});

describe("EVERY bid offers the link, not just a won one", () => {
  /**
   * THIS TEST USED TO ASSERT THE OPPOSITE, and that is why the defect shipped.
   * It read "shows the control on a WON bid and not on an open one" and
   * counted exactly one control across a WON row and an INVITED row. True and
   * right when it was written; stale the moment #619 removed the WON check
   * from `linkBidToJob` itself, after which it pinned a gate that made that
   * action unreachable from the UI.
   *
   * The reason no other guard caught it is worth keeping: `reachable.test.ts`
   * asks whether an action has a caller. `linkBidToJob` has one. Whether the
   * caller can be reached in the state that matters is a different question,
   * and nothing was asking it. So this asks it.
   */
  it("shows the control on an INVITED bid, which is the whole point", async () => {
    bids = [bid({ id: "2", status: "INVITED", bidAmount: 10_000, projectName: "Still open" })];
    const html = await render();
    // Anti-vacuity: the row really is on the page, so a zero below would mean
    // the control is missing rather than the bid.
    expect(html).toContain("Still open");
    expect(html).toContain("Link the job this bid is for");
  });

  it("shows it on a WON bid too, one control per bid", async () => {
    bids = [
      bid({ id: "1", status: "WON", bidAmount: 50_000 }),
      bid({ id: "2", status: "INVITED", bidAmount: 10_000, projectName: "Still open" }),
    ];
    const html = await render();
    expect(html).toContain("Still open");
    // TWO now, one per bid. The old expectation was 1.
    expect(html.split("Link the job this bid is for").length - 1).toBe(2);
  });

  it("never says a bid 'became' a job, which is false until it is won", async () => {
    bids = [bid({ id: "2", status: "INVITED", bidAmount: 10_000, projectName: "Still open" })];
    const html = await render();
    expect(html).not.toContain("became");
    expect(html).not.toContain("Became");
  });
});

describe("/bids total won value", () => {
  it("counts a WON bid with no amount in the unpriced tally, and reads the total as a floor", async () => {
    // THE BUG, reproduced: the old filter (`b.bidAmount != null`) dropped
    // this row out of both the sum and the count. Assert both halves.
    bids = [
      bid({ id: "1", status: "WON", bidAmount: 50_000 }),
      bid({ id: "2", status: "WON", bidAmount: null }),
    ];
    const html = await render();

    // Anti-vacuity: this really is the page with both rows on it.
    expect(html).toContain("2 bids");

    // The sum only ever totals the priced won bid -- $50,000, never a
    // number that silently includes or invents the unpriced one.
    expect(html).toContain("$50,000.00");

    // The unpriced won bid is named in the count, not dropped.
    expect(html).toContain("at least $50,000.00 in won bids");
    expect(html).toContain("1 won bid has no amount recorded");

    // The old, dishonest phrasing must be gone.
    expect(html).not.toContain("with a recorded amount");
  });

  it("still renders a line, not nothing, when every won bid is unpriced", async () => {
    // THE WORST CASE the issue names: wonBids.length > 0 on the old code
    // was false here (both bidAmount are null), so the whole line
    // disappeared with no explanation. It must render instead.
    bids = [
      bid({ id: "1", status: "WON", bidAmount: null }),
      bid({ id: "2", status: "WON", bidAmount: null }),
      bid({ id: "3", status: "LOST", bidAmount: 999 }),
    ];
    const html = await render();

    expect(html).toContain("3 bids");
    expect(html).toContain("at least $0.00 in won bids");
    expect(html).toContain("2 won bids have no amount recorded");
  });

  it("reads as a plain total, no floor language, when every won bid is priced", async () => {
    bids = [
      bid({ id: "1", status: "WON", bidAmount: 10_000 }),
      bid({ id: "2", status: "WON", bidAmount: 5_000 }),
    ];
    const html = await render();

    expect(html).toContain("$15,000.00 in won bids");
    expect(html).not.toContain("at least");
    expect(html).not.toContain("no amount recorded");
  });

  it("renders no won-value line at all when there are no won bids", async () => {
    bids = [bid({ id: "1", status: "SUBMITTED", bidAmount: null })];
    const html = await render();

    expect(html).toContain("1 bid");
    expect(html).not.toContain("won bids");
  });
});

/**
 * Declutter round 2 (density audit #14): every bid ever, uncapped, and every
 * row a four-panel mini workspace. Now: the latest 20 + See all, each row one
 * summary line with its panels behind a row disclosure, and the decline card
 * one line. The totals still count EVERY matching bid, not the shown window.
 */
describe("/bids declutter", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      // The one WON bid is the OLDEST, outside the 20 shown, so the won value
      // can only read $1,000 if it is summed over every bid.
      bid({ id: `b${i}`, projectName: `Project ${i}`, status: i === n - 1 ? "WON" : "INVITED", bidAmount: i === n - 1 ? 1_000 : null }),
    );
  const rows = (html: string) => html.split('data-bids="row-panels"').length - 1;

  it("shows the latest 20 with a See all line, while the count and won value cover all 25", async () => {
    bids = many(25);
    const html = await render({ view: "all" });
    expect(rows(html)).toBe(20);
    expect(html).toContain("Project 19");
    expect(html).not.toContain("Project 20<");
    // ">25 bids" is the count line's own start, not the See-all sentence's tail.
    expect(html).toMatch(/>25 bids/);
    expect(html).toContain("$1,000.00 in won bids");
    expect(html).toContain("Showing the latest 20 of 25 bids");
    expect(html).toContain('href="/bids?view=all&amp;all=1"');
  });

  it("?all=1 lifts the cap and keeps the filters in its links", async () => {
    bids = many(25);
    const html = await render({ view: "all", all: "1", status: "INVITED" });
    expect(rows(html)).toBe(25);
    expect(html).toContain("Showing all 25 bids");
    expect(html).toContain('href="/bids?view=all&amp;status=INVITED"');
  });

  it("each row links to its workspace, with the four panels inside a closed row disclosure", async () => {
    bids = [bid({ id: "b7", projectName: "Pell Riverfront Tower" })];
    const html = await render({ view: "all" });
    expect(html).toContain('href="/ai/bids/b7"');
    const details = html.match(/<details[^>]*name="bid"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(details).not.toContain(" open");
    expect(details).toContain("Link the job this bid is for");
    // The summary line (name, GC) is outside the disclosure, always visible.
    expect(details).not.toContain("Pell Riverfront Tower");
  });

  it("says the decline picture in one line, with every figure and a way to the bids", async () => {
    bids = [
      bid({ id: "d1", status: "DECLINED", declineReason: "CAPACITY" }),
      bid({ id: "d2", status: "DECLINED", declineReason: "CAPACITY" }),
      bid({ id: "d3", status: "DECLINED", declineReason: "CONTRACT_TERMS" }),
      bid({ id: "d4", status: "DECLINED", declineReason: null }),
    ];
    const html = await render({ view: "all" });
    const line = html.match(/<p[^>]*data-bids="decline-summary"[^>]*>[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(line).toContain("4 bids declined, most often for no capacity (2 of 4). 1 had no reason recorded.");
    expect(line).toContain("Contract terms 1 bid");
    expect(line).toContain('href="/bids?view=all&amp;status=DECLINED"');
    expect(html).not.toMatch(/<section[^>]*data-bids="decline-summary"/);
    // The regret letter is still one click from a declined row.
    expect(html).toContain('href="/bids/d1/regret"');
  });
});
