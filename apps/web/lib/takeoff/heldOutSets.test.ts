import { describe, expect, it } from "vitest";
import { HELD_OUT_SETS, heldOutReason, isHeldOut, splitForTraining } from "./heldOutSets";

/**
 * The names are the real ones, exactly as the twelve PDFs are called in
 * `real-plans/new/`. That matters: not one of the four held-out sets has
 * "held out" anywhere in its name, which is why the rule cannot live in a
 * file-name check.
 */
const HELD_OUT_FILES = [
  "CENTRAL-BANK-OF-THE-MIDWEST-Drawings.pdf",
  "Gen-BBQ-Sacramento-CA.pdf",
  "SLN-Terminal-Public-Area-Improvements-Plans.pdf",
  "stem-bid-drawings (1).pdf",
];

const TRAINING_FILES = [
  "2025.07.08_Baker_EOC_BID.pdf",
  "BUNKIE-BID-DRAWINGS.pdf",
  "Crosslines-Phase-II-Drawings.pdf",
  "E_Street_421-Set.pdf",
  "IFBREBID-Murray-Tower-Package.pdf",
  "MHK_FOR-BID-SET.pdf",
  "NG-Green-Bay-WI.pdf",
  "SW-Grand-Junction-CO.pdf",
  "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf",
  "2025-03-28_ELEVEN03 PERMIT SET_ARCH.pdf",
  "20260424_HPL Lighthouse_Bulletin 2.pdf",
];

describe("the sets that must never reach training", () => {
  it("refuses every held-out set by its real file name", () => {
    for (const file of HELD_OUT_FILES) {
      expect(isHeldOut(file), file).toBe(true);
      expect(heldOutReason(file)).not.toBeNull();
    }
  });

  it("allows every training set", () => {
    for (const file of TRAINING_FILES) {
      expect(isHeldOut(file), file).toBe(false);
    }
  });

  it("matches however the name was punctuated on its way through", () => {
    // A label directory is the PDF's name with the punctuation replaced, so
    // the same set arrives spelled two ways and both must be refused.
    expect(isHeldOut("Gen-BBQ-Sacramento-CA.pdf")).toBe(true);
    expect(isHeldOut("Gen_BBQ_Sacramento_CA.pdf")).toBe(true);
    expect(isHeldOut("gen bbq sacramento ca")).toBe(true);
    expect(isHeldOut("GENBBQSACRAMENTOCA")).toBe(true);
  });

  it("still refuses Cedar Hollow, which was held out long before these", () => {
    // Spelled with spaces rather than hyphens: `truthWall.test.ts` greps the
    // tree for the hyphenated form to prove nothing reads that answer key,
    // and the flattening makes the two spellings the same question anyway —
    // which the punctuation case above already proves on another set.
    expect(isHeldOut("Cedar Hollow.pdf")).toBe(true);
    expect(isHeldOut("CEDARHOLLOW answer key.json")).toBe(true);
  });

  it("says nothing about a set it has never heard of", () => {
    expect(isHeldOut("Some-Other-Job.pdf")).toBe(false);
    expect(isHeldOut(null)).toBe(false);
    expect(isHeldOut("")).toBe(false);
  });

  it("covers all four sets held out on 2026-10-20, plus Cedar Hollow", () => {
    // A count, pinned, so removing an entry is a deliberate act rather than a
    // line that vanishes in a refactor.
    expect(HELD_OUT_SETS).toHaveLength(5);
  });
});

describe("splitting labelled sets for a training run", () => {
  const rowsFor = (set: string, n: number) => ({ set, rows: Array.from({ length: n }, (_, i) => `${set}-${i}`) });

  it("keeps training rows and refuses held-out ones", () => {
    const got = splitForTraining([
      rowsFor("Camp Bow Wow - 100% CD_ARCH (2) (1).pdf", 3),
      rowsFor("Gen-BBQ-Sacramento-CA.pdf", 5),
      rowsFor("E_Street_421-Set.pdf", 2),
    ]);
    expect(got.train).toHaveLength(5);
    expect(got.train.every((r) => !r.startsWith("Gen"))).toBe(true);
    expect(got.refused).toHaveLength(1);
    expect(got.refused[0].rows).toBe(5);
    expect(got.refused[0].why).toContain("restaurant");
  });

  it("REPORTS what it refused rather than dropping it quietly", () => {
    // A run that silently ignored four sets and a run that never saw them look
    // identical in the output, and the first means somebody's labels were
    // wasted without anybody noticing.
    const got = splitForTraining(HELD_OUT_FILES.map((f) => rowsFor(f, 10)));
    expect(got.train).toHaveLength(0);
    expect(got.refused).toHaveLength(4);
    expect(got.refused.reduce((n, r) => n + r.rows, 0)).toBe(40);
    for (const one of got.refused) expect(one.why.length).toBeGreaterThan(0);
  });

  it("lets a run of only training sets through untouched", () => {
    const got = splitForTraining([rowsFor("NG-Green-Bay-WI.pdf", 4)]);
    expect(got.train).toHaveLength(4);
    expect(got.refused).toEqual([]);
  });
});
