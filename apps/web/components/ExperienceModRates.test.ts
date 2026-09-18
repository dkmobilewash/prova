import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emrStanding, type EmrRecord } from "@/lib/emr";

/**
 * The /compliance mod-rate section, rendered — because what it SAYS about
 * which rate is current is the product, and a grep of the source cannot tell
 * a sentence that renders from one inside a branch that never runs.
 *
 * The derivation itself is pinned in lib/emr.test.ts. This file pins that
 * the page tells a person what the derivation decided: the current rate
 * named as current, next year's rate NOT, and an old rate flagged as old.
 */

vi.mock("@/lib/actions", () => ({
  recordExperienceModRate: vi.fn(),
  updateExperienceModRate: vi.fn(),
  deleteExperienceModRate: vi.fn(),
}));

const { ExperienceModRates } = await import("./ExperienceModRates");

const rate = (id: string, effectiveDate: string, value: string): EmrRecord => ({
  id,
  effectiveDate,
  rate: value,
  source: "NCCI",
  sourceUrl: null,
  note: null,
});

const render = (records: EmrRecord[], today: string) =>
  renderToStaticMarkup(
    createElement(ExperienceModRates, { standing: emrStanding(records, today), canDelete: true }),
  );

describe("ExperienceModRates", () => {
  it("names the current rate and marks next year's as not yet in effect", () => {
    const html = render([rate("now", "2026-01-01", "0.87"), rate("next", "2027-01-01", "0.79")], "2026-09-17");
    expect(html).toContain("Current rate <span class=\"font-semibold\">0.87</span>");
    expect(html).toContain("not yet in effect");
    // Both rows are listed; exactly one is called current.
    expect(html.match(/>current</g)).toHaveLength(1);
    expect(html).not.toContain("policy year ended");
  });

  it("says when the newest rate's policy year has already ended", () => {
    const html = render([rate("old", "2025-01-01", "0.94")], "2026-09-17");
    expect(html).toContain("Current rate <span class=\"font-semibold\">0.94</span>");
    expect(html).toContain("That policy year ended 2026-01-01");
  });

  it("claims no current rate when every rate recorded is still in the future", () => {
    const html = render([rate("next", "2027-01-01", "0.79")], "2026-09-17");
    expect(html).not.toContain("Current rate");
    expect(html).toContain("No rate on file has taken effect yet. The earliest one recorded starts 2027-01-01.");
  });
});
