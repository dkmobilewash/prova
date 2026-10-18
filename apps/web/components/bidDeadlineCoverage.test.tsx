// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE UNPRICED-PACKAGE WARNING HAS TO BE ON THE SCREEN SOMEBODY BIDS FROM.
 *
 * A RENDER test per #665, with a census of the call site beside it: the
 * warning only knows the deadline because `bidDueDate` is passed, and the
 * component took four props for its whole life before this. Forgetting the
 * fifth leaves every bid looking undated — which still warns, but loses the
 * one number that makes it urgent.
 */

vi.mock("@/lib/actions", () => ({
  saveBidQuote: vi.fn(),
  deleteBidQuote: vi.fn(),
  carryBidQuote: vi.fn(),
  declineBidQuote: vi.fn(),
  readQuoteDocument: vi.fn(),
  attachQuoteDocument: vi.fn(),
}));
vi.mock("@/lib/document-upload-client", () => ({ uploadDocumentFile: vi.fn() }));

const { BidLevelling } = await import("./BidLevelling");

type Quote = Parameters<typeof BidLevelling>[0]["quotes"][number];

const quote = (packageLabel: string, vendorName: string, amount: number | null): Quote =>
  ({
    id: `q_${packageLabel}_${vendorName}`,
    packageLabel,
    vendorId: null,
    vendorName,
    amount,
    quotedOn: null,
    dueBy: null,
    declinedAt: null,
    carriedAt: null,
    exclusions: null,
    readCount: 0,
  }) as unknown as Quote;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

function paint(quotes: Quote[], bidDueDate: string | null) {
  act(() => {
    root.render(
      createElement(BidLevelling, {
        companyId: "co_1",
        bidInvitationId: "bid_1",
        vendors: [],
        today: "2026-10-09",
        bidDueDate,
        quotes,
      } as never),
    );
  });
  return host;
}

const warning = (el: HTMLElement) => el.querySelector('[data-bid="deadline-coverage"]');

describe("the unpriced-package warning", () => {
  it("NAMES THE PACKAGE WITH NO PRICE, and how long is left", () => {
    const el = paint([quote("Drywall", "Alpha", 12000), quote("Glazing", "Beta", null)], "2026-10-12");
    const found = warning(el);
    expect(found).not.toBeNull();
    expect(found?.textContent).toContain("Glazing");
    expect(found?.textContent).toContain("in 3 days");
    expect((found as HTMLElement).hidden).toBe(false);
  });

  it("stays silent when every package has a price", () => {
    // An outstanding quote on a package that is already priced is a better
    // number arriving, not a hole.
    const el = paint([quote("Drywall", "Alpha", 12000), quote("Drywall", "Beta", null)], "2026-10-12");
    expect(warning(el)).toBeNull();
  });

  it("STILL WARNS ON AN UNDATED BID, and says the date is missing", () => {
    // No date is not no hurry.
    const el = paint([quote("Glazing", "Beta", null)], null);
    expect(warning(el)?.textContent).toContain("no due date");
  });

  it("says the bid is already past", () => {
    const el = paint([quote("Glazing", "Beta", null)], "2026-10-07");
    expect(warning(el)?.textContent).toContain("was due 2 days ago");
  });

  it("is an alert, so a screen reader reaches it without hunting", () => {
    const el = paint([quote("Glazing", "Beta", null)], "2026-10-12");
    expect(warning(el)?.getAttribute("role")).toBe("alert");
  });

  it("leaves the packages themselves alone", () => {
    const el = paint([quote("Drywall", "Alpha", 12000), quote("Glazing", "Beta", null)], "2026-10-12");
    expect(el.textContent).toContain("Drywall");
    expect(el.textContent).toContain("Alpha");
  });
});

describe("the call site", () => {
  it("PASSES bidDueDate, or every bid reads as undated", () => {
    // The component took four props for its whole life. Forgetting the fifth
    // leaves the warning working but permanently unable to say how long is
    // left — which is the half that makes somebody pick up the phone.
    const source = readFileSync(resolve(process.cwd(), "app/(app)/bids/page.tsx"), "utf8");
    expect(source).toContain("bidDueDate={day(bid.dueDate)}");
  });
});
