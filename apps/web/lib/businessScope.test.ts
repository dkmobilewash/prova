import { describe, expect, it } from "vitest";
import {
  HIDEABLE_ROUTES,
  UNANSWERED_SCOPE,
  businessScopeLine,
  canEditBusinessScope,
  hasNoScopeAnswers,
  isHiddenByBusinessScope,
  routesHiddenByAnswers,
  type BusinessScopeAnswers,
} from "./businessScope";

const gcOnly: BusinessScopeAnswers = {
  contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
  doesPublicWork: true,
  filesMonthlyPayApps: true,
};

const ownerDirectOnly: BusinessScopeAnswers = {
  contractingRelationship: "DIRECT_FOR_OWNERS",
  doesPublicWork: false,
  filesMonthlyPayApps: false,
};

const both: BusinessScopeAnswers = {
  contractingRelationship: "BOTH",
  doesPublicWork: false,
  filesMonthlyPayApps: null,
};

describe("hasNoScopeAnswers", () => {
  it("is true for every field null — the state of every pre-existing company", () => {
    expect(hasNoScopeAnswers(UNANSWERED_SCOPE)).toBe(true);
    expect(hasNoScopeAnswers({ contractingRelationship: null, doesPublicWork: null, filesMonthlyPayApps: null })).toBe(
      true,
    );
  });

  it("is false the moment any single field is answered", () => {
    expect(hasNoScopeAnswers({ ...UNANSWERED_SCOPE, contractingRelationship: "BOTH" })).toBe(false);
    expect(hasNoScopeAnswers({ ...UNANSWERED_SCOPE, doesPublicWork: false })).toBe(false);
    expect(hasNoScopeAnswers({ ...UNANSWERED_SCOPE, filesMonthlyPayApps: true })).toBe(false);
  });
});

describe("isHiddenByBusinessScope — the regression that matters most", () => {
  it("hides nothing at all when nothing has been answered", () => {
    // DERIVED from HIDEABLE_ROUTES rather than listed, so a route added to
    // the map is covered by this regression the day it is added instead of
    // the day somebody remembers to extend a literal. Two non-hideable
    // hrefs are appended as the control, and the list is asserted non-empty
    // so a map that parsed to nothing cannot pass this vacuously —
    // CLAUDE.md's "nothing is ever missing from an empty list".
    expect(HIDEABLE_ROUTES.length).toBeGreaterThan(0);
    for (const href of [...HIDEABLE_ROUTES, "/dashboard", "/anything"]) {
      expect(isHiddenByBusinessScope(href, UNANSWERED_SCOPE), href).toBe(false);
    }
    expect(routesHiddenByAnswers(UNANSWERED_SCOPE)).toEqual([]);
  });

  it("hides submittals only for a company that never works under a GC", () => {
    expect(isHiddenByBusinessScope("/submittals", ownerDirectOnly)).toBe(true);
    expect(isHiddenByBusinessScope("/submittals", gcOnly)).toBe(false);
    expect(isHiddenByBusinessScope("/submittals", both)).toBe(false);
  });

  it("hides prevailing-wage and union-compliance only for a company that said no public work", () => {
    expect(isHiddenByBusinessScope("/prevailing-wage", ownerDirectOnly)).toBe(true);
    expect(isHiddenByBusinessScope("/union-compliance", ownerDirectOnly)).toBe(true);
    expect(isHiddenByBusinessScope("/prevailing-wage", gcOnly)).toBe(false);
    expect(isHiddenByBusinessScope("/union-compliance", gcOnly)).toBe(false);
  });

  it("never hides a route it has no rule for, no matter the answers", () => {
    expect(isHiddenByBusinessScope("/dashboard", ownerDirectOnly)).toBe(false);
    expect(isHiddenByBusinessScope("/cash-flow", ownerDirectOnly)).toBe(false);
    expect(isHiddenByBusinessScope("/team", ownerDirectOnly)).toBe(false);
  });

  it("treats an unanswered single field as 'do not hide on it', even once other fields are answered", () => {
    // `both` has no answer for filesMonthlyPayApps, and nothing in
    // ROUTE_HIDDEN_WHEN keys off that field today — this pins that a
    // partially-answered scope only ever narrows on the fields it actually
    // answered, never on the ones left null.
    expect(isHiddenByBusinessScope("/submittals", both)).toBe(false);
  });

  it("hides backcharges only for a company that never works under a GC", () => {
    // A backcharge is a GC's deduction notice under a subcontract —
    // `gcReference`, `claimedAmount` ("what the GC says we owe") and
    // `respondByDate` ("most subcontracts state one") are three columns that
    // only exist because there is a GC above you. BOTH keeps it for the same
    // reason /submittals does: some of their jobs are under one.
    expect(isHiddenByBusinessScope("/backcharges", ownerDirectOnly)).toBe(true);
    expect(isHiddenByBusinessScope("/backcharges", gcOnly)).toBe(false);
    expect(isHiddenByBusinessScope("/backcharges", both)).toBe(false);
  });

  it("keys backcharges off the relationship only, never off public work or pay apps", () => {
    // The sharper version of the test above: the rule must not accidentally
    // ride on a neighbouring answer. A GC company that says no to both other
    // questions still sees it, and an owner-direct company that says yes to
    // both still does not.
    expect(
      isHiddenByBusinessScope("/backcharges", {
        contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
        doesPublicWork: false,
        filesMonthlyPayApps: false,
      }),
    ).toBe(false);
    expect(
      isHiddenByBusinessScope("/backcharges", {
        contractingRelationship: "DIRECT_FOR_OWNERS",
        doesPublicWork: true,
        filesMonthlyPayApps: true,
      }),
    ).toBe(true);
  });

  it("leaves the routes weighed and deliberately not added visible on every answer shape", () => {
    // The judgement call this feature is most likely to get wrong is an
    // over-eager one, and NAV-IA-AUDIT.md is what it costs. These five were
    // each read (page and Prisma model) and left out; this pins that a later
    // edit cannot quietly add one without turning a test red and having to
    // say why. See the map's own comment in businessScope.ts for the reason
    // against each.
    for (const href of ["/rfis", "/drawings", "/closeout", "/proposals", "/intake", "/bids"]) {
      for (const answers of [gcOnly, ownerDirectOnly, both]) {
        expect(isHiddenByBusinessScope(href, answers), href).toBe(false);
      }
    }
  });

  it("never hides a route this company already has rows behind, whatever it answered", () => {
    // THE GUARD. An answer is a statement of intent; a row is a statement of
    // fact, and the rows win. A company that logged backcharges under a GC
    // and later answered "direct for owners" keeps the door to disputes it is
    // still inside of, and a union shop that answers "no public work" keeps
    // the fringe it still owes the trust funds.
    expect(isHiddenByBusinessScope("/backcharges", ownerDirectOnly, ["/backcharges"])).toBe(false);
    expect(isHiddenByBusinessScope("/submittals", ownerDirectOnly, ["/submittals"])).toBe(false);
    expect(isHiddenByBusinessScope("/union-compliance", ownerDirectOnly, ["/union-compliance"])).toBe(false);
    expect(isHiddenByBusinessScope("/prevailing-wage", ownerDirectOnly, ["/prevailing-wage"])).toBe(false);

    // Every hideable route at once, derived so a new entry is covered the day
    // it is added: with data behind all of them, the answers hide nothing.
    for (const href of HIDEABLE_ROUTES) {
      expect(isHiddenByBusinessScope(href, ownerDirectOnly, [...HIDEABLE_ROUTES]), href).toBe(false);
    }
  });

  it("only spares the routes the data names, not its neighbours", () => {
    // The mirror of the test above, and the one that stops a guard which
    // simply returns false whenever the list is non-empty. Data behind ONE
    // route must not un-hide the other three.
    expect(isHiddenByBusinessScope("/backcharges", ownerDirectOnly, ["/submittals"])).toBe(true);
    expect(isHiddenByBusinessScope("/submittals", ownerDirectOnly, ["/backcharges"])).toBe(true);
    expect(isHiddenByBusinessScope("/prevailing-wage", ownerDirectOnly, ["/union-compliance"])).toBe(true);
  });

  it("an empty data list, and an omitted one, both mean 'nothing known' rather than 'nothing hidden'", () => {
    expect(isHiddenByBusinessScope("/submittals", ownerDirectOnly, [])).toBe(true);
    expect(isHiddenByBusinessScope("/submittals", ownerDirectOnly)).toBe(true);
  });

  it("data behind a route cannot make an UNANSWERED company start hiding things", () => {
    // Belt and braces on the ordering of the two short-circuits: the
    // no-answers rule is checked first, so passing a data list — or an empty
    // one — around it can never flip the regression that matters most.
    for (const href of HIDEABLE_ROUTES) {
      expect(isHiddenByBusinessScope(href, UNANSWERED_SCOPE, []), href).toBe(false);
      expect(isHiddenByBusinessScope(href, UNANSWERED_SCOPE, [href]), href).toBe(false);
    }
  });

    it("never hides prevailing-wage/union-compliance on an unanswered doesPublicWork, even with the other two answered", () => {
    // The sharper version of the test above, aimed at the exact rule this
    // feature could get wrong: a strict `=== false` check treats null as
    // "not hidden", same as "no answers at all", but a careless `!== true`
    // would treat an unanswered public-work question as a "no" the moment
    // ANY other field had a real answer — which is not what was asked.
    // hasNoScopeAnswers cannot catch this case (it only short-circuits when
    // EVERY field is null); the rule itself has to be strict. See the
    // mutation test recorded in the PR: loosening this exact rule to
    // `!== true` turns this test red and nothing else.
    const answeredExceptPublicWork: BusinessScopeAnswers = {
      contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
      doesPublicWork: null,
      filesMonthlyPayApps: true,
    };
    expect(isHiddenByBusinessScope("/prevailing-wage", answeredExceptPublicWork)).toBe(false);
    expect(isHiddenByBusinessScope("/union-compliance", answeredExceptPublicWork)).toBe(false);
  });
});

describe("routesHiddenByAnswers — what the caller has to ask the database about", () => {
  it("is empty for an unanswered company, so the layout issues no query at all", () => {
    expect(routesHiddenByAnswers(UNANSWERED_SCOPE)).toEqual([]);
  });

  it("names exactly the routes the answers would hide, and agrees with isHiddenByBusinessScope", () => {
    for (const answers of [gcOnly, ownerDirectOnly, both, UNANSWERED_SCOPE]) {
      const named = routesHiddenByAnswers(answers);
      // The two functions read the same map; this pins that they cannot
      // disagree, which is what would make the layout probe the wrong set.
      for (const href of HIDEABLE_ROUTES) {
        expect(named.includes(href), `${href} ${JSON.stringify(answers)}`).toBe(
          isHiddenByBusinessScope(href, answers),
        );
      }
      // Nothing outside the map ever appears in the list.
      for (const href of named) expect(HIDEABLE_ROUTES).toContain(href);
    }
  });

  it("is the full hideable set for the company that answered no to everything", () => {
    // The worst case for cost, and it is four routes rather than a number
    // that grows with the rail: a company contracting direct for owners with
    // no public work is what the one probe query is sized against.
    expect([...routesHiddenByAnswers(ownerDirectOnly)].sort()).toEqual([...HIDEABLE_ROUTES].sort());
  });

  it("is empty for a GC company doing public work — the common answer costs nothing", () => {
    expect(routesHiddenByAnswers(gcOnly)).toEqual([]);
  });
});

describe("businessScopeLine", () => {
  it("is null when nothing has been answered — no fabricated line", () => {
    expect(businessScopeLine(UNANSWERED_SCOPE)).toBeNull();
  });

  it("matches the spec's own example exactly", () => {
    expect(businessScopeLine(gcOnly)).toBe(
      "Set up for: subcontractor under GCs, public works, monthly pay applications.",
    );
    expect(
      businessScopeLine({
        contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
        doesPublicWork: true,
        filesMonthlyPayApps: null,
      }),
    ).toBe("Set up for: subcontractor under GCs, public works.");
  });

  it("says direct-for-owners and both in their own words", () => {
    expect(businessScopeLine(ownerDirectOnly)).toBe("Set up for: contracts direct for owners.");
    expect(businessScopeLine(both)).toBe("Set up for: subcontractor under GCs and direct for owners.");
  });

  it("is never null once at least one field is answered", () => {
    expect(businessScopeLine({ ...UNANSWERED_SCOPE, doesPublicWork: true })).not.toBeNull();
    expect(businessScopeLine({ ...UNANSWERED_SCOPE, filesMonthlyPayApps: true })).not.toBeNull();
  });
});

describe("canEditBusinessScope", () => {
  it("is owner-only, same as the company record itself", () => {
    expect(canEditBusinessScope({ role: "OWNER" })).toBe(true);
    expect(canEditBusinessScope({ role: "MEMBER" })).toBe(false);
  });
});
