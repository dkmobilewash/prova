import { describe, expect, it } from "vitest";
import { bidLogHrefs, bidPageCrumbs, storedHref } from "./bidLogHrefs";

describe("bidLogHrefs", () => {
  it("the CRM values are what /bids used to hard-code", () => {
    const crm = bidLogHrefs("crm");
    expect(crm.list).toBe("/bids");
    expect(crm.bidPage("b1")).toBe("/ai/bids/b1");
    expect(crm.contact("c1")).toBe("/contacts/c1");
    expect(crm.regret("b1")).toBe("/bids/b1/regret");
  });

  it("Bid links the bid's own page and the regret letter, and draws no GC link (it has no GC page)", () => {
    const bid = bidLogHrefs("bid");
    expect(bid.list).toBe("/bid/bids");
    expect(bid.bidPage("b1")).toBe("/bid/bids/b1");
    expect(bid.regret("b1")).toBe("/bid/bids/b1/regret");
    expect(bid.contact("c1")).toBeNull();
  });
});

describe("bidPageCrumbs", () => {
  it("the CRM's breadcrumb is today's two links, word for word", () => {
    expect(bidPageCrumbs("crm")).toEqual([
      { href: "/ai", label: "← AI" },
      { href: "/ai/activity", label: "Agent activity & settings" },
    ]);
  });

  it("Bid's leads back to the bid log and nowhere else", () => {
    expect(bidPageCrumbs("bid")).toEqual([{ href: "/bid/bids", label: "← Back to your bids" }]);
  });
});

describe("storedHref — a link an agent stored, as each product draws it", () => {
  const STORED = [
    "/ai/bids/b1",
    "/jobs/j1/estimate",
    "/contacts/c1",
    "/pipeline",
    "/backcharges",
    "/jobs/j1",
    "/messages",
    "/ai/activity",
  ];

  it("the CRM keeps every stored link exactly as stored", () => {
    for (const href of STORED) expect(storedHref("crm", href), href).toBe(href);
  });

  it("Bid keeps the two shapes it has a twin for", () => {
    expect(storedHref("bid", "/ai/bids/b1")).toBe("/bid/bids/b1");
    expect(storedHref("bid", "/jobs/j1/estimate")).toBe("/bid/estimates/j1/estimate");
  });

  it("Bid drops every other stored link, rather than leaving a CRM door", () => {
    for (const href of STORED.filter((h) => h !== "/ai/bids/b1" && h !== "/jobs/j1/estimate")) {
      expect(storedHref("bid", href), href).toBeNull();
    }
  });

  it("does not let a crafted href through (query, extra segment, other host, nothing)", () => {
    for (const href of ["/ai/bids/b1/../../contacts/c1", "/ai/bids/b1?x=1", "//evil.example/ai/bids/b1", "https://x.test/ai/bids/b1", "/jobs/j1/estimate/extra", ""]) {
      expect(storedHref("bid", href), href).toBeNull();
    }
    expect(storedHref("bid", null)).toBeNull();
    expect(storedHref("bid", undefined)).toBeNull();
  });
});
