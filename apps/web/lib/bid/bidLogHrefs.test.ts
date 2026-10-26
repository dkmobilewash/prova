import { describe, expect, it } from "vitest";
import { bidLogHrefs } from "./bidLogHrefs";

describe("bidLogHrefs", () => {
  it("the CRM values are what /bids used to hard-code", () => {
    const crm = bidLogHrefs("crm");
    expect(crm.bidPage("b1")).toBe("/ai/bids/b1");
    expect(crm.contact("c1")).toBe("/contacts/c1");
    expect(crm.regret("b1")).toBe("/bids/b1/regret");
  });

  it("Bid draws no link at all where it has no such screen", () => {
    const bid = bidLogHrefs("bid");
    expect([bid.bidPage("b1"), bid.contact("c1"), bid.regret("b1")]).toEqual([null, null, null]);
  });
});
