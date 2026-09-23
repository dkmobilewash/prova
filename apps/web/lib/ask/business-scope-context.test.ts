import { describe, expect, it } from "vitest";

import { UNANSWERED_SCOPE, type BusinessScopeAnswers } from "@/lib/businessScope";
import { businessScopeContext } from "./business-scope-context";

/**
 * What Ask is told about the business asking.
 *
 * The three cases that matter are in the task this shipped from: a sub
 * under GCs doing public work and monthly pay apps, a contractor working
 * direct for owners who does neither, and — the common one — a company that
 * answered nothing at all and must be treated exactly as it was before this
 * file existed.
 *
 * The fourth thing pinned here is the PROMISE. `/welcome` tells the
 * contractor on screen that "nothing is removed for good: search and Ask
 * can still reach anything". This paragraph is one of the two places that
 * could be made a lie, so the sentences that keep it honest are asserted
 * rather than trusted — and asserted by what they must SAY, since what they
 * must do (answer certified payroll for a private-work company) is the
 * model's behaviour and the tool list, which the streamAnswer test pins.
 */

const gcPublicPayApps: BusinessScopeAnswers = {
  contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
  doesPublicWork: true,
  filesMonthlyPayApps: true,
};

const ownerDirectNeither: BusinessScopeAnswers = {
  contractingRelationship: "DIRECT_FOR_OWNERS",
  doesPublicWork: false,
  filesMonthlyPayApps: false,
};

const both: BusinessScopeAnswers = {
  contractingRelationship: "BOTH",
  doesPublicWork: true,
  filesMonthlyPayApps: false,
};

describe("a company that answered", () => {
  it("tells the model a sub under GCs does public work and files pay applications", () => {
    const context = businessScopeContext(gcPublicPayApps);
    expect(context).toContain("they work under general contractors");
    expect(context).toContain("they take public / prevailing-wage work");
    expect(context).toContain("a GC makes them file a pay application every month to get paid");
    // The negative clauses belong to the other company, not this one.
    expect(context).not.toContain("no public or prevailing-wage work");
    expect(context).not.toContain("do not file monthly pay applications");
  });

  it("tells the model a direct-for-owners contractor does neither", () => {
    const context = businessScopeContext(ownerDirectNeither);
    expect(context).toContain("they contract direct for owners, not under GCs");
    expect(context).toContain("they take no public or prevailing-wage work");
    expect(context).toContain("they do not file monthly pay applications");
    expect(context).not.toContain("they take public / prevailing-wage work");
    expect(context).not.toContain("every month to get paid");
  });

  it("says BOTH as both, and carries a yes and a no in the same paragraph", () => {
    const context = businessScopeContext(both);
    expect(context).toContain("under general contractors on some jobs and direct for owners on others");
    expect(context).toContain("they take public / prevailing-wage work");
    expect(context).toContain("they do not file monthly pay applications");
  });

  it("produces a DIFFERENT paragraph for every one of the twelve answer shapes", () => {
    // The point of the feature is that the answers change the context. A
    // clause that silently collapsed two answers into one string — or a
    // function that returned the same paragraph whatever it was handed —
    // would pass every `toContain` above on at least one case, so the
    // distinctness is asserted as its own fact.
    const relationships = ["UNDER_GENERAL_CONTRACTORS", "DIRECT_FOR_OWNERS", "BOTH"] as const;
    const seen = new Set<string>();
    for (const contractingRelationship of relationships) {
      for (const doesPublicWork of [true, false]) {
        for (const filesMonthlyPayApps of [true, false]) {
          const context = businessScopeContext({ contractingRelationship, doesPublicWork, filesMonthlyPayApps });
          expect(context).not.toBeNull();
          seen.add(context as string);
        }
      }
    }
    expect(seen.size).toBe(12);
  });
});

describe("a company that answered only some of it", () => {
  it("says nothing about a question left blank — never a no", () => {
    const context = businessScopeContext({
      contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
      doesPublicWork: null,
      filesMonthlyPayApps: null,
    });
    // Matched against the CLAUSES rather than against bare words: the
    // fixed half of the paragraph says "certified payroll at a company
    // that does no public work" as its worked example, so a test asserting
    // the string "public" is absent would fail on boilerplate and say
    // nothing about the answers.
    expect(context).toContain("they work under general contractors");
    expect(context).not.toContain("they take public / prevailing-wage work");
    expect(context).not.toContain("they take no public or prevailing-wage work");
    expect(context).not.toContain("file a pay application every month");
    expect(context).not.toContain("they do not file monthly pay applications");
  });

  it("carries one answered question alone when that is all there is", () => {
    const context = businessScopeContext({ ...UNANSWERED_SCOPE, doesPublicWork: true });
    expect(context).toContain("they take public / prevailing-wage work");
    expect(context).not.toContain("they work under general contractors");
    expect(context).not.toContain("they contract direct for owners");
    expect(context).not.toContain("file a pay application every month");
    expect(context).not.toContain("they do not file monthly pay applications");
  });
});

describe("a company that answered nothing", () => {
  it("gets no paragraph at all — skipped, or signed up before the questions existed", () => {
    expect(businessScopeContext(UNANSWERED_SCOPE)).toBeNull();
    expect(
      businessScopeContext({ contractingRelationship: null, doesPublicWork: null, filesMonthlyPayApps: null }),
    ).toBeNull();
  });

  it("stops being null the moment any single question is answered", () => {
    expect(businessScopeContext({ ...UNANSWERED_SCOPE, contractingRelationship: "BOTH" })).not.toBeNull();
    expect(businessScopeContext({ ...UNANSWERED_SCOPE, doesPublicWork: false })).not.toBeNull();
    expect(businessScopeContext({ ...UNANSWERED_SCOPE, filesMonthlyPayApps: false })).not.toBeNull();
  });
});

describe("the promise on the /welcome screen", () => {
  it("is restated to the model in every paragraph, however the questions were answered", () => {
    const shapes: BusinessScopeAnswers[] = [
      gcPublicPayApps,
      ownerDirectNeither,
      both,
      { ...UNANSWERED_SCOPE, doesPublicWork: false },
    ];
    for (const answers of shapes) {
      const context = businessScopeContext(answers) as string;
      expect(context).toContain("THIS NEVER LIMITS WHAT YOU ANSWER");
      expect(context).toContain("It is not a filter");
      expect(context).toContain("every tool is still offered");
    }
  });

  it("names the exact case it must not get wrong — certified payroll at a private-work company", () => {
    // The worked example is in the paragraph on purpose. A rule stated in
    // the abstract ("do not narrow your answers") is the kind a model
    // applies to the easy cases; the case that would actually break the
    // promise is the one where the person's own answer argues against the
    // question they just asked.
    const context = businessScopeContext(ownerDirectNeither) as string;
    expect(context).toContain("certified payroll at a company that does no public work");
    expect(context).toContain("Never tell them a feature or a rule does not apply to them");
  });

  it("keeps these answers out of the facts — a tool result always wins", () => {
    const context = businessScopeContext(gcPublicPayApps) as string;
    expect(context).toContain("not facts about any job, invoice or person");
    expect(context).toContain("a tool result always wins");
  });
});

describe("what it costs to send", () => {
  it("stays a short paragraph — this rides on every question the box answers", () => {
    // Ask runs on a real API key. The cap is a ceiling with room in it,
    // not a measurement of today's string: it exists so that "add one more
    // clause" stays a decision somebody makes rather than one that happens.
    // The longest shape is the one with all three questions answered.
    const longest = Math.max(
      ...[gcPublicPayApps, ownerDirectNeither, both].map((answers) => (businessScopeContext(answers) as string).length),
    );
    expect(longest).toBeLessThan(1200);
  });
});
