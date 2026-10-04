import { describe as group, expect, it } from "vitest";
import {
  MIN_QUOTE_LENGTH,
  normaliseForQuoteMatch,
  quoteIsInDocument,
  TYPOGRAPHIC_EQUIVALENTS,
  whyNot,
} from "./quoteMatch";
import { SPEC_CASES } from "./specCases";

/**
 * THE GUARD ON THE SPEC EVAL'S SHARPEST ASSERTION.
 *
 * `quoteMatch.ts` decides whether a finding's quote is really on the page. That
 * is the only check in the spec eval a plausible-sounding answer cannot satisfy,
 * so it is also the one most dangerous to loosen — and it HAS been loosened
 * once, deliberately, after a paid run failed on a typographic apostrophe.
 *
 * **Both directions are here, and only the second is a guard.** The permissive
 * cases prove the matcher does not fail an honest transcription; the hostile
 * ones prove it still fails a fabrication. A file with only the first half
 * would go green on a matcher that returns `true` unconditionally, which is
 * exactly the vacuous shape this repo keeps paying for.
 */

group("an honest transcription matches", () => {
  const LINES = [
    "B. MOCK-UP: Prior to fabrication, construct a field mock-up of one",
    "   typical partition, 8 feet long by full height, including framing,",
    "   board, finish and one door opening. Obtain Architect's written",
    "   acceptance before proceeding.",
  ];

  it("matches the quote exactly as the page spells it", () => {
    expect(quoteIsInDocument("Obtain Architect's written acceptance before proceeding.", LINES)).toBe(true);
  });

  it("matches a TYPOGRAPHIC apostrophe against the page's straight one", () => {
    // THE CASE THAT COST A PAID RUN. The model returned U+2019 where the page
    // has U+0027 — same sentence, same length, one code point apart.
    expect(quoteIsInDocument("Obtain Architect’s written acceptance before proceeding.", LINES)).toBe(true);
  });

  it("matches across the lines the page wrapped on", () => {
    // Four source lines, one sentence. A reader quoting it correctly returns
    // the sentence, not the line breaks.
    expect(
      quoteIsInDocument(
        "construct a field mock-up of one typical partition, 8 feet long by full height",
        LINES,
      ),
    ).toBe(true);
  });

  it("matches an en-dash hyphen, curly double quotes and a non-breaking space", () => {
    const page = ['A. Provide a "Level 5" finish - see GA-214 - at all public areas.'];
    expect(
      quoteIsInDocument('Provide a “Level 5” finish – see GA‑214 – at all public areas.', page),
    ).toBe(true);
  });

  it("ignores case and runs of whitespace", () => {
    expect(quoteIsInDocument("obtain   architect's    WRITTEN acceptance", LINES)).toBe(true);
  });
});

group("a fabrication still fails, which is the whole point", () => {
  const LINES = [
    "A. Provide Level 4 finish at all exposed surfaces. Level 5 finish is",
    "   NOT required under this Section.",
    "B. No field mock-up is required for the work of this Section.",
  ];

  it("refuses a PARAPHRASE of a sentence that is on the page", () => {
    // Every word plausible, the meaning close, and not what the page says.
    // This is the failure mode the assertion exists for.
    expect(quoteIsInDocument("Provide a Level 4 finish on all of the exposed surfaces.", LINES)).toBe(false);
  });

  it("refuses a sentence the page never contains", () => {
    expect(
      quoteIsInDocument("Provide Level 5 finish at all public areas in accordance with GA-214.", LINES),
    ).toBe(false);
  });

  it("ACCEPTS a truncated fragment that inverts the meaning — and that is not this function's job", () => {
    // WRITTEN AS AN EXPECTATION OF `false` FIRST, AND IT WAS WRONG. Recorded
    // because the wrong version is the tempting one.
    //
    // The page says "No field mock-up is required for the work of this
    // Section." Drop the "No" and the remainder is still a LITERAL substring
    // of the page, so a containment check must say yes. It is reporting a fact
    // about the text, and the fact is true.
    expect(quoteIsInDocument("field mock-up is required for the work of this Section", LINES)).toBe(true);

    // The fix is NOT to make this stricter. A mid-sentence fragment is a
    // legitimate quote — the "matches across the lines the page wrapped on"
    // case above quotes one — so any rule that rejected this would reject
    // honest citations too, and would be measuring sentence boundaries rather
    // than presence.
    //
    // THE INVERSION IS CAUGHT ELSEWHERE, by the eval's INVENTED check, which
    // reads the finding's label, requirement and whyItCosts against the case's
    // `forbidden` list. `names-and-excludes` forbids "mock-up" and "mock up"
    // precisely so a finding that claims this section demands one is FATAL no
    // matter how impeccably it is quoted. That check passed on the first paid
    // run: the reader declined the whole case and explained that the section
    // "expressly disclaims Level 5 and any field mock-up".
    //
    // So the division is deliberate: this function answers "is this text on
    // the page", the forbidden list answers "does this finding claim something
    // the page denies". Neither can do the other's work, and collapsing them
    // into one fuzzy check would do both badly.
    expect(SPEC_CASES.find((k) => k.id === "names-and-excludes")?.forbidden).toContain("mock-up");
  });

  it("refuses a quote too short to be evidence", () => {
    // "Level 5" IS on this page, in a sentence saying it is not required — so
    // presence alone cannot support a finding.
    expect(quoteIsInDocument("Level 5", LINES)).toBe(false);
    expect(whyNot("Level 5", LINES)).toBe("too-short");
  });

  it("refuses an empty or whitespace-only quote", () => {
    expect(quoteIsInDocument("", LINES)).toBe(false);
    expect(quoteIsInDocument("   \n  ", LINES)).toBe(false);
  });

  it("tells a short quote apart from an absent one", () => {
    // A report that says "not on the page" about a quote that was merely
    // short sends somebody looking for a fabrication that did not happen.
    expect(whyNot("Provide Level 4 finish at all exposed surfaces.", LINES)).toBeNull();
    expect(whyNot("Provide Level 9 finish at all exposed surfaces.", LINES)).toBe("not-in-document");
  });
});

group("the normalisation cannot change a word", () => {
  it("maps every declared variant to its ASCII twin, and nothing else", () => {
    // SIZE AND MEMBERSHIP ASSERTED, so a table that lost a row — or a
    // `split`/`join` that stopped replacing — fails here rather than silently
    // narrowing what the matcher accepts.
    expect(TYPOGRAPHIC_EQUIVALENTS.length).toBeGreaterThanOrEqual(5);
    for (const { ascii, variants } of TYPOGRAPHIC_EQUIVALENTS) {
      expect(variants.length, `${ascii} has no variants`).toBeGreaterThan(0);
      for (const variant of variants) {
        expect(
          normaliseForQuoteMatch(`a${variant}b`),
          `${JSON.stringify(variant)} was not mapped to ${JSON.stringify(ascii)}`,
        ).toBe(normaliseForQuoteMatch(`a${ascii}b`));
      }
    }
  });

  it("leaves letters, digits and word boundaries alone", () => {
    // The property that keeps a paraphrase failing: normalisation touches
    // punctuation only. If it ever stripped or merged words, the hostile group
    // above would start passing.
    expect(normaliseForQuoteMatch("Level 5 finish, GA-214")).toBe("level 5 finish, ga-214");
    expect(normaliseForQuoteMatch("two  words")).toBe("two words");
    expect(normaliseForQuoteMatch("twowords")).not.toBe(normaliseForQuoteMatch("two words"));
  });

  it("keeps the minimum length a real constraint", () => {
    expect(MIN_QUOTE_LENGTH).toBeGreaterThanOrEqual(8);
  });
});

group("every eval case is still quotable", () => {
  it("finds each case's own longest line in its own document", () => {
    // A SIZE-AND-REACH CHECK ON THE CASES THEMSELVES. If `specCases.ts` ever
    // drifts so that a case's text cannot be quoted back out of it, the eval's
    // quote assertion would fail every finding on that case and read as the
    // MODEL fabricating — which is the wrong diagnosis to hand somebody after
    // a paid run.
    expect(SPEC_CASES.length).toBeGreaterThanOrEqual(6);
    for (const kase of SPEC_CASES) {
      const longest = [...kase.lines].sort((a, b) => b.trim().length - a.trim().length)[0]!.trim();
      expect(longest.length, `${kase.id} has no line long enough to quote`).toBeGreaterThanOrEqual(
        MIN_QUOTE_LENGTH,
      );
      expect(quoteIsInDocument(longest, kase.lines), `${kase.id}: its own line does not match`).toBe(true);
    }
  });
});
