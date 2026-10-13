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
/** A source file, raw. */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * Source with COMMENTS STRIPPED, and that is not tidiness. MODULE SCOPE because
 * both describes need it — it was inside the second one and the first block's
 * assertions used the raw text instead, which cost the same mistake twice.
 *
 * `OpeningDeductionForm.tsx` explains the bugs it exists to fix, and those
 * explanations quote the very strings these assertions look for: once the word
 * `required`, and then the phrase "the same as" in the comment recording that
 * the label no longer says it. Each time, the census failed on prose describing
 * why the code is correct. The mirror image of #185, where a comment quoting a
 * census's own pattern disarmed it; `clerkMountGate.test.ts` strips comments for
 * the same reason.
 *
 * The lesson, having paid it twice in one file: a census over a file that
 * DOCUMENTS ITS OWN HISTORY must read code, never text. The better the comment,
 * the more likely it contains the string you are forbidding.
 *
 * Deliberately naive: it would also blank a `//` inside a string literal.
 * Nothing in these files has one, and a parser here would be more machinery
 * than the question deserves.
 */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

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

  it("the shop's own threshold replaces our 32, and only for LARGE_ONLY", () => {
    // ── "32 OR 50 SQUARE FEET", per a practising estimator's account ──
    //
    // A shop on 50 could not say so: the option read "only the big ones, like a
    // storefront" and secretly meant 32.
    expect(openingThresholdSqFt("LARGE_ONLY", 50)).toBe(50);
    expect(openingThresholdSqFt("LARGE_ONLY", null)).toBe(DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT);
    expect(openingThresholdSqFt("LARGE_ONLY")).toBe(DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT);

    // THE NUMBER BELONGS TO THAT ANSWER ALONE. An unanswered company must be
    // quantified exactly as it was before any of this existed, so a figure left
    // over from a previous answer cannot move it — and "bid solid" and "deduct
    // everything" are not thresholds at all.
    expect(openingThresholdSqFt(null, 50)).toBe(DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT);
    expect(openingThresholdSqFt("NONE", 50)).toBe(Number.POSITIVE_INFINITY);
    expect(openingThresholdSqFt("ALL", 50)).toBe(0);
  });

  it("refuses a nonsensical figure rather than quietly changing a bid", () => {
    // Zero would mean "deduct everything", which is what the ALL answer is for —
    // reading it as a threshold would make two answers do the same thing
    // silently. Negative and NaN are the same class of mistake.
    expect(openingThresholdSqFt("LARGE_ONLY", 0)).toBe(DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT);
    expect(openingThresholdSqFt("LARGE_ONLY", -5)).toBe(DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT);
    expect(openingThresholdSqFt("LARGE_ONLY", Number.NaN)).toBe(
      DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT,
    );
  });

  it("no longer claims unanswered EQUALS large-only, because it need not", () => {
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
    // ── A TRUE SENTENCE THAT EXPIRED WHEN A SETTING GAINED A PARAMETER ──
    //
    // The label used to read "the same as 'only the big ones'", and that was
    // correct and worth saying: both resolved to 32, and a click-through had
    // caught the earlier wording implying they differed.
    //
    // It stopped being true the moment that option got its own number. A shop
    // on 50 sq ft is NOT the same as our 32, so the claim is now false for
    // exactly the companies most likely to read it. The label names OUR default
    // instead, which is accurate whatever they type.
    //
    // Pinned as inequality rather than deleted, because this is the second time
    // this one sentence has been wrong in two different directions.
    expect(openingThresholdSqFt(null)).not.toBe(openingThresholdSqFt("LARGE_ONLY", 50));
    expect(openingThresholdSqFt(null)).toBe(openingThresholdSqFt("LARGE_ONLY", null));

    const form = code("components/OpeningDeductionForm.tsx");
    expect(form, "the label no longer claims the two are the same").not.toContain("the same as");
    expect(form, "and it names our default from the constant, not a literal").toContain(
      "{DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT} sq ft and larger",
    );
  });

  it("asks for the shop's figure on screen, and blank means our default", () => {
    const form = code("components/OpeningDeductionForm.tsx");
    expect(form).toContain('name="openingDeductionSqFt"');
    // Blank is meaningful, so the field must not be required — and `required`
    // on this form is what broke the whole setting once.
    expect(form).toContain("placeholder={String(DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT)}");
  });

  it("reaches the priced quantity along with the answer", () => {
    const schedule = code("lib/estimating/wall-schedule.ts");
    expect(schedule).toContain("openingDeductionSqFt: true");
    // Decimal out of Postgres, so it has to become a number before the resolver
    // compares it with `> 0`.
    expect(schedule).toContain("Number(company.openingDeductionSqFt)");
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
    // Its own TWO columns now — the answer and the shop's threshold — and
    // nothing else. The point of the assertion is unchanged: this action must
    // not touch a field belonging to another form, which is how the business
    // scope and this setting got entangled in the first place.
    expect(fn).toContain("data: { openingDeduction, openingDeductionSqFt }");
    expect(fn, "and not the scope form's stamp").not.toContain("businessScopeAskedAt");
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
