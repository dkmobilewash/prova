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

/**
 * ── THE SETS ADDED 2026-10-21, BY THEIR REAL FILE NAMES ──
 *
 * Taken from the folder rather than typed from the request, because a name
 * that does not match the file refuses nothing and this list is the only
 * thing standing between a test key and a training run. `OReillys-
 * Architectural-Drawings.pdf` has no apostrophe on disk; Jefferson City is
 * `Jefferson-City-Civil.pdf`.
 */
const REFUSED_2026_10_21 = [
  "KSU-Fairchild-Hall.pdf",
  "Albany-Readiness-Center.pdf",
  "OReillys-Architectural-Drawings.pdf",
  "Jefferson-City-Civil.pdf",
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

  it("refuses the three sets held out on 2026-10-21, and Albany's sibling", () => {
    // These were added BEFORE a label was written on any of them, which is
    // the only order that makes a held-out set worth anything: a set held out
    // after its labels reached a training run is not held out, it is late.
    for (const file of REFUSED_2026_10_21) {
      expect(isHeldOut(file), file).toBe(true);
      expect(heldOutReason(file), file).not.toBeNull();
    }
  });

  it("says Jefferson City is a SIBLING rather than an answer key", () => {
    // It is in the same list because the list is the only thing the training
    // path consults, and a second mechanism for "keep out of training" is a
    // second thing to forget. But it is not a test set, and anybody counting
    // answer keys off this list has to be able to tell.
    const why = heldOutReason("Jefferson-City-Civil.pdf");
    expect(why).toContain("SIBLING");
    expect(why).toContain("not a test key");
    // And the set it is a sibling of really is held out, or the entry is
    // protecting nothing.
    expect(isHeldOut("Albany-Readiness-Center.pdf")).toBe(true);
  });

  it("matches the new names however they were punctuated", () => {
    // A label directory is the PDF's name with punctuation replaced, and
    // O'Reillys is the one most likely to arrive spelled differently — with
    // the apostrophe a person would write, or underscored as a directory.
    expect(isHeldOut("O'Reillys Architectural Drawings")).toBe(true);
    expect(isHeldOut("OReillys_Architectural_Drawings.pdf")).toBe(true);
    expect(isHeldOut("KSU_Fairchild_Hall")).toBe(true);
  });

  it("covers every set held out so far, Cedar Hollow and one sibling", () => {
    // A count, pinned, so removing an entry is a deliberate act rather than a
    // line that vanishes in a refactor. 5 to 9 on 2026-10-21 (KSU, Albany,
    // O'Reillys, plus Jefferson City as Albany's sibling); 9 to 12 on
    // 2026-10-29 (Modbox, Darrington, Hillside), each held out BEFORE a label
    // was written for it, which is the only order in which holding out means
    // anything.
    expect(HELD_OUT_SETS).toHaveLength(12);
  });

  it("refuses the three sets held out on 2026-10-29, before round 8 labelled them", () => {
    // The real file names, as they appear in the plans folder.
    expect(heldOutReason("Modbox-Bistro-plans.pdf")).toContain("held out 2026-10-29");
    expect(heldOutReason("Darrington-Library-Tenant-Improvements.pdf")).toContain("held out 2026-10-29");
    expect(heldOutReason("HILLSIDE-VILLAGE-Apartments.pdf")).toContain("held out 2026-10-29");
  });

  it("matches those three however the name was punctuated", () => {
    // `flatten` strips punctuation and case from both sides, so a name that
    // arrives underscored, unspaced or shouted still refuses. A round-8 label
    // written against a differently-punctuated copy must not slip into
    // training because the spelling drifted.
    expect(heldOutReason("modbox_bistro_plans.pdf")).not.toBeNull();
    expect(heldOutReason("MODBOX BISTRO PLANS.pdf")).not.toBeNull();
    expect(heldOutReason("darrington library tenant improvements.pdf")).not.toBeNull();
    expect(heldOutReason("Hillside_Village_Apartments.pdf")).not.toBeNull();
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
