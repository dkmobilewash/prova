import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * An estimate line's Remove lives in the row's body, so a folded row offers none
 * and an open one offers the two steps. Chrome round 3 reported pressing it on a
 * folded row with no result, which a person cannot do. Disclosure.tsx says why it
 * is there: a button inside a summary toggles the row as well. Source only, because
 * no test here renders this page.
 */
const page = readFileSync(join(__dirname, "../app/(app)/jobs/[id]/(tabs)/estimate/page.tsx"), "utf8");

describe("an estimate line's Remove", () => {
  const start = page.indexOf('name="estimate-line"');
  const summaryEnd = page.indexOf("<ActionForm action={updateLineItemWithId(item.id)}", start);
  const remove = page.indexOf("deleteLineItemWithId(item.id)", start);

  it("is not in the folded line", () => {
    expect(start).toBeGreaterThan(-1);
    expect(summaryEnd).toBeGreaterThan(start);
    expect(page.slice(start, summaryEnd)).not.toContain("ConfirmDelete");
  });

  it("is in the open row", () => {
    expect(remove).toBeGreaterThan(summaryEnd);
    expect(page.slice(remove, page.indexOf("</Disclosure>", remove))).toContain('confirmLabel="Confirm remove"');
  });
});
