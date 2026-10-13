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

  it("UNSET COLLIDES WITH LARGE_ONLY, and the screen has to say so", () => {
    // ── THE HOLE IN THE TEST ABOVE, AND WHY IT IS PINNED RATHER THAN FIXED ──
    //
    // The distinctness check iterates OPENING_DEDUCTIONS — the three enum
    // values. The FORM offers four choices, because unanswered needs a control
    // of its own, and the fourth is not in that list. So the one collision the
    // product can actually show a person was invisible to the check written to
    // catch exactly that: "nothing is ever missing from a list that does not
    // contain it."
    //
    // A click-through found it. The old label read "Not set — however C Stream
    // does it (openings over 32 sq ft)", which promises its own behaviour while
    // "Only the big ones, like a storefront" IS 32 sq ft. Two of four options,
    // identical, described as though they differed.
    //
    // THE COLLISION IS NOT A BUG AND MUST NOT BE "FIXED": unanswered has to
    // resolve to 32, because that is what every company got before this setting
    // existed, and changing it would move live quantities. So it is pinned here
    // instead, with the screen's own honesty asserted beside it.
    expect(openingThresholdSqFt(null)).toBe(openingThresholdSqFt("LARGE_ONLY"));

    const form = readFileSync(resolve(process.cwd(), "components/OpeningDeductionForm.tsx"), "utf8");
    expect(form, "the unanswered option admits it matches another one").toContain(
      "the same as",
    );
  });
});

describe("the question reaches a screen, a save, and a quantity", () => {
  // ── A CENSUS, AND THE REASON IT IS NOT JUST A UNIT TEST ──
  //
  // The defect being prevented is a setting that saves and changes nothing.
  // The unit tests above would all pass with the resolver wired to no page and
  // no pricing path — which is how `openingDeductionThresholdSqFt` sat unused
  // since it was written.
  //
  // THE FIRST VERSION OF THIS BLOCK WAS GREEN ON A SETTING NOBODY COULD SAVE,
  // and that is the entry worth reading before adding to it. The question
  // shipped as a fourth field inside `BusinessScopeFields`, whose other three
  // radios are `required`. The BROWSER refused to submit the form until all
  // three were answered, so any company that skipped onboarding could not save
  // this setting at all. This census confirmed the question rendered; the unit
  // test confirmed it was not in the required list. Both were true. Neither can
  // see a native validation block on a sibling field — a census reads source,
  // and `required` does its work in the browser.
  //
  // So the structural fix is asserted instead: the question has its OWN form
  // with its OWN action and NO required input anywhere on it, which is a
  // property source can actually be read for.
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  /**
   * Source with COMMENTS STRIPPED, and that is not tidiness.
   *
   * `OpeningDeductionForm.tsx` explains the bug it exists to fix, and that
   * explanation contains the word `required` — so the no-required assertion
   * below failed on the prose describing why there is no required input. The
   * mirror image of #185, where a comment quoting a census's own pattern
   * disarmed it; `clerkMountGate.test.ts` strips comments for the same reason.
   *
   * Deliberately naive: it would also blank a `//` inside a string literal.
   * Nothing in these two files has one, and a parser here would be more
   * machinery than the question deserves.
   */
  const code = (path: string) =>
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
  const form = () => read("components/OpeningDeductionForm.tsx");

  it("is asked on its own form, with its wording from the one place that holds it", () => {
    expect(form()).toContain("BUSINESS_SCOPE_QUESTIONS.openingDeduction.prompt");
    expect(form()).toContain('name="openingDeduction"');
    // EVERY ANSWER IS OFFERED, asserted as the MAPPING rather than the three
    // literals — the stronger check, and not the obvious one. Looking for
    // "NONE"/"LARGE_ONLY"/"ALL" in the component fails, because it maps over
    // the options list instead of retyping them; a literal search would pass
    // only if somebody had hand-written them, rewarding the duplication this
    // repo keeps paying for.
    expect(form()).toContain("BUSINESS_SCOPE_QUESTIONS.openingDeduction.options.map");
    expect(BUSINESS_SCOPE_QUESTIONS.openingDeduction.options.map((o) => o.value)).toEqual([
      ...OPENING_DEDUCTIONS,
    ]);
  });

  it("CARRIES NO REQUIRED INPUT, so nothing else can block its Save", () => {
    // The assertion that would have caught the bug. A `required` radio anywhere
    // on this form reintroduces exactly the failure: the browser refuses the
    // submit and names a field, and our own action never runs.
    //
    // Read from CODE, not raw text — see `code()` above for why that is
    // load-bearing rather than fussy.
    expect(code("components/OpeningDeductionForm.tsx")).not.toContain("required");
    // And the census can see SOMETHING, so a stripper that blanked the whole
    // file could not pass this vacuously. Nothing is ever missing from an
    // empty string.
    expect(code("components/OpeningDeductionForm.tsx")).toContain('name="openingDeduction"');
  });

  it("saves through its own action, which writes nothing else", () => {
    const action = read("lib/actions/company.ts");
    const fn = action.slice(action.indexOf("export async function saveOpeningDeduction"));
    expect(fn).toContain("data: { openingDeduction }");
    // Owner-only, and refusing by RETURN rather than by throw — production
    // redacts a thrown Server Action message to a digest.
    expect(fn).toContain("ownerRefusal");
    expect(fn).not.toContain("assertOwner");
  });

  it("is NOT on the form whose other fields are required", () => {
    // Where it used to be. If it comes back here, it stops being savable.
    expect(read("components/BusinessScopeFields.tsx")).not.toContain('name="openingDeduction"');
    const scope = read("lib/actions/company.ts");
    const saveScope = scope.slice(
      scope.indexOf("export async function saveBusinessScope"),
      scope.indexOf("export async function clearBusinessScope"),
    );
    expect(saveScope).not.toContain("openingDeduction");
  });

  it('only says "Saved." after the action reported ok', () => {
    // ── RAISED BY A CLICK-THROUGH, AND WORTH PINNING EVEN THOUGH IT HELD ──
    //
    // The tester saw "Saved." while their network panel showed a 503, and asked
    // the right question: if the write ever really fails, would the screen still
    // claim it saved? It would not, and this is why — the ok check comes FIRST
    // and returns, so the success flag is unreachable on a failure, and a thrown
    // (production-redacted) error is caught into a sentence.
    //
    // The 503 was therefore not the action: had that request failed, `await`
    // would have thrown and this form would have shown its error line. Something
    // else in the page's traffic returned it, and the value did persist both
    // times. Cause not established; Vercel reported ZERO runtime errors for the
    // window, so it is not our code throwing.
    const src = code("components/OpeningDeductionForm.tsx");
    const okCheck = src.indexOf("if (!result.ok)");
    const saidSaved = src.indexOf("setSaved(true)");
    expect(okCheck, "the form checks ok").toBeGreaterThan(-1);
    expect(saidSaved, 'the form says "Saved."').toBeGreaterThan(-1);
    expect(okCheck, "and it checks BEFORE it claims success").toBeLessThan(saidSaved);
    expect(src, "a failure returns rather than falling through").toContain("return;");
    expect(src, "and a throw becomes a sentence").toContain("Couldn't save just now");
  });

  it("offers a way back to unset, so a shop can return to the default", () => {
    // Null is a real answer (it resolves to 32 sq ft). Without a control for
    // it, a shop that picks a convention can never get back to the default —
    // and the click-through could not test clearing for that exact reason.
    expect(form()).toContain('value=""');
    expect(form()).toContain("answer == null");
  });

  it("is reachable on Settings, and not behind a dead condition", () => {
    // Proving a control is REACHABLE, not merely written. Everything else here
    // could pass with the form rendered on no page anybody opens.
    const page = code("app/(app)/settings/page.tsx");
    expect(page).toContain("<OpeningDeductionForm");
    expect(page).toContain("businessScope.openingDeduction");

    // ── AND THE MUTATION THAT GOT PAST THE FIRST VERSION OF THIS TEST ──
    //
    // `toContain("<OpeningDeductionForm")` passes on
    // `{null && <OpeningDeductionForm …}`, which renders nothing. A substring
    // search cannot tell a rendered component from a gated one, and this repo
    // has shipped exactly that — #665's control, gated so it appeared on no
    // screen anybody used.
    //
    // So the render site must OPEN its line: nothing before the tag but
    // whitespace. That is a property source can be read for, and it reds the
    // mutation above.
    const site = page.split("\n").find((line) => line.includes("<OpeningDeductionForm"));
    expect(site, "the render site is on its own line").toMatch(/^\s*<OpeningDeductionForm/);

    // THE BOUND, stated rather than implied: a conditional spread over two
    // lines would still evade this, and no source census can close that. What
    // would is rendering the page, which is a server component reading Prisma
    // and not something this suite can mount. The honest claim is that the
    // cheap accidental gating is caught and a determined one is not.
  });

  it("reaches the priced quantity", () => {
    // The company's answer is read where the schedule is loaded and handed to
    // `scheduleLines`, which is what turns runs into estimate lines.
    const schedule = read("lib/estimating/wall-schedule.ts");
    expect(schedule).toContain("openingDeduction: true");
    expect(schedule).toContain("scheduleLines(runInputs, typeInputs, { openingThresholdSqFt })");
  });
});
