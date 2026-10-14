/**
 * Job → Retainage after declutter round 3 (density audit #38: a
 * settings-style rate form ABOVE the figures it governs, then the totals,
 * then an open Log release form).
 *
 * Read from SOURCE, like estimate/declutter.test.tsx: what is pinned is the
 * order and which form sits behind which button. Both forms are unchanged
 * and `retainage-single-source.test.ts` still pins where the figures come
 * from.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
const at = (needle: string, from = 0) => {
  const i = page.indexOf(needle, from);
  expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
  return i;
};
const inside = (needle: string, open: string) => {
  const start = at(open);
  expect(at(needle, start), `${needle} is not inside ${open}`).toBeLessThan(at("</CollapsedForm>", start));
};

describe("Retainage tab declutter", () => {
  it("puts the totals first and the terms line after them", () => {
    const order = ["Total withheld", "Outstanding balance", "data-retainage-terms", '<CollapsedForm label="Edit" tone="secondary">'].map(
      (n) => at(n),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(at("<ActionForm action={updateJobRetainageTermsWithId}")).toBeGreaterThan(at("Outstanding balance"));
  });

  it("keeps the rate form behind Edit and Log release behind its own button", () => {
    inside("<ActionForm action={updateJobRetainageTermsWithId}", '<CollapsedForm label="Edit" tone="secondary">');
    inside('name="retainagePercent"', '<CollapsedForm label="Edit" tone="secondary">');
    inside("<ActionForm action={createRetainageReleaseWithId}", '<CollapsedForm label="Log release">');
  });
});
