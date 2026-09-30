import { describe, expect, it } from "vitest";
import { normaliseDiscipline } from "@prova/integrations";

/**
 * ONE VOCABULARY FOR THE DISCIPLINE, WHATEVER THE SHEET PRINTED.
 *
 * The eval's first run (2026-09-29, `plan-title-block.1`) came back 9 of 9 on sheet
 * numbers with nothing over-claimed, and exactly one field off: `S2.1` produced a
 * discipline of `"S"` where the index wants `"STRUCTURAL"`. The prompt's rule lists
 * the mapping as `(A architectural, S structural, …)`, which reads as a legend — so
 * returning the key is a fair reading of it.
 *
 * FIXED IN CODE RATHER THAN IN THE PROMPT, which is the decision this file exists to
 * hold. A better sentence would still leave the value to whatever the draughtsman
 * printed: a sheet spelling "STRUCTURAL" out gives the word, one identified only by
 * its prefix gives the letter, and an index showing "A" on one row and
 * "ARCHITECTURAL" on the next is one nobody can filter. A finite lookup is not a
 * judgement, so the model keeps the judgement and code takes the vocabulary.
 *
 * It also means the eval's nine-of-nine result still stands: the prompt did not
 * change, so `plan-title-block.1` is still the version that produced it.
 *
 * IT LIVES IN `apps/web` RATHER THAN BESIDE THE CODE IT TESTS, and that is not a
 * preference either. `packages/integrations` has no package.json script that runs
 * vitest, so a test file there is collected by NOTHING —
 * `lib/testRunnerCensus.test.ts` refused the first version of this file for exactly
 * that, naming the 161 `.dbtest.ts` files CLAUDE.md records as the same shape. A test
 * nothing runs reads as coverage and can never be wrong. `db-target.test.ts` reaches
 * across the same way, into `packages/db`.
 */

describe("the discipline a sheet belongs to", () => {
  it("expands a prefix letter into the word the index groups by", () => {
    expect(normaliseDiscipline("S")).toBe("STRUCTURAL");
    expect(normaliseDiscipline("A")).toBe("ARCHITECTURAL");
    // Two-letter prefixes are real and are not the first letter of anything: FP is
    // fire protection, and reading it as F would find nothing.
    expect(normaliseDiscipline("FP")).toBe("FIRE PROTECTION");
    expect(normaliseDiscipline("ID")).toBe("INTERIOR DESIGN");
  });

  it("leaves a word that is already the word alone", () => {
    expect(normaliseDiscipline("STRUCTURAL")).toBe("STRUCTURAL");
    // Case and stray space, because a title block is typed by a person.
    expect(normaliseDiscipline(" architectural ")).toBe("ARCHITECTURAL");
  });

  it("KEEPS a discipline it has never heard of", () => {
    // A set can carry one this list does not know — a security or AV package, a
    // consultant's own code. Dropping it to null would lose what the sheet actually
    // said in order to keep the column tidy, and the sheet is the authority here.
    expect(normaliseDiscipline("SECURITY")).toBe("SECURITY");
    expect(normaliseDiscipline("AV")).toBe("AV");
  });

  it("treats nothing as nothing, and never as an empty string", () => {
    // Null means "the sheet did not say", which the schema distinguishes from a
    // value. An empty string reaching that column would make the two the same.
    expect(normaliseDiscipline(null)).toBeNull();
    expect(normaliseDiscipline("")).toBeNull();
    expect(normaliseDiscipline("   ")).toBeNull();
  });
});
