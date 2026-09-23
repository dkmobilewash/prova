import { describe, expect, it } from "vitest";
import { activeFooterHref, activeGroupHeading, NAV_FOOTER, NAV_GROUPS, NAV_ITEMS, navFooterFor, navGroupsFor } from "./navItems";
import { JOB_FUNCTIONS } from "@/lib/permissions";
import { UNANSWERED_SCOPE, type BusinessScopeAnswers } from "@/lib/businessScope";

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

/** /sales and /internal/usage are deliberately outside NAV_GROUPS: both
 *  belong to Prova's own operating company, both are gated on
 *  Company.isProvaOperator rather than the job-function capabilities every
 *  other item uses, and both are appended by navGroupsFor. Named here so
 *  the exception is a decision on the record rather than a hole in the
 *  check. */
// "/ask" is a third kind of exception: it IS a tenant route, but Sidebar
// renders it as a standalone link ABOVE the groups. A collapsible group
// holding a single item costs a click to reveal there was nothing to
// choose, so Ask is a one-click link pinned outside the scroll — and it is
// in the Topbar on every page as well.
const APPENDED_SEPARATELY = new Set(["/sales", "/internal/usage", "/ask"]);

function groupedHrefs(groups: typeof NAV_GROUPS): Set<string> {
  return new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
}

const hrefsIn = (groups: typeof NAV_GROUPS) =>
  groups.flatMap((group) => group.items.map((item) => item.href));

describe("the pinned footer", () => {
  it("holds Settings, and Settings is in no group", () => {
    // Cyrus could not find Settings while it sat last inside the collapsed
    // Financials group. It is pinned to the bottom of the rail instead.
    expect(NAV_FOOTER.map((i) => i.href)).toEqual(["/settings/integrations", "/settings"]);
    expect(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))).not.toContain("/settings");
  });

  it("shows Settings only to someone who can reach it", () => {
    expect(navFooterFor({ role: "OWNER", jobFunction: null }).map((i) => i.href)).toEqual([
      "/settings/integrations",
      "/settings",
    ]);
    expect(navFooterFor({ role: "MEMBER", jobFunction: "FIELD" }).map((i) => i.href)).toEqual([]);
  });
});

describe("the Integrations footer button", () => {
  it("is shown only to the owner, since its page refuses everyone else", () => {
    for (const jobFunction of ["OFFICE", "PM", "FIELD", "ESTIMATOR"] as const) {
      const hrefs = navFooterFor({ role: "MEMBER", jobFunction } as never).map((i) => i.href);
      expect(hrefs, jobFunction).not.toContain("/settings/integrations");
    }
  });

  it("lights Integrations, not Settings too, on its own page", () => {
    const footer = navFooterFor({ role: "OWNER", jobFunction: null });
    expect(activeFooterHref(footer, "/settings/integrations")).toBe("/settings/integrations");
    expect(activeFooterHref(footer, "/settings")).toBe("/settings");
    expect(activeFooterHref(footer, "/settings/import")).toBe("/settings");
    expect(activeFooterHref(footer, "/dashboard")).toBe(null);
  });
});

describe("every nav item is reachable", () => {
  it("puts every NAV_ITEM in a group, or names it as a deliberate exception", () => {
    const grouped = groupedHrefs(NAV_GROUPS);
    const footer = new Set(NAV_FOOTER.map((i) => i.href));
    const unreachable = NAV_ITEMS.map((i) => i.href).filter(
      (href) => !grouped.has(href) && !footer.has(href) && !APPENDED_SEPARATELY.has(href),
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

    const operator = navGroupsFor(owner, { showsInternal: true });
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

describe("the collapsible rail (#240)", () => {
  it("runs every figure-carrying group first, then the plain ones", () => {
    // CHANGED 2026-09-13, and the reason is worth keeping. This used to
    // order the groups as the money PIPELINE — chase it, build it, prove
    // it, get paid, stay legal — which reads well as a sentence and badly
    // as a rail. Only four of the six carry a figure, so the pipeline
    // order alternated: two money groups, two plain ones, then money
    // again. The eye never settled, and Cyrus called it cluttery while
    // staging the demo.
    //
    // The rail's premise is "that left edge is your money", and the demo
    // scrolls it top to bottom naming figures in order. Both want the
    // figures CONTIGUOUS. So the four that carry one lead, and the two
    // that are navigation follow. The pipeline story is still there in
    // the first four; it just no longer has two silent groups wedged
    // into the middle of it.
    expect(NAV_GROUPS.map((g) => g.heading)).toEqual([
      "Pre-construction",
      "Operations",
      "Financials",
      "Compliance & safety",
      "Paper trail",
      "Logistics",
    ]);
  });

  it("gives every group an icon, since at 64px the rail shows nothing else for it", () => {
    const owner = { role: "OWNER" as const, jobFunction: null };
    for (const group of navGroupsFor(owner, { showsInternal: true })) {
      expect(group.icon, `${group.heading} has no icon`).toBeTruthy();
    }
  });

  it("brings Intake, RFIs, Submittals, Drawings and Closeout back under Paper trail, in the order the paper arrives", () => {
    const paperTrail = NAV_GROUPS.find((g) => g.heading === "Paper trail");
    // `/intake` leads, and the position is the point rather than an
    // afterthought: it is where the paper LANDS. Everything else in this
    // group is something you go looking for; intake is the one you are sent
    // to by a folder somebody just emailed you.
    expect(paperTrail?.items.map((i) => i.href)).toEqual([
      "/intake",
      "/rfis",
      "/submittals",
      "/drawings",
      "/closeout",
    ]);
    // Findable means clickable: none of the five is disabled.
    expect(paperTrail?.items.filter((i) => i.disabled)).toEqual([]);
  });

  it("opens the group of the current page, by the longest matching href", () => {
    expect(activeGroupHeading(NAV_GROUPS, "/rfis")).toBe("Paper trail");
    expect(activeGroupHeading(NAV_GROUPS, "/jobs/abc")).toBe(null);
    // /vendors and /vendors/pricing are both in Logistics, so either prefix
    // lands there; /settings/assistant hangs off /settings and must land in
    // the group that holds it, not on whichever prefix came first.
    expect(activeGroupHeading(NAV_GROUPS, "/vendors/pricing")).toBe("Logistics");
    // /settings is pinned in the footer, not in a group (NAV_FOOTER), so
    // its pages open no group rather than the one it used to sit in.
    expect(activeGroupHeading(NAV_GROUPS, "/settings/assistant")).toBe(null);
    // A prefix that is not a path segment is not a match: /teams would be
    // a different page from /team.
    expect(activeGroupHeading(NAV_GROUPS, "/teamwork")).toBe(null);
    expect(activeGroupHeading(NAV_GROUPS, "/sign-in")).toBe(null);
  });

  it("keeps the internal sales group last, outside every tenant's pipeline", () => {
    const owner = { role: "OWNER" as const, jobFunction: null };
    const headings = navGroupsFor(owner, { showsInternal: true }).map((g) => g.heading);
    expect(headings.at(-1)).toBe("Internal");
    expect(headings).toHaveLength(7);
  });
});

/**
 * The usage page is the second thing in the Internal group, and the first
 * time that group has held more than one item — which is why the option
 * that appends it is no longer called `showsSalesCrm`. A flag named after
 * one page that gates two is a lie a reader has no way to catch.
 *
 * What these pin is the half a page guard cannot: that no tenant's rail
 * ever advertises it. The guard on the page itself (isProvaOperator, then
 * OWNER) is the actual boundary and is recorded in
 * lib/permissions.test.ts's OPEN_ROUTES with its reason.
 */
/**
 * The three onboarding questions' effect on the rail — see
 * lib/businessScope.ts. THE REGRESSION THAT MATTERS MOST is the first test:
 * a company that has never answered (every pre-existing company, and any
 * new one that skips the prompt) must see every group it would see with no
 * `businessScope` argument at all — the absence of an answer is never a
 * reason to hide anything.
 */
describe("the business-scope nav filter (onboarding questions)", () => {
  const owner = { role: "OWNER" as const, jobFunction: null };

  it("hides nothing for a company with no answers — omitting the option and passing all-null answers agree", () => {
    const withoutOption = hrefsIn(navGroupsFor(owner));
    const withNullScope = hrefsIn(navGroupsFor(owner, { businessScope: UNANSWERED_SCOPE }));
    expect(withNullScope).toEqual(withoutOption);
    // And by extension, every job function still sees everything it would
    // without this feature existing at all.
    for (const jobFunction of [null, ...JOB_FUNCTIONS]) {
      const before = hrefsIn(navGroupsFor({ role: "MEMBER", jobFunction }));
      const after = hrefsIn(navGroupsFor({ role: "MEMBER", jobFunction }, { businessScope: UNANSWERED_SCOPE }));
      expect(after, `${jobFunction ?? "unset"} member`).toEqual(before);
    }
  });

  it("hides Submittals only when the company works direct for owners and never under a GC", () => {
    const directOnly: BusinessScopeAnswers = {
      contractingRelationship: "DIRECT_FOR_OWNERS",
      doesPublicWork: null,
      filesMonthlyPayApps: null,
    };
    expect(hrefsIn(navGroupsFor(owner, { businessScope: directOnly }))).not.toContain("/submittals");

    for (const relationship of ["UNDER_GENERAL_CONTRACTORS", "BOTH"] as const) {
      const scope: BusinessScopeAnswers = { ...directOnly, contractingRelationship: relationship };
      expect(hrefsIn(navGroupsFor(owner, { businessScope: scope })), relationship).toContain("/submittals");
    }
  });

  it("hides Prevailing wage and Union & fringe only when the company said no public work", () => {
    const noPublicWork: BusinessScopeAnswers = {
      contractingRelationship: null,
      doesPublicWork: false,
      filesMonthlyPayApps: null,
    };
    const hidden = hrefsIn(navGroupsFor(owner, { businessScope: noPublicWork }));
    expect(hidden).not.toContain("/prevailing-wage");
    expect(hidden).not.toContain("/union-compliance");

    const doesPublicWork: BusinessScopeAnswers = { ...noPublicWork, doesPublicWork: true };
    const shown = hrefsIn(navGroupsFor(owner, { businessScope: doesPublicWork }));
    expect(shown).toContain("/prevailing-wage");
    expect(shown).toContain("/union-compliance");
  });

  it("removes the whole group when every item in it is hidden", () => {
    // Paper trail holds five items; hiding only Submittals must not drop the
    // group, and this pins that navGroupsFor's "drop an empty group" rule
    // (used for showsInternal) applies here too rather than being special-
    // cased to that one caller.
    const directOnly: BusinessScopeAnswers = {
      contractingRelationship: "DIRECT_FOR_OWNERS",
      doesPublicWork: null,
      filesMonthlyPayApps: null,
    };
    const groups = navGroupsFor(owner, { businessScope: directOnly });
    const paperTrail = groups.find((g) => g.heading === "Paper trail");
    expect(paperTrail).toBeDefined();
    expect(paperTrail?.items.map((i) => i.href)).not.toContain("/submittals");
  });

  it("never hides anything the plain capability filter already removed, and vice versa — the two never fight", () => {
    // An ACCOUNTING member cannot reach /submittals at all (MANAGE_JOBS is
    // not in its list). Handing it a scope that WOULD show submittals for
    // an owner must not grant it back — canReach and isHiddenByBusinessScope
    // both have to agree "show it" for an item to appear.
    const accounting = { role: "MEMBER" as const, jobFunction: "ACCOUNTING" as const };
    const showsGcWork: BusinessScopeAnswers = {
      contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
      doesPublicWork: true,
      filesMonthlyPayApps: true,
    };
    expect(hrefsIn(navGroupsFor(accounting, { businessScope: showsGcWork }))).not.toContain("/submittals");
  });
});

describe("the internal usage page", () => {
  const owner = { role: "OWNER" as const, jobFunction: null };

  it("appears only when the caller says this is the operator company", () => {
    expect(hrefsIn(navGroupsFor(owner))).not.toContain("/internal/usage");
    expect(hrefsIn(navGroupsFor(owner, { showsInternal: true }))).toContain("/internal/usage");
  });

  it("sits in the Internal group beside the sales CRM, in no tenant group", () => {
    const internal = navGroupsFor(owner, { showsInternal: true }).find(
      (group) => group.heading === "Internal",
    );
    expect(internal?.items.map((item) => item.href)).toEqual(["/sales", "/internal/usage"]);

    // The stronger half: it is not in NAV_GROUPS at all, so there is no
    // path by which a tenant's rail could render it.
    const inTenantGroups = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
    expect(inTenantGroups).not.toContain("/internal/usage");
  });

  it("is invisible to every job function on a tenant account", () => {
    for (const jobFunction of [null, ...JOB_FUNCTIONS]) {
      const visible = hrefsIn(navGroupsFor({ role: "MEMBER", jobFunction }));
      expect(visible, `a ${jobFunction ?? "unset"} member can see /internal/usage`).not.toContain(
        "/internal/usage",
      );
    }
  });
});
