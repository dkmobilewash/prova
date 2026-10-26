import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C Stream Bid's regret letter renders the CRM's own page
 * (`app/(app)/bids/[id]/regret/page.tsx`) with `surface="bid"`. THIS file
 * renders the real Bid page: the same letter the CRM shows, the same sender
 * notes, the same company scoping, and one link — back to Bid's bid log. It
 * also renders the CRM page with no `surface` to pin that the default is
 * untouched.
 */

let allowed = true;
let bid: Record<string, unknown> | null = null;
const findFirst = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

const context = { company: { id: "company-1", name: "Test Drywall" }, id: "user-1", role: "OWNER", jobFunction: null };

vi.mock("@prova/db", () => ({ prisma: { bidInvitation: { findFirst } } }));
vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed, context })) }));
vi.mock("next/navigation", () => ({ notFound }));

function invitation(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    status: "DECLINED",
    projectName: "Westside Medical Office",
    tradeScope: null,
    dueDate: new Date("2026-11-04T00:00:00Z"),
    declineReason: "SCHEDULE",
    declineNote: null,
    contact: { name: "Acme GC", address: "1 Main St", people: [{ name: "Pat Estimator" }] },
    ...over,
  };
}

async function renderBid(id = "b1") {
  const { default: Page } = await import("@/app/bid/(signed-in)/bids/[id]/regret/page");
  // The page gates, then returns `<RegretLetter surface="bid" …/>` (the census
  // reads the JSX prop); an async component cannot be rendered by
  // renderToStaticMarkup, so run it the way Next does: call it, await it.
  const element = (await Page({ params: Promise.resolve(id).then((v) => ({ id: v })) })) as {
    type: unknown;
    props: unknown;
  };
  const rendered =
    typeof element.type === "function" ? await (element.type as (p: unknown) => Promise<unknown>)(element.props) : element;
  return renderToStaticMarkup(rendered as never);
}

async function renderCrm(id = "b1") {
  const { default: Page } = await import("@/app/(app)/bids/[id]/regret/page");
  return renderToStaticMarkup((await Page({ params: Promise.resolve({ id }) })) as never);
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

beforeEach(() => {
  allowed = true;
  bid = invitation();
  findFirst.mockReset();
  findFirst.mockImplementation(async () => bid);
  notFound.mockClear();
});

describe("/bid/bids/<id>/regret is the same letter the CRM shows", () => {
  it("renders the letter to the GC, from this company, with the sender's own space to sign", async () => {
    const html = await renderBid();
    expect(html).toContain('data-regret="letter"');
    expect(html).toContain("Test Drywall");
    expect(html).toContain("Acme GC");
    expect(html).toContain("Pat Estimator");
    expect(html).toContain("Sincerely,");
  });

  it("is, paragraph for paragraph, the CRM's own letter (only the back link differs)", async () => {
    const strip = (html: string) => html.replace(/<a [^>]*>← Back to bids<\/a>/, "");
    const dated = (html: string) => html.replace(/\w{3}, \w{3} \d{1,2}, \d{4}|\w+ \d{1,2}, \d{4}/g, "DATE");
    expect(dated(strip(await renderBid()))).toBe(dated(strip(await renderCrm())));
  });

  it("looks the invitation up by id AND the caller's company", async () => {
    await renderBid();
    expect(findFirst.mock.calls[0]![0].where).toEqual({ id: "b1", companyId: "company-1" });
  });

  it("is a 404 for a bid that is not this company's", async () => {
    bid = null;
    await expect(renderBid()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows Bid's no-access page, and reads no bid, without the estimating capability", async () => {
    allowed = false;
    const html = await renderBid();
    expect(html).not.toContain('data-regret="letter"');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("on a bid still in play, says so to the sender only (print:hidden), exactly as the CRM does", async () => {
    bid = invitation({ status: "SUBMITTED", declineReason: null });
    const html = await renderBid();
    expect(html).toContain("This bid is still marked");
    expect(html).toContain("print:hidden");
  });

  it("keeps a decline reason the GC must not hear out of the letter, and says so to the sender", async () => {
    bid = invitation({ declineReason: "RELATIONSHIP", declineNote: "margin too thin" });
    const html = await renderBid();
    expect(html).toContain('data-regret="sender-note"');
    expect(html).toContain("margin too thin");
    expect(html.slice(html.indexOf('data-regret="letter"'))).not.toContain("margin too thin");
  });

  it("has exactly one link, and it goes back to Bid's bid log", async () => {
    expect(hrefs(await renderBid())).toEqual(["/bid/bids"]);
  });

  it("leaves the CRM page's own back link where it was", async () => {
    expect(hrefs(await renderCrm())).toEqual(["/bids"]);
  });
});
