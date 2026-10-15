import { describe, expect, it } from "vitest";
import { licenceKey, licenceNumberFrom, readTypedLicence } from "./sales-licence";

/**
 * THE JOIN KEY, EXECUTED, AGAINST A SHAPE THAT HAS BEEN MEASURED.
 *
 * `SalesLead.licenceNumber` exists so that a lead with no telephone number can be
 * joined to California's public CSLB licence file, which has one for 5,003 of the
 * 5,007 wall-and-ceiling firms somebody counted. Everything resting on that rests
 * on the rule in `sales-licence.ts`, so the cases here are the ones that
 * distinguish it from the rules it could be confused with rather than the ones
 * that merely pass.
 *
 * **Every width in this file comes from the measurement, not from `parse.ts`'s
 * pattern.** The two differ and the difference is the point: `LicenseNo` is a bare
 * integer of 2 to 7 digits with no leading zero, while the parser reads 6 to 8
 * digits and keeps the class prefix. The measured values quoted below — `92`,
 * `102`, `91594`, `1162318`, and the `061234` out of the repo's own Caltrans
 * harvest — are each here because one of them kills a plausible version of this
 * function.
 *
 * Several obvious cases were tried first and SURVIVED mutation, because something
 * else in the function already handled them; those are named in the comments
 * rather than deleted, since the next person to widen this rule will reach for the
 * same ones.
 */

describe("the key is 2 to 7 bare digits, because that is what CSLB stores", () => {
  it("reads a bare number at every measured width", () => {
    // The shortest and the longest in the 5,007-firm count, plus the real
    // three-digit one from the master sample. A six-digit floor refuses all three
    // and is the version of this function that shipped first.
    expect(licenceNumberFrom("92")).toBe("92");
    expect(licenceNumberFrom("102")).toBe("102");
    expect(licenceNumberFrom("91594")).toBe("91594");
    expect(licenceNumberFrom("884201")).toBe("884201");
    expect(licenceNumberFrom("1162318")).toBe("1162318");
  });

  /**
   * EIGHT DIGITS CAN NEVER MATCH, so refusing one loses nothing and catches a
   * column that won the licence slot by accident. A ten-digit run is the DIR
   * public-works registration that sits beside the licence on the same forms.
   *
   * The first case tried here was a row carrying `licence: null, registration:
   * "1000012345"` — which proved nothing, because nothing passes a registration
   * into this function. The distinguishing input is the registration arriving
   * WHERE A LICENCE IS EXPECTED, which is what a mislabelled column does.
   */
  it("refuses eight digits or more, and says which refusal it is", () => {
    expect(licenceKey("12345678")).toEqual({ key: null, refusal: "TOO_LONG" });
    expect(licenceKey("1000012345")).toEqual({ key: null, refusal: "TOO_LONG" });
    expect(licenceKey("DIR 1000012345")).toEqual({ key: null, refusal: "TOO_LONG" });
  });

  it("refuses a single digit, and zeros that strip away to nothing", () => {
    expect(licenceKey("9")).toEqual({ key: null, refusal: "TOO_SHORT" });
    expect(licenceKey("0")).toEqual({ key: null, refusal: "TOO_SHORT" });
    expect(licenceKey("000")).toEqual({ key: null, refusal: "TOO_SHORT" });
  });

  /**
   * THE WIDTH THIS FUNCTION DELIBERATELY DOES NOT POLICE, written down because it
   * reads like a hole. A bare `92335` is accepted, and it is also a Fontana ZIP
   * code — five digits is a real licence width (`91594`) and nothing in the digits
   * can tell the two apart. The guard against a ZIP winning the slot is
   * `parse.ts`'s six-digit floor on its COLUMN-INFERRED read, which is a question
   * about which column a number came from and is already settled before anything
   * reaches here. What this function can still insist on is that the cell BE the
   * number, which is the next case.
   */
  it("accepts a bare five-digit number, ZIP-shaped or not", () => {
    expect(licenceNumberFrom("92335")).toBe("92335");
  });

  it("refuses a number with words around it, which is a place and not a licence", () => {
    expect(licenceKey("Fontana, CA 92335")).toEqual({ key: null, refusal: "NOT_A_NUMBER" });
    expect(licenceKey("Item 0412")).toEqual({ key: null, refusal: "NOT_A_NUMBER" });
    expect(licenceKey("ask Dave")).toEqual({ key: null, refusal: "NOT_A_NUMBER" });
  });
});

describe("the two normalisations the real documents force", () => {
  /**
   * THE CLASS PREFIX. `parse.ts`'s `licenceOnly` keeps it, deliberately, because
   * it is reading what the document said — so every one of this repo's own
   * fixtures writes `C-9 884201`, and a join on the stored value would have missed
   * 100% of them. The class is a fact about the scope of work, not about who holds
   * the licence.
   */
  it("drops a classification prefix in every form the documents print", () => {
    expect(licenceNumberFrom("C-9 884201")).toBe("884201");
    // Unhyphenated and two-digit, which is how the CSLB data itself writes C35.
    expect(licenceNumberFrom("C35 884201")).toBe("884201");
    expect(licenceNumberFrom("D50 61234")).toBe("61234");
    expect(licenceNumberFrom("B 884201")).toBe("884201");
    expect(licenceNumberFrom("CSLB 884201")).toBe("884201");
    expect(licenceNumberFrom("Lic. No. 884201 (C-35)")).toBe("884201");
  });

  /**
   * LEADING ZEROS, FROM THE REPO'S OWN HARVEST OF 26 REAL CALTRANS FILES: *"the
   * licence is bare digits, 5 to 7 of them, leading zeros significant
   * (`061234`)"*. CSLB stores none, so stripping is mandatory — and note which way
   * the old six-digit floor failed: `061234` is six characters and passed it,
   * while the SAME licence written bare as `61234` did not.
   */
  it("strips leading zeros, because CSLB has none", () => {
    expect(licenceNumberFrom("061234")).toBe("61234");
    expect(licenceNumberFrom("0061234")).toBe("61234");
    expect(licenceNumberFrom("C-9 0884201")).toBe("884201");
    // And the two spellings of one licence land on one key, which is the whole
    // reason this matters: without it they are two leads and two lookups.
    expect(licenceNumberFrom("061234")).toBe(licenceNumberFrom("61234"));
  });
});

describe("one contractor written twice is not an ambiguity", () => {
  /**
   * A §4104 listing names a sub once per portion of work, so one registrant
   * prints under two classifications — and a pasted cell can carry both. Stripping
   * the class codes EVERYWHERE rather than only at the front is what makes this
   * one number instead of two; leaving the second code in turns its digits into a
   * rival licence.
   */
  it("collapses the same number printed under two classifications", () => {
    expect(licenceNumberFrom("C-9 884201 / C-35 884201")).toBe("884201");
    const typed = readTypedLicence("C-9 884201 / C-35 884201");
    expect(typed.ok).toBe(true);
    if (typed.ok) expect(typed.licenceNumber).toBe("884201");
  });

  /**
   * A run that cannot be a licence at any width is not a rival to one that can.
   * Dropped BEFORE the ambiguity test, so a cell holding both identifiers still
   * yields its licence — a mutation testing ambiguity first refuses this row.
   */
  it("reads the licence out of a cell that also carries the registration", () => {
    expect(licenceNumberFrom("C-9 884201   1000012345")).toBe("884201");
  });

  /**
   * And the other direction. Kills the mutation that takes the first of several —
   * the one failure this column cannot afford, since its whole value is that an
   * exact match means the same company.
   */
  it("refuses to choose between two numbers that could both be licences", () => {
    expect(licenceKey("884201 and 772130")).toEqual({ key: null, refusal: "MORE_THAN_ONE" });
    expect(licenceNumberFrom("884201 and 772130")).toBeNull();
  });
});

describe("a cell that says there is no licence", () => {
  /**
   * The repo's Caltrans harvest records the literal `na` in a licence cell. That
   * is the DOCUMENT saying there is none, which is a different fact from a cell
   * nobody can read — and the reason the refusals are distinguishable at all is so
   * a reviewer is not sent looking for a number that was never printed.
   */
  it("reads na, n/a and none as not recorded rather than unreadable", () => {
    for (const raw of ["na", "NA", "n/a", "N/A", "none", " None "]) {
      expect(licenceKey(raw), raw).toEqual({ key: null, refusal: "NOT_RECORDED" });
    }
    expect(licenceKey("")).toEqual({ key: null, refusal: "BLANK" });
    expect(licenceKey(null)).toEqual({ key: null, refusal: "BLANK" });
  });

  it("is nothing to report in a form — most leads have no licence", () => {
    for (const raw of ["", "   ", "na", "N/A"]) {
      const result = readTypedLicence(raw);
      expect(result.ok, raw).toBe(true);
      if (result.ok) expect(result.licenceNumber).toBeNull();
    }
  });
});

describe("what a person types gets an answer, not a silent drop", () => {
  /**
   * THE REFUSAL, AND WHY IT IS A REFUSAL HERE AND A NULL ON THE IMPORT PATH.
   *
   * `licenceNumberFrom` returns null for the same input, because on an import
   * there is nobody to ask. In a form the typist can fix it, and the screen labels
   * this box as the number a lookup uses — so storing something that cannot join,
   * under that label, is a promise the data cannot keep.
   *
   * The two functions disagreeing on one input is the assertion rather than an
   * accident: a mutation routing the form through `licenceNumberFrom` — the
   * tempting simplification — turns this red.
   */
  it("refuses something that is not a licence number, and says what one looks like", () => {
    const result = readTypedLicence("ask Dave");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toMatch(/2 to 7 digits/);
      expect(result.why).toContain("ask Dave");
    }
    expect(licenceNumberFrom("ask Dave")).toBeNull();
  });

  /**
   * The refusal NAMES the likely cause rather than only the rule. A ten-digit
   * number in this box is almost always the DIR registration off the same form,
   * and a message that says so is the difference between a correction and a
   * second attempt at the same mistake.
   */
  it("tells somebody who pasted a DIR registration what they have pasted", () => {
    const result = readTypedLicence("1000012345");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toMatch(/longer than seven digits/);
      expect(result.why).toMatch(/DIR public-works registration/);
    }
  });

  it("refuses two numbers and names both, rather than taking one", () => {
    const result = readTypedLicence("884201 / 772130");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toContain("884201");
      expect(result.why).toContain("772130");
    }
  });

  it("accepts a number with a classification around it, as somebody would paste it", () => {
    const result = readTypedLicence("  C-35 0884201  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.licenceNumber).toBe("884201");
  });
});
