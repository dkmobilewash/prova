import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./navItems";
import { JOB_FUNCTIONS } from "@/lib/permissions";

/**
 * A page nothing links to is a page nobody finds.
 *
 * `/deployment` shipped registered in NAV_ITEMS and in no NAV_GROUP, and
 * both the desktop rail and the mobile drawer render `navGroupsFor()` —
 * only groups. So the route existed, worked, typechecked, and was reachable
 * from nowhere but the address bar. Nothing failed; the link was simply
 * absent, which looks exactly like a link that was never wanted.
 *
 * Scoped to `/deployment` on purpose. Four other NAV_ITEMS are orphaned the
 * same way (`/field-reports`, `/messages`, `/pipeline`, `/vendors/pricing`)
 * and they belong to other people's branches — a blanket "every item is in
 * a group" assertion here would go red for work this change has no business
 * touching.
 */

const hrefsIn = (groups: typeof NAV_GROUPS) =>
  groups.flatMap((group) => group.items.map((item) => item.href));

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

  it("is not linked twice, which would read as two different pages", () => {
    const all = hrefsIn(NAV_GROUPS);
    expect(all.filter((href) => href === "/deployment")).toHaveLength(1);
  });
});
