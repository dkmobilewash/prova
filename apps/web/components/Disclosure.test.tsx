import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Disclosure } from "./Disclosure";

describe("Disclosure", () => {
  it("is a native details/summary, closed unless told otherwise", () => {
    const html = renderToStaticMarkup(<Disclosure summary="How this works">Body text</Disclosure>);
    expect(html).toMatch(/^<details [^>]*class="rounded-lg border border-line-card/);
    expect(html).not.toContain(" open");
    expect(html).toContain("<summary");
    expect(html).toContain("How this works");
    expect(html).toContain("Body text");
  });

  it("opens from a prop and groups by name, so a server page can drive it", () => {
    const html = renderToStaticMarkup(
      <Disclosure summary="Row" open name="reports" variant="row" id="r1">
        Detail
      </Disclosure>,
    );
    expect(html).toContain(' open=""');
    expect(html).toContain('name="reports"');
    expect(html).toContain('id="r1"');
  });

  it("a row is a 44px summary on a row rule, not a card", () => {
    const html = renderToStaticMarkup(
      <Disclosure summary="Row" variant="row">
        Detail
      </Disclosure>,
    );
    expect(html).toContain("border-line-row");
    expect(html).not.toContain("rounded-lg");
    expect(html).toMatch(/<summary class="[^"]*min-h-11[^"]*mouse:min-h-9/);
  });

  it("plain has no chrome", () => {
    const html = renderToStaticMarkup(
      <Disclosure summary="More" variant="plain">
        Detail
      </Disclosure>,
    );
    expect(html).not.toContain("border");
  });
});
