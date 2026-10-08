import { describe, expect, it } from "vitest";

import {
  EXCEPTIONS_QUESTIONS,
  FORM_FIELDS,
  INTAKE_QUESTIONS,
  STATE_RULES,
  STATUTORY_TEXT,
  TYPE_GUIDE,
  WAIVER_STATES,
  WAIVER_TYPES,
  noticeIsLargest,
  renderable,
  transcribedCount,
} from "./lien-waiver";

/**
 * The lien waiver generator's guard rail.
 *
 * A lien waiver is a statutory document and a sub's lien rights hang from it,
 * so the failure this file is built to prevent is not a bug — it is the tool
 * emitting a PDF whose wording nobody checked against the statute. Everything
 * below exists to make that impossible to do by accident.
 */
describe("the lien waiver generator", () => {
  it("covers four states and four types, with a guide entry for each type", () => {
    expect(WAIVER_STATES).toEqual(["AZ", "CA", "NV", "TX"]);
    expect(WAIVER_TYPES).toHaveLength(4);
    for (const type of WAIVER_TYPES) {
      const guide = TYPE_GUIDE[type];
      expect(guide, type).toBeDefined();
      // Every type says WHEN to use it and WHAT IT COSTS. A picker that
      // names the four without saying which one is dangerous is the thing
      // this product is supposed to replace.
      expect(guide.when.length, type).toBeGreaterThan(20);
      expect(guide.risk.length, type).toBeGreaterThan(20);
    }
  });

  it("gives every state a citation, a compliance standard and a notice rule", () => {
    for (const state of WAIVER_STATES) {
      const rule = STATE_RULES[state];
      expect(rule.cite, state).toMatch(/\d/);
      expect(["strict", "substantial"]).toContain(rule.compliance);
      expect(rule.penalty.length, state).toBeGreaterThan(20);
      expect(rule.noticeRule.length, state).toBeGreaterThan(20);
    }
  });

  it("keeps Nevada marked strict, because it is what the whole design is pinned to", () => {
    // NRS 108.2457 says the waiver "must be in the following form" — the
    // word "substantially" that the other three carry is absent. Design to
    // Nevada and the other three are satisfied; relax this and the floor
    // moves without anyone deciding to move it.
    expect(STATE_RULES.NV.compliance).toBe("strict");
    expect(
      WAIVER_STATES.filter((s) => STATE_RULES[s].compliance === "strict"),
      "if a second state becomes strict, the shared floor needs rethinking rather than extending",
    ).toEqual(["NV"]);
  });

  it("does not assume one form with four skins", () => {
    // Nevada keys its release to a pay application; California's FINAL forms
    // have no through-date at all. A model that put `throughDate` on all
    // sixteen would be wrong in five of them.
    expect(FORM_FIELDS.NV["conditional-progress"]).toContain("payAppNumber");
    expect(FORM_FIELDS.NV["conditional-progress"]).not.toContain("throughDate");
    expect(FORM_FIELDS.CA["conditional-final"]).not.toContain("throughDate");
    expect(FORM_FIELDS.CA["unconditional-final"]).not.toContain("throughDate");
    expect(FORM_FIELDS.CA["conditional-progress"]).toContain("throughDate");
  });

  it("asks for exceptions on every form, in every state", () => {
    // No state protects a blank exceptions block, and the dangerous
    // combination — a FINAL waiver signed while retainage is outstanding —
    // is only caught here.
    for (const state of WAIVER_STATES) {
      for (const type of WAIVER_TYPES) {
        expect(FORM_FIELDS[state][type], `${state} ${type}`).toContain("exceptions");
      }
    }
    expect(EXCEPTIONS_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    expect(EXCEPTIONS_QUESTIONS.map((q) => q.id)).toContain("retainage");
    for (const q of EXCEPTIONS_QUESTIONS) expect(q.why.length, q.id).toBeGreaterThan(30);
  });

  it("asks Texas for the ORIGINAL contract date, not today's", () => {
    // Notarization was dropped only for prime contracts entered on or after
    // 1 January 2022. A sub signing in 2026 on a 2021 job still needs a
    // notary block, so the answer changes the document rather than the
    // advice — which is why it is an intake question.
    const tx = INTAKE_QUESTIONS.find((q) => q.id === "tx-prime-contract-date");
    expect(tx, "the Texas notarization question is missing").toBeDefined();
    expect(tx?.appliesTo).toContain("TX");
    expect(STATE_RULES.TX.notarization).toMatch(/2022/);
  });

  /**
   * THE GATE. While a form's statutory wording is null, nothing may render
   * it. This test is expected to be RED in the sense that `transcribedCount`
   * is zero — that is the honest state of the product, not a defect — and it
   * pins the gate shut so no PDF path can quietly skip it.
   */
  it("refuses to render any form whose statutory text has not been transcribed", () => {
    for (const state of WAIVER_STATES) {
      for (const type of WAIVER_TYPES) {
        const text = STATUTORY_TEXT[state][type];
        if (text === null) {
          expect(renderable(state, type), `${state} ${type} must not be renderable while its text is null`).toBe(false);
        } else {
          // Once transcribed: both halves present, and neither a placeholder.
          expect(text.notice.length, `${state} ${type} notice`).toBeGreaterThan(40);
          expect(text.body.length, `${state} ${type} body`).toBeGreaterThan(200);
          expect(`${text.notice} ${text.body}`).not.toMatch(/TODO|PLACEHOLDER|lorem/i);
          expect(renderable(state, type)).toBe(true);
        }
      }
    }
  });

  it("reports how many of the sixteen are transcribed, so the gap is visible", () => {
    const n = transcribedCount();
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(WAIVER_STATES.length * WAIVER_TYPES.length);
    // Deliberately NOT asserted to be 16. This test exists to make the
    // number readable, not to block the branch while the statutes are being
    // fetched — the `renderable` gate above is what protects the user.
  });

  it("holds the notice to the largest type on the page", () => {
    // Three of four states pin the statutory notice to the largest type used
    // anywhere else, so this is a constraint on the whole renderer. A logo or
    // an enlarged heading breaks three states at once, silently.
    expect(noticeIsLargest(12, [10, 11, 12])).toBe(true);
    expect(noticeIsLargest(12, [10, 14])).toBe(false);
    // Texas's 10pt floor applies even when nothing else is bigger.
    expect(noticeIsLargest(9, [8])).toBe(false);
    expect(noticeIsLargest(10, [10])).toBe(true);
  });
});
