import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusLine } from "@/components/StatusLine";

/**
 * The colour budget as a rendered fact (#241): a quiet report is one plain
 * paragraph with no red or amber class anywhere in it; a report with a
 * problem is a status box whose tone is the worst problem's, carried in
 * `data-status` so a click-through can read it without reading colours.
 */
describe("StatusLine", () => {
  it("renders a quiet report as one plain sentence with no alert colour", () => {
    const html = renderToStaticMarkup(
      createElement(StatusLine, { report: { quiet: "Nothing late. 4 orders outstanding, 12 delivered.", problems: [] } }),
    );
    expect(html).toContain('data-status="quiet"');
    expect(html).toContain("Nothing late. 4 orders outstanding, 12 delivered.");
    expect(html).not.toMatch(/red-|amber-|role="status"/);
  });

  it("renders problems as a status box in the worst tone, one line each, and drops the quiet sentence", () => {
    const html = renderToStaticMarkup(
      createElement(StatusLine, {
        report: {
          quiet: "Nothing late.",
          problems: [
            { tone: "amber", text: "3 messages sent and never confirmed delivered." },
            { tone: "red", text: "1 message bounced — pm@gc.com (Pay app 3)." },
          ],
        },
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('data-status="red"');
    expect(html).toContain("3 messages sent and never confirmed delivered.");
    expect(html).toContain("1 message bounced — pm@gc.com (Pay app 3).");
    expect(html).not.toContain("Nothing late.");
  });

  it("is amber when nothing is red", () => {
    const html = renderToStaticMarkup(
      createElement(StatusLine, {
        report: { quiet: "", problems: [{ tone: "amber", text: "1 package ready to send today." }] },
      }),
    );
    expect(html).toContain('data-status="amber"');
    expect(html).not.toMatch(/red-/);
  });
});
