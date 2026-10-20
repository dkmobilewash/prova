/**
 * Job → Overview, declutter round 3 (density audit #12). Diego's file and a
 * RESTRICTED one, so this pins only the two spots changed in it: the
 * subcontract upload waits behind a button, and the signing box no longer
 * repeats how to mark the job contracted (the header's "Won it?" box does).
 * Read from SOURCE; JobDetailsForm and JobStatusControl have their own tests.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

describe("Job Overview declutter", () => {
  it("puts the subcontract upload behind 'Upload subcontract'", () => {
    const open = page.indexOf('<CollapsedForm label="Upload subcontract" tone="secondary">');
    expect(open).toBeGreaterThan(-1);
    const form = page.indexOf("<ContractDocumentUploadForm", open);
    expect(form).toBeGreaterThan(open);
    expect(form).toBeLessThan(page.indexOf("</CollapsedForm>", open));
  });

  it("says how to mark contracted nowhere on the page body", () => {
    expect(page).not.toMatch(/marked as contracted/);
    expect(page).toContain("Create signing link");
  });
});
