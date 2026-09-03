import { describe, expect, it } from "vitest";
import { NAV_GROUPS, NAV_ITEMS, navGroupsFor } from "./navItems";

/**
 * NAV_ITEMS and NAV_GROUPS are two lists that have to agree, and only ONE
 * direction was ever enforced: `item()` throws when a group names an href
 * that no NAV_ITEM has. The other direction was silent, so a page added to
 * NAV_ITEMS and forgotten in NAV_GROUPS shipped with a working route, a
 * working page, and no way to reach it.
 *
 * That is not hypothetical. On 2026-09-03 FOUR routes were in that state on
 * main -- /pipeline, /messages, /field-reports and /vendors/pricing -- and
 * it surfaced only when a browser tester opened the sidebar looking for
 * Pipeline, could not find it, and correctly refused to go further. The
 * feature had been merged, deployed and confirmed READY; every check was
 * green; the nav simply never listed it.
 *
 * One fact in two places, which is the bug class this repo keeps finding.
 * The fix that lasts is not adding the four back — it is this test.
 */

/** /sales is deliberately outside NAV_GROUPS: it belongs to Prova's own
 *  operating company, is gated on Company.isProvaOperator rather than the
 *  job-function capabilities every other item uses, and is appended by
 *  navGroupsFor. Named here so the exception is a decision on the record
 *  rather than a hole in the check. */
const APPENDED_SEPARATELY = new Set(["/sales"]);

function groupedHrefs(groups: typeof NAV_GROUPS): Set<string> {
  return new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
}

describe("every nav item is reachable", () => {
  it("puts every NAV_ITEM in a group, or names it as a deliberate exception", () => {
    const grouped = groupedHrefs(NAV_GROUPS);
    const unreachable = NAV_ITEMS.map((i) => i.href).filter(
      (href) => !grouped.has(href) && !APPENDED_SEPARATELY.has(href),
    );

    expect(
      unreachable,
      `These pages exist and are in NAV_ITEMS, but no NAV_GROUPS group lists ` +
        `them, so nothing in the app links to them. Add each to a group, or ` +
        `to APPENDED_SEPARATELY with the reason. A route nobody can navigate ` +
        `to is indistinguishable from a feature that was never shipped.`,
    ).toEqual([]);
  });

  it("lists no item twice across groups", () => {
    // Two groups claiming one page puts it in the sidebar twice, and makes
    // "which section is this under" unanswerable.
    const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(all).toEqual([...new Set(all)]);
  });

  it("appends the sales group only for an operator, and never for a tenant", () => {
    const owner = { role: "OWNER" as const, jobFunction: null };

    const tenant = navGroupsFor(owner);
    expect(groupedHrefs(tenant).has("/sales")).toBe(false);

    const operator = navGroupsFor(owner, { showsSalesCrm: true });
    expect(groupedHrefs(operator).has("/sales")).toBe(true);
  });
});
