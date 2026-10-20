import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ApprenticeshipPanel } from "@/components/ApprenticeshipPanel";

/**
 * The programs empty state sits on the Apprenticeships tab of
 * /union-compliance, and the ratio review it explains itself against lives
 * on the This month tab — not "above" it, where nothing is any more.
 */
describe("ApprenticeshipPanel with no registrations", () => {
  const html = renderToStaticMarkup(createElement(ApprenticeshipPanel, { rows: [], canDelete: true }));

  it("points to the ratio review on the This month tab, with a link to it", () => {
    expect(html).toContain("No apprenticeship registrations recorded.");
    expect(html).not.toMatch(/ratio review above/i);
    expect(html).toMatch(/<a [^>]*href="\/union-compliance"[^>]*>This month<\/a>/);
  });
});
