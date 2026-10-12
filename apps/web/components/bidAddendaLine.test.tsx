// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE ADDENDA LINE HAS TO BE ON THE SCREEN SOMEBODY FILLS THE BID FORM FROM.
 *
 * A RENDER test per #665. The whole value of this is that an estimator sees it
 * WITHOUT going looking — a gap in the numbering is invisible on a screen where
 * every logged addendum is read, acknowledged and priced.
 */

vi.mock("@/lib/actions", () => ({
  acknowledgeBidAddendum: vi.fn(),
  deleteBidAddendum: vi.fn(),
  deleteBidSpecSection: vi.fn(),
  saveBidSpecSection: vi.fn(),
  deleteBidRequirement: vi.fn(),
  satisfyBidRequirement: vi.fn(),
  saveBidAddendum: vi.fn(),
  saveBidRequirement: vi.fn(),
  attachSpecSectionDocument: vi.fn(),
  readSpecSection: vi.fn(),
}));

vi.mock("@/lib/document-upload-client", () => ({ uploadDocumentFile: vi.fn() }));

const { BidCompliance } = await import("./BidCompliance");

type Row = Parameters<typeof BidCompliance>[0]["addenda"][number];

const addendum = (reference: string, over: Partial<Row> = {}): Row =>
  ({
    id: `add_${reference.replace(/\W/g, "")}`,
    reference,
    issuedOn: "2026-09-01",
    acknowledgedOn: "2026-09-02",
    affectsPricedScope: false,
    impactNote: null,
    reading: null,
    decisions: [],
    ...over,
  }) as unknown as Row;

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

function paint(addenda: Row[]) {
  act(() => {
    root.render(
      createElement(BidCompliance, {
        bidInvitationId: "bid_1",
        companyId: "co_1",
        addenda,
        requirements: [],
        specSections: [],
        lines: [],
        today: "2026-10-04",
      } as never),
    );
  });
  return host;
}

const line = (el: HTMLElement) => el.querySelector('[data-bid="addenda-line"]');
const problem = (el: HTMLElement) => el.querySelector('[data-bid="addenda-problem"]');

describe("the addenda line for the bid form", () => {
  it("gives the sentence when the set is sound", () => {
    const el = paint([addendum("Addendum 1"), addendum("Addendum 2"), addendum("Addendum 3")]);
    const found = line(el);
    expect(found).not.toBeNull();
    expect(found?.textContent).toContain("Includes Addenda 1 through 3.");
    expect((found as HTMLElement).hidden).toBe(false);
    expect(problem(el)).toBeNull();
  });

  it("NAMES THE ADDENDUM NOBODY LOGGED, instead of a sentence", () => {
    // The point. Every addendum on this screen is acknowledged and complete;
    // the only evidence a fourth was issued is the number that is not there.
    const el = paint([addendum("Addendum 1"), addendum("Addendum 2"), addendum("Addendum 4")]);
    expect(line(el)).toBeNull();
    const found = problem(el);
    expect(found?.textContent).toContain("Addendum 3");
    expect(found?.textContent).toContain("Ask the GC");
  });

  it("WILL NOT WRITE THE SENTENCE over a gap", () => {
    // A written claim to have read something nobody has is worse than no line.
    const el = paint([addendum("Addendum 1"), addendum("Addendum 3")]);
    expect(el.textContent).not.toContain("Includes Addenda");
  });

  it("says which addendum is unacknowledged", () => {
    const el = paint([addendum("Addendum 1"), addendum("Addendum 2", { acknowledgedOn: null })]);
    expect(line(el)).toBeNull();
    expect(problem(el)?.textContent).toContain("Addendum 2");
  });

  it("calls out an unacknowledged addendum that changes priced scope", () => {
    const el = paint([addendum("Addendum 1", { acknowledgedOn: null, affectsPricedScope: true })]);
    expect(problem(el)?.textContent).toContain("priced scope");
  });

  it("shows nothing at all on a bid with no addenda", () => {
    // The whole section is hidden when there are none; a bid-form line about
    // addenda that do not exist would be noise on every bid.
    const el = paint([]);
    expect(line(el)).toBeNull();
    expect(problem(el)).toBeNull();
  });

  it("leaves the addenda rows alone", () => {
    const el = paint([addendum("Addendum 1"), addendum("Addendum 2")]);
    expect(el.textContent).toContain("Addendum 1");
    expect(el.textContent).toContain("Addendum 2");
  });
});
