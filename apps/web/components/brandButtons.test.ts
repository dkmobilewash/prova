import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Two pages the density audit (2026-10-13) found with a raw blue button
 * where Concept G's own action styles belong: /wip's CSV download (a
 * secondary action) and /backcharges' "Log a backcharge" (the page's one
 * primary). Read from source because the colour is the claim, and a render
 * would only repeat the class string back.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("brand buttons, not raw blue", () => {
  it("/wip downloads its CSV with the secondary style", () => {
    const wip = read("../app/(app)/wip/page.tsx");
    expect(wip).not.toMatch(/bg-blue-\d/);
    expect(wip).toContain("className={secondaryActionClass}");
  });

  it("/backcharges logs one with the yellow primary", () => {
    const form = read("./BackchargeForm.tsx");
    expect(form).not.toMatch(/bg-blue-\d/);
    expect(form.match(/primaryActionClass/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // import + open + submit
  });
});
