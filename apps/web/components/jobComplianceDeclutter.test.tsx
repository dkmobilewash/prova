/**
 * The job's Compliance tab after the declutter pass (density audit #11:
 * an open 8-input Attach form and ~2,900 characters of explainer stacked
 * over DAS 140 and DAS 142). The page is an async server component over
 * Prisma, so its SHAPE is read from source; the one new piece of logic,
 * the DAS status line, is tested directly.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dasSectionSummary } from "@/components/dasSectionSummary";
import { DasUnverifiedNote } from "@/components/DasUnverifiedNote";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/(app)/jobs/[id]/(tabs)/compliance/page.tsx"), "utf8");
const at = (needle: string, from = 0) => {
  const i = page.indexOf(needle, from);
  expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("dasSectionSummary", () => {
  it("says how many, and puts past due first", () => {
    expect(dasSectionSummary([])).toEqual({ text: "None recorded", pastDue: false });
    expect(dasSectionSummary(["OVERDUE", "DUE", "SENT_LATE", "SENT_IN_TIME"])).toEqual({ text: "1 past due · 1 to send · 2 sent", pastDue: true });
    expect(dasSectionSummary(["NEEDED_DAY_PASSED_UNSENT", "TOO_LATE_TO_SEND", "SENT_IN_TIME_BY_DAY"]).text).toBe("2 past due · 1 sent");
    expect(dasSectionSummary(["DUE"])).toEqual({ text: "1 to send", pastDue: false });
  });
});

describe("the job Compliance tab, decluttered", () => {
  it("keeps the past-due alert first", () => {
    expect(at("<PageAlerts")).toBeLessThan(at("Public-works facts"));
  });

  it("puts the Attach form behind a button", () => {
    const open = at('<CollapsedForm label="Attach a determination">');
    const form = at("<PrevailingWageDeterminationForm");
    expect(form).toBeGreaterThan(open);
    expect(form).toBeLessThan(at("</CollapsedForm>", open));
  });

  it("folds every section's explainer into a How this works disclosure", () => {
    expect(page.match(/<Disclosure variant="plain" summary="How this works"/g)).toHaveLength(3);
    // No explainer paragraph sits straight under a section heading any more.
    expect(page).not.toMatch(/<\/h2>\s*<p className="mb-3 text-sm text-ink-muted">/);
  });

  it("shows DAS 140 and DAS 142 as one status line each, their panels inside", () => {
    for (const [id, panel, summary] of [
      ['id="das-140"', "<Das140Panel", "{das140Summary.text}"],
      ['id="das-142"', "<Das142Panel", "{das142Summary.text}"],
    ] as const) {
      const box = at(id);
      expect(at(summary, box)).toBeLessThan(at(panel, box));
      expect(at(panel, box)).toBeLessThan(at("</Disclosure>", box));
    }
  });
});

describe("DasUnverifiedNote", () => {
  it("is the shared Disclosure, closed until opened", () => {
    const html = renderToStaticMarkup(<DasUnverifiedNote />);
    expect(html).toMatch(/^<details class="rounded-lg border border-line-card/);
    expect(html).not.toMatch(/^<details[^>]* open/);
    expect(html).toContain("have NOT been confirmed");
  });
});
