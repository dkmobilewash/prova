import { describe, expect, it } from "vitest";
import { askHref, askWebHref } from "./askHrefs";

/** Every shape of href Ask's server code builds, and what each surface draws. */
const CRM_HREFS = [
  "/jobs/cmtx3b4x20007d0pe9ebyh1m4",
  "/jobs/cmtx3b4x20007d0pe9ebyh1m4/estimate",
  "/contacts/c1",
  "/messages?draft=p1",
  "/rfis?draft=p1",
  "/dashboard",
  "/catalog",
  "/bids",
  "/pipeline",
  "/",
  "//evil.example/bid/x",
  "https://app.cstream.ai/jobs/j1",
  "javascript:alert(1)",
];

describe("askHref", () => {
  it("leaves every CRM href untouched in the CRM", () => {
    for (const href of CRM_HREFS) expect(askHref("crm", href)).toBe(href);
  });

  it("draws NONE of them in Bid — each becomes plain text", () => {
    for (const href of CRM_HREFS) expect(askHref("bid", href), href).toBeNull();
  });

  it("keeps a /bid path in Bid, query and fragment included", () => {
    for (const href of ["/bid/estimates/j1", "/bid/estimates/j1/estimate?x=1", "/bid/workspace/j1#p2"]) {
      expect(askHref("bid", href)).toBe(href);
    }
  });

  it("nothing in, nothing out", () => {
    for (const surface of ["crm", "bid"] as const) {
      expect(askHref(surface, undefined)).toBeNull();
      expect(askHref(surface, null)).toBeNull();
      expect(askHref(surface, "")).toBeNull();
    }
  });
});

describe("askWebHref", () => {
  it("keeps an outside web page on both surfaces", () => {
    expect(askWebHref("crm", "https://example.com/a")).toBe("https://example.com/a");
    expect(askWebHref("bid", "https://example.com/a")).toBe("https://example.com/a");
  });

  it("refuses C Stream's own hosts in Bid, and anything that is not a web page", () => {
    for (const url of ["https://app.cstream.ai/jobs/j1", "https://cstream.ai/", "/jobs/j1", "javascript:alert(1)"]) {
      expect(askWebHref("bid", url), url).toBeNull();
    }
  });
});
