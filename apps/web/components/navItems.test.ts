import { describe, expect, it } from "vitest";
import { NAV_GROUPS, NAV_ITEMS, navGroupsFor } from "./navItems";
import { JOB_FUNCTIONS } from "@/lib/permissions";

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
 * `/deployment`, on this branch, was the FIFTH — registered in NAV_ITEMS,
 * in no group, and reachable from nothing but the address bar. Two lanes
 * hit the same defect independently and each wrote a test for it; both are
 * kept here, because they answer different questions. The general one below
 * catches the next orphan whoever adds it. The `/deployment` block after it
 * pins the things a blanket assertion cannot see: WHICH group the page is
 * in, that it sits where its own first paragraph says it belongs, and that
 * no permission filter quietly removes it.
 *
 * One fact in two places, which is the bug class this repo keeps finding.
 * The fix that lasts is not adding the orphans back — it is these tests.
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

const hrefsIn = (groups: typeof NAV_GROUPS) =>
  groups.flatMap((group) => group.items.map((item) => item.href));

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

describe("the deployment link", () => {
  it("is in exactly one group, so the rail actually renders it", () => {
    const found = NAV_GROUPS.filter((group) =>
      group.items.some((item) => item.href === "/deployment"),
    );
    expect(found.map((g) => g.heading)).toEqual(["Operations"]);
  });

  it("sits next to the schedule, which is the page it contrasts itself with", () => {
    const operations = NAV_GROUPS.find((g) => g.heading === "Operations");
    const hrefs = operations?.items.map((item) => item.href) ?? [];
    expect(hrefs.indexOf("/deployment")).toBe(hrefs.indexOf("/schedule") + 1);
  });

  it("survives the permission filter for every job function", () => {
    // /deployment needs no capability, so nobody signed in should lose it.
    // If someone later guards the route, this fails and says so rather than
    // the link quietly vanishing for half the company.
    for (const jobFunction of [null, ...JOB_FUNCTIONS]) {
      const visible = hrefsIn(navGroupsFor({ role: "MEMBER", jobFunction }));
      expect(visible, `a ${jobFunction ?? "unset"} member cannot see /deployment`).toContain(
        "/deployment",
      );
    }
  });
});
