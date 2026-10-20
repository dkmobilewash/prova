import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SEE_ALL_DEFAULT, SeeAll, seeAllWindow } from "./SeeAll";

describe("seeAllWindow", () => {
  it("caps by default and lifts the cap on ?all=1", () => {
    expect(seeAllWindow(undefined)).toEqual({ take: SEE_ALL_DEFAULT, limit: SEE_ALL_DEFAULT, showingAll: false });
    expect(seeAllWindow("1", 5)).toEqual({ take: undefined, limit: 5, showingAll: true });
    // Anything that is not exactly "1" keeps the cap — a repeated or odd param is not a request for everything.
    expect(seeAllWindow(["1", "1"]).take).toBe(SEE_ALL_DEFAULT);
    expect(seeAllWindow("true").take).toBe(SEE_ALL_DEFAULT);
  });
});

describe("SeeAll", () => {
  it("says nothing when the list fits", () => {
    expect(renderToStaticMarkup(<SeeAll total={7} noun="entries" />)).toBe("");
    expect(renderToStaticMarkup(<SeeAll total={3} limit={5} noun="entries" />)).toBe("");
  });

  it("offers the rest when capped", () => {
    const html = renderToStaticMarkup(<SeeAll total={49} noun="time entries" />);
    expect(html).toContain("Showing the latest 7 of 49 time entries.");
    expect(html).toContain('href="?all=1"');
    expect(html).toContain("See all 49");
    expect(html).not.toContain("Show the latest");
  });

  it("offers the way back when everything is shown", () => {
    const html = renderToStaticMarkup(<SeeAll total={49} limit={7} showingAll noun="time entries" href="?job=a&all=1" fewerHref="?job=a" />);
    expect(html).toContain("Showing all 49 time entries.");
    expect(html).toContain('href="?job=a"');
    expect(html).toContain("Show the latest 7");
    expect(html).not.toContain("See all");
  });

  it("is a 44px target with the mouse variant", () => {
    const html = renderToStaticMarkup(<SeeAll total={49} noun="entries" />);
    expect(html).toContain("min-h-11");
    expect(html).toContain("mouse:min-h-7");
  });
});
