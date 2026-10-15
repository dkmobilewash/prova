/**
 * /phase-codes after declutter round 3 (density audit #36: ~775 characters
 * of prose on an empty page; with data, the table sat between a
 * multi-paragraph coverage banner and a three-line footnote).
 *
 * Read from SOURCE, like estimate/declutter.test.tsx — what is pinned is
 * which prose sits behind which Disclosure. No figure is touched.
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
/** `needle` sits after `open` and before the next `</Disclosure>`. */
const inside = (needle: string, open: string) => {
  const start = at(open);
  expect(at(needle, start), `${needle} is not inside ${open}`).toBeLessThan(at("</Disclosure>", start));
};

describe("/phase-codes declutter", () => {
  it("empty state: heading and button visible, the two paragraphs behind one Disclosure", () => {
    const open = 'summary="What a phase code is, and what this page does with it"';
    inside("A phase code is your own name", open);
    inside("Once line items carry one", open);
    // The button is NOT inside it.
    expect(at('data-tour="phase-codes-set-up"')).toBeGreaterThan(at("</Disclosure>", at(open)));
  });

  it("with data: the coverage sentence is the summary, its explanation and the footnote open from it", () => {
    const cov = at('data-tour="phase-codes-coverage"');
    const summary = at("summary={", cov);
    expect(at("of your budgeted cost", summary)).toBeLessThan(at("The rest is in the", summary));
    inside("The rest is in the", 'data-tour="phase-codes-coverage"');
    inside("no wage rate", 'data-tour="phase-codes-coverage"');
    inside("Budgeted is quantity", 'summary="How Budgeted and Actual are worked out"');
  });
});
