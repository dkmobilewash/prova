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
  prisma: { bidInvitation: { findMany: vi.fn(async () => bids) } },
  BidInvitationStatus: {},
  TradeScope: {},
  Prisma: {},
}));
vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed: true, context })) }));

async function render() {
  const { default: Page } = await import("@/app/(app)/bids/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

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
