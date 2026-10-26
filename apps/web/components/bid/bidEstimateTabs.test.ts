import { describe, expect, it } from "vitest";
import { activeBidEstimateTab, bidEstimateTabs } from "./bidEstimateTabs";

describe("the four tabs of a Bid estimate", () => {
  it("are the chain in order, each a /bid/estimates/<id> route", () => {
    const tabs = bidEstimateTabs("abc");
    expect(tabs.map((t) => t.label)).toEqual(["Takeoff", "Estimate", "Bid recap", "Proposal"]);
    for (const tab of tabs) expect(tab.href.startsWith("/bid/estimates/abc/")).toBe(true);
  });

  it("know which one a path is on, with or without the /bid prefix the Bid host strips", () => {
    expect(activeBidEstimateTab("/bid/estimates/abc/recap", "abc")).toBe("recap");
    expect(activeBidEstimateTab("/estimates/abc/recap", "abc")).toBe("recap");
    expect(activeBidEstimateTab("/bid/estimates/abc/takeoff/legend", "abc")).toBe("takeoff");
    expect(activeBidEstimateTab("/bid/estimates/abc/proposal", "abc")).toBe("proposal");
  });

  it("know when none is (another estimate, the list, the workspace)", () => {
    expect(activeBidEstimateTab("/bid/estimates/other/recap", "abc")).toBeNull();
    expect(activeBidEstimateTab("/bid/estimates", "abc")).toBeNull();
    expect(activeBidEstimateTab("/bid/workspace/abc", "abc")).toBeNull();
  });
});
