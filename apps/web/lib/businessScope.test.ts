import { describe, expect, it } from "vitest";
import {
  UNANSWERED_SCOPE,
  businessScopeLine,
  canEditBusinessScope,
  hasNoScopeAnswers,
  isHiddenByBusinessScope,
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
    for (const href of ["/submittals", "/prevailing-wage", "/union-compliance", "/dashboard", "/anything"]) {
      expect(isHiddenByBusinessScope(href, UNANSWERED_SCOPE), href).toBe(false);
    }
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
