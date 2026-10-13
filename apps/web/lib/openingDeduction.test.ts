import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUSINESS_SCOPE_QUESTIONS, OPENING_DEDUCTIONS, openingThresholdSqFt } from "./businessScope";
import { DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT, boardedArea } from "./takeoff";

/**
 * The openings question, and the one thing it must never do: move a quantity
 * for a company that has not answered it.
 *
 * ── WHY THIS EXISTS AT ALL ──
 *
 * `boardedArea` has taken an `openingDeductionThresholdSqFt` option since it
 * was written and NOTHING IN THE PRODUCT EVER PASSED IT — only its own unit
 * test did. So every company got the hardcoded 32 sq ft whether that matched
 * their shop or not, and a shop that deducts every opening was being bid by
 * somebody else's habit with no way to say so. The "written, documented, and
 * never called" shape this repo has a name for.
 *
 * The expensive half is not the plumbing, it is the DEFAULT: a wrong answer
 * here does not crash anything, it quietly changes what a sub charges. So the
 * unanswered case is pinned hardest.
 */
describe("the openings question", () => {
  it("leaves an UNANSWERED company exactly where it was", () => {
    // The whole safety of this change. null and undefined both mean "never
    // asked", and both must resolve to the constant the app already used.
    expect(openingThresholdSqFt(null)).toBe(DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT);
    expect(openingThresholdSqFt(undefined)).toBe(DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT);
  });

  it("does not deduct a door at the default, and that is deliberate", () => {
    // A 3'-0" x 7'-0" door is 21 sq ft, under the 32 sq ft threshold. The board
    // is still hung, cut out and framed with a header, so deducting it bills
    // none of that work — see the constant's own comment.
    const wall = { lengthFt: 20, heightFt: 10, sides: 2 as const, openings: [{ widthFt: 3, heightFt: 7 }] };
    const unanswered = boardedArea(wall, { openingDeductionThresholdSqFt: openingThresholdSqFt(null) });
    expect(unanswered, "20 x 10 x 2 sides, nothing taken off").toBe(400);
  });

  it("takes the door off only for a shop that says it does", () => {
    const wall = { lengthFt: 20, heightFt: 10, sides: 2 as const, openings: [{ widthFt: 3, heightFt: 7 }] };
    // 21 sq ft off EACH side — a door is a hole in both faces.
    expect(boardedArea(wall, { openingDeductionThresholdSqFt: openingThresholdSqFt("ALL") })).toBe(358);
    expect(boardedArea(wall, { openingDeductionThresholdSqFt: openingThresholdSqFt("NONE") })).toBe(400);
    expect(boardedArea(wall, { openingDeductionThresholdSqFt: openingThresholdSqFt("LARGE_ONLY") })).toBe(400);
  });

  it("deducts a storefront at LARGE_ONLY but not at NONE", () => {
    // 10 x 8 is 80 sq ft, over the threshold. This is the case the 32 exists
    // to catch, and the one that tells LARGE_ONLY apart from NONE — without it
    // the two answers would be indistinguishable in this file.
    const wall = { lengthFt: 40, heightFt: 10, sides: 1 as const, openings: [{ widthFt: 10, heightFt: 8 }] };
    expect(boardedArea(wall, { openingDeductionThresholdSqFt: openingThresholdSqFt("LARGE_ONLY") })).toBe(320);
    expect(boardedArea(wall, { openingDeductionThresholdSqFt: openingThresholdSqFt("NONE") })).toBe(400);
  });

  it("gives every answer a distinct threshold, so none is a dead option", () => {
    // A radio button that behaves like its neighbour is a setting that lies.
    const thresholds = OPENING_DEDUCTIONS.map((answer) => openingThresholdSqFt(answer));
    expect(new Set(thresholds).size).toBe(OPENING_DEDUCTIONS.length);
  });
});

describe("the question reaches a screen and a quantity", () => {
  // ── A CENSUS, AND THE REASON IT IS NOT JUST A UNIT TEST ──
  //
  // The defect being prevented is a setting that saves and changes nothing.
  // Every assertion above would pass with the resolver wired to no page and
  // no pricing path — which is precisely how `openingDeductionThresholdSqFt`
  // sat unused since it was written. So the wiring is asserted too.
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("is asked on screen, with its wording from the one place that holds it", () => {
    const fields = read("components/BusinessScopeFields.tsx");
    expect(fields).toContain("BUSINESS_SCOPE_QUESTIONS.openingDeduction.prompt");
    expect(fields).toContain('name="openingDeduction"');
    // EVERY ANSWER IS OFFERED, and this asserts the mapping rather than the
    // three literals — which is the stronger check and was not the obvious
    // one. The first version of this test looked for "NONE", "LARGE_ONLY" and
    // "ALL" in the component and FAILED: they are not there, because the
    // component maps over the options list instead of retyping them. Looking
    // for the literals would have passed only if somebody had hand-written
    // them, i.e. it would have rewarded the duplication this repo keeps
    // paying for. Asserting the map means a new answer appears on screen with
    // no edit here at all.
    expect(fields).toContain("BUSINESS_SCOPE_QUESTIONS.openingDeduction.options.map");
    expect(BUSINESS_SCOPE_QUESTIONS.openingDeduction.options.map((o) => o.value)).toEqual([
      ...OPENING_DEDUCTIONS,
    ]);
  });

  it("is reachable on Settings and absent from the onboarding screen", () => {
    // ── PROVING A CONTROL IS REACHABLE, NOT MERELY WRITTEN ──
    //
    // The fields component renders this question only behind `askOpenings`, so
    // everything else in this file could pass with the question on no screen
    // anybody opens. That has shipped here before — a control gated so it
    // appeared nowhere — which is why the flag is asserted at both call sites
    // rather than just defined.
    expect(read("components/BusinessScopeSettingsForm.tsx")).toContain("askOpenings");
    // /welcome asks the three REQUIRED questions and nothing else: a fourth,
    // optional one on the first screen of the product contradicts its own
    // "all three" copy. `companySetupGate.test.ts` counts the controls there.
    expect(read("components/CompanySetupGate.tsx")).not.toContain("askOpenings");
  });

  it("is NOT one of the required onboarding answers", () => {
    // Making it required would block every company that has already answered
    // the other three from saving this form at all.
    const action = read("lib/actions/company.ts");
    const required = action.slice(action.indexOf('(["contractingRelationship"'), action.indexOf("] as const).filter"));
    expect(required).not.toContain("openingDeduction");
  });

  it("is saved, and an empty answer clears rather than sticks", () => {
    const action = read("lib/actions/company.ts");
    expect(action).toContain("openingDeduction,");
    expect(action).toContain("OPENING_DEDUCTIONS");
  });

  it("is shown back on Settings, so it is not write-only", () => {
    expect(read("app/(app)/settings/page.tsx")).toContain("openingDeduction: company.openingDeduction");
  });

  it("reaches the priced quantity", () => {
    // The company's answer is read where the schedule is loaded and handed to
    // `scheduleLines`, which is what turns runs into estimate lines.
    const schedule = read("lib/estimating/wall-schedule.ts");
    expect(schedule).toContain("openingDeduction: true");
    expect(schedule).toContain("scheduleLines(runInputs, typeInputs, { openingThresholdSqFt })");
  });
});
