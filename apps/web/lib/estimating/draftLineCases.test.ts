import { describe as group, expect, it } from "vitest";
import { DRAFT_LINE_CASES } from "./draftLineCases";

/**
 * THE CASES, CHECKED FOR FREE, BEFORE ANYBODY PAYS OPUS TO MEASURE A MODEL AGAINST
 * THEM.
 *
 * `addendumCases.test.ts` exists for this reason and states it: the plan-sheet eval
 * shipped with its single most important case measuring NOTHING, because the trap
 * it was built around sat where the region filter removed it. The model was never
 * shown the thing it was being scored on, and the case passed — looking exactly
 * like a pass for the right reason.
 *
 * This eval has the same failure available in two quieter forms, and both would
 * read as a clean run:
 *
 *   - a `foreignScope` term that does not appear in the case's own `scopeText`.
 *     The whole case then tests nothing: a drafter cannot price glazing it was
 *     never told about, so the assertion can only pass. That is the plan-sheet
 *     trap exactly, one layer up.
 *   - a near-miss case with an EMPTY catalog. `claimableCatalogIds: []` reads like
 *     a strict case and is a vacuous one — with no entries in front of it there is
 *     no wrong match available to resist, and `anthropic.ts` would downgrade any
 *     claim anyway. The headline case of this eval is exactly this shape, so it is
 *     the one most worth guarding.
 *
 * Also checked: a `claimableCatalogIds` id that no entry has, which would turn a
 * true-match case into a false FAILURE and send somebody debugging a prompt over a
 * typo.
 *
 * Runs in CI at no cost, which is the point — `absence of a failure is not a pass`
 * applies to fixtures before it applies to models.
 */

group("the draft-line eval's cases could actually fail", () => {
  it("has cases at all, and the over-claim case among them", () => {
    // The size assertion first: every check below iterates, and nothing is ever
    // wrong in an empty list.
    expect(DRAFT_LINE_CASES.length, "no cases — the list emptied and every check below is vacuous").toBeGreaterThan(4);
    // The case this eval is named for, by id, so a rename cannot silently remove
    // the thing being measured.
    expect(DRAFT_LINE_CASES.map((one) => one.id)).toContain("catalog-near-miss-ceiling");
  });

  it("gives every case a unique id", () => {
    const ids = DRAFT_LINE_CASES.map((one) => one.id);
    expect(ids, "two cases with one id report as one line and overwrite each other").toEqual([...new Set(ids)]);
  });

  it("only whitelists catalog ids that the case actually hands over", () => {
    for (const one of DRAFT_LINE_CASES) {
      const have = new Set(one.catalogEntries.map((entry) => entry.id));
      const unknown = one.claimableCatalogIds.filter((id) => !have.has(id));
      expect(
        unknown,
        `${one.id}: claimableCatalogIds names ${unknown.join(", ")}, which this case's catalog does not ` +
          `contain — the model could never return it, so a correct answer would be graded as an over-claim`,
      ).toEqual([]);
    }
  });

  it("puts a real wrong match in front of every near-miss case", () => {
    // A case asserting "no catalog claim is honest here" is only a test if there
    // IS a tempting entry to claim. Otherwise the downgrade in anthropic.ts
    // guarantees the pass and the model is not being measured at all.
    const nearMisses = DRAFT_LINE_CASES.filter(
      (one) => one.claimableCatalogIds.length === 0 && one.catalogEntries.length > 0,
    );
    expect(
      nearMisses.length,
      "no case offers catalog entries while allowing none of them, so nothing measures whether a " +
        "near-miss gets claimed anyway — which is the defect this eval exists for",
    ).toBeGreaterThan(0);

    for (const one of nearMisses) {
      expect(
        one.catalogEntries.length,
        `${one.id}: a near-miss case needs at least one entry to be tempted by`,
      ).toBeGreaterThan(0);
    }
  });

  it("mentions every foreign trade in the scope text it grades against", () => {
    for (const one of DRAFT_LINE_CASES) {
      for (const term of one.foreignScope ?? []) {
        expect(
          one.scopeText.toLowerCase(),
          `${one.id}: foreignScope lists "${term}" but the scope text never mentions it, so the drafter ` +
            `cannot produce a line for it and this assertion can only pass — the plan-sheet trap`,
        ).toContain(term.toLowerCase());
      }
    }
  });

  it("leaves a no-price case with nothing to price from", () => {
    for (const one of DRAFT_LINE_CASES.filter((c) => c.expectNoPrice)) {
      expect(
        one.catalogEntries.length + one.wonBids.length,
        `${one.id}: expectNoPrice demands a null price, but this case hands over priced reference ` +
          `data — which is a defensible basis, so the honest answer would be a price and the case is wrong`,
      ).toBe(0);
    }
  });

  it("asks a catch-all check only where the scope holds more than one thing", () => {
    for (const one of DRAFT_LINE_CASES) {
      if (one.minLines == null) continue;
      expect(one.minLines, `${one.id}: minLines of 1 or less asserts nothing`).toBeGreaterThan(1);
    }
  });

  it("never gives a case an empty list of allowed bases", () => {
    for (const one of DRAFT_LINE_CASES) {
      if (one.allowedBases == null) continue;
      expect(one.allowedBases.length, `${one.id}: an empty allowedBases fails every line whatever it says`)
        .toBeGreaterThan(0);
    }
  });

  it("never asks a case for a price and for no price at once", () => {
    for (const one of DRAFT_LINE_CASES) {
      expect(
        one.pricedExpected === true && one.expectNoPrice === true,
        `${one.id}: expectNoPrice makes a price fatal and pricedExpected reports its absence — ` +
          `a case holding both grades the model wrong whatever it does`,
      ).toBe(false);
    }
  });

  it("expects a price wherever reference data or a quantity supports one", () => {
    // The guard on the guard. `pricedExpected` is what makes a silent refusal
    // visible, so a case list where nobody set it would go back to the first run's
    // blindness — green while the drafter priced nothing.
    const expectingPrice = DRAFT_LINE_CASES.filter((one) => one.pricedExpected);
    expect(
      expectingPrice.length,
      "no case expects a price, so a drafter that returned null on every line would score perfectly",
    ).toBeGreaterThan(2);
  });

  it("writes a scope long enough to draft from", () => {
    for (const one of DRAFT_LINE_CASES) {
      expect(one.scopeText.trim().length, `${one.id}: the scope text is too short to be a scope`).toBeGreaterThan(80);
      expect(one.why.trim().length, `${one.id}: a case with no stated purpose cannot be argued with`).toBeGreaterThan(
        10,
      );
    }
  });
});
