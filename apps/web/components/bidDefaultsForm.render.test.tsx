// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ saveCompanyBidDefaults: vi.fn() }));

import { BidDefaultsForm } from "./BidDefaultsForm";
import { OWN_MARKUP_KEYS, RECAP_RATE_KEYS } from "@/lib/bid-recap";

/** The rate inputs inside the element carrying `data-markup="<which>"`. */
function namesIn(html: string, which: "needed" | "more"): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll(`[data-markup="${which}"] input`)].map((input) => input.getAttribute("name") ?? "");
}
const open = (html: string) => new DOMParser().parseFromString(html, "text/html").querySelector('[data-markup="more"]')!.hasAttribute("open");
const waiting = (html: string) => new DOMParser().parseFromString(html, "text/html").querySelector('[data-markup="needed"]')!.getAttribute("data-waiting");

describe("the markup form (F3, new-job walkthrough v2)", () => {
  it("leads with the four the estimate waits on, in that order, and puts every other rate and waste under More", () => {
    const html = renderToStaticMarkup(<BidDefaultsForm defaults={null} wastePercent={null} />);
    expect(namesIn(html, "needed")).toEqual([...OWN_MARKUP_KEYS]);
    const more = namesIn(html, "more");
    expect(more).toEqual([...RECAP_RATE_KEYS.filter((key) => !(OWN_MARKUP_KEYS as readonly string[]).includes(key)), "defaultWastePercent"]);
    // Every rate is somewhere: none dropped by the split.
    expect([...namesIn(html, "needed"), ...more].sort()).toEqual([...RECAP_RATE_KEYS, "defaultWastePercent"].sort());
  });

  it("marks the four while any is blank, and stops once all are set", () => {
    expect(waiting(renderToStaticMarkup(<BidDefaultsForm defaults={{ materialMarkupPercent: "10", laborMarkupPercent: "10", overheadPercent: "8", profitPercent: null }} wastePercent={null} />))).toBe("true");
    expect(waiting(renderToStaticMarkup(<BidDefaultsForm defaults={{ materialMarkupPercent: "10", laborMarkupPercent: "10", overheadPercent: "8", profitPercent: "10" }} wastePercent={null} />))).toBe("false");
  });

  it("opens More by itself when something under it is already set, so nothing a company saved is hidden", () => {
    expect(open(renderToStaticMarkup(<BidDefaultsForm defaults={null} wastePercent={null} />))).toBe(false);
    expect(open(renderToStaticMarkup(<BidDefaultsForm defaults={{ bondPercent: "1.5" }} wastePercent={null} />))).toBe(true);
    expect(open(renderToStaticMarkup(<BidDefaultsForm defaults={null} wastePercent="12" />))).toBe(true);
  });
});
