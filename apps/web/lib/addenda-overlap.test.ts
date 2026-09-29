import { describe as group, expect, it } from "vitest";
import {
  addendaOverlap,
  normaliseReference,
  overlapSentence,
  type AddendumDecision,
  type AddendumForOverlap,
  type AddendumItem,
} from "./addenda-overlap";

/**
 * The two halves of this module fail in opposite directions, so they are tested
 * in opposite directions.
 *
 * Normalisation that is too TIGHT misses the overlap the feature exists to
 * catch — "Sheet A-201" and "A-201" are the same sheet and a reader who writes
 * both is the normal case. Normalisation that is too LOOSE flags every bid,
 * which is a warning nobody reads and is how a real one gets ignored. Both
 * directions are named tests below, because an earlier draft of this module had
 * one of each and neither would have shown up as a failure — it would have
 * shipped quietly grouping nothing, or grouping everything.
 */

function item(over: Partial<AddendumItem> & { reference: string }): AddendumItem {
  return {
    ordinal: 1,
    label: null,
    referenceKind: "SPEC_SECTION",
    summary: "revised",
    reason: "the item says so",
    confidence: "HIGH",
    sourcePageLabel: null,
    ...over,
  };
}

function addendum(
  addendumId: string,
  reference: string,
  items: AddendumItem[],
  decisions: [string, AddendumDecision][] = [],
): AddendumForOverlap {
  return { addendumId, reference, items, decisions: new Map(decisions) };
}

group("normalising a reference so two spellings of one scope meet", () => {
  it("strips the words a GC puts in front of a number", () => {
    // The case the feature exists for. If these stop matching, an addendum that
    // says "Sheet A-201" and one that says "A-201" become two scopes and the
    // overlap is silently never reported.
    expect(normaliseReference("Sheet A-201")).toBe(normaliseReference("A-201"));
    expect(normaliseReference("Section 09 21 16")).toBe(normaliseReference("09 21 16"));
    expect(normaliseReference("Spec 09 22 16")).toBe(normaliseReference("09 22 16"));
    expect(normaliseReference("SPECIFICATION 07 24 00")).toBe(normaliseReference("07 24 00"));
  });

  it("ignores the punctuation and spacing a number is written with", () => {
    expect(normaliseReference("09 21 16")).toBe("092116");
    expect(normaliseReference("09-21-16")).toBe("092116");
    expect(normaliseReference("092116")).toBe("092116");
    expect(normaliseReference("  09 21 16  ")).toBe("092116");
  });

  it("does NOT collapse a sub-section into its parent", () => {
    // Deliberate, and the module says why: a sub-section is a narrower scope and
    // truncating would assert a relationship the document did not. Pinned so the
    // next person changing it is choosing to, rather than discovering it.
    expect(normaliseReference("09 21 16.13")).not.toBe(normaliseReference("09 21 16"));
    expect(normaliseReference("Detail 4/A-501")).not.toBe(normaliseReference("A-501"));
  });

  it("does not validate — an unrecognisable reference still normalises", () => {
    // Four comments in this repo refuse to check a code against MasterFormat.
    // Grouping is not validating: whatever the GC wrote, two identical strings
    // must meet, and nothing is rejected for being unfamiliar.
    expect(normaliseReference("Bulletin 4 attachment C")).toBe("bulletin4attachmentc");
    expect(normaliseReference("the north stair")).toBe("thenorthstair");
    expect(normaliseReference("ZZ-99")).toBe(normaliseReference("zz 99"));
  });
});

group("which scopes more than one addendum names", () => {
  it("reports a scope two addenda both name, however each spelt it", () => {
    const overlap = addendaOverlap([
      addendum("a2", "Addendum 2", [item({ reference: "Section 09 21 16" })]),
      addendum("a5", "Addendum 5", [item({ reference: "09 21 16" })]),
    ]);
    expect(overlap).toHaveLength(1);
    expect(overlap[0].normalisedReference).toBe("092116");
    // BOTH spellings are kept, because the screen shows them side by side: the
    // grouping is a claim, and a person has to be able to check it.
    expect(overlap[0].spellings).toEqual(["Section 09 21 16", "09 21 16"]);
    expect(overlap[0].touchedBy.map((t) => t.addendumId)).toEqual(["a2", "a5"]);
  });

  it("says nothing when only one addendum names a scope", () => {
    const overlap = addendaOverlap([
      addendum("a2", "Addendum 2", [item({ reference: "09 21 16" })]),
      addendum("a5", "Addendum 5", [item({ reference: "09 22 16" })]),
    ]);
    expect(overlap).toEqual([]);
  });

  it("counts one addendum naming a scope twice as ONE touch", () => {
    // Otherwise a single letter mentioning 09 21 16 in items 4 and 9 reports
    // itself as an overlap, with nothing to compare it against.
    const overlap = addendaOverlap([
      addendum("a2", "Addendum 2", [
        item({ ordinal: 4, reference: "09 21 16" }),
        item({ ordinal: 9, reference: "Section 09 21 16" }),
      ]),
    ]);
    expect(overlap).toEqual([]);
  });

  it("never raises an overlap on General or the bid process", () => {
    // Every addendum has a "General" item and most move a date. Grouping on them
    // would flag essentially every bid with two addenda — the cry-wolf failure
    // `takeoff-currency.ts` guards against for same-day issues.
    const overlap = addendaOverlap([
      addendum("a2", "Addendum 2", [
        item({ reference: "General", referenceKind: "GENERAL" }),
        item({ reference: "Bid date", referenceKind: "BID_PROCESS" }),
      ]),
      addendum("a5", "Addendum 5", [
        item({ reference: "General", referenceKind: "GENERAL" }),
        item({ reference: "Bid date", referenceKind: "BID_PROCESS" }),
      ]),
    ]);
    expect(overlap).toEqual([]);
  });

  it("drops a scope the estimator has said is not theirs", () => {
    const overlap = addendaOverlap([
      addendum("a2", "Addendum 2", [item({ reference: "09 21 16" })], [["092116", "NOT_MINE"]]),
      addendum("a5", "Addendum 5", [item({ reference: "09 21 16" })], [["092116", "NOT_MINE"]]),
    ]);
    expect(overlap).toEqual([]);
  });

  it("keeps a scope that is undecided, and one marked MINE", () => {
    // Absence of a NOT_MINE is what counts — an item nobody has ruled on yet is
    // exactly the one worth flagging.
    const undecided = addendaOverlap([
      addendum("a2", "Addendum 2", [item({ reference: "09 21 16" })]),
      addendum("a5", "Addendum 5", [item({ reference: "09 21 16" })]),
    ]);
    expect(undecided).toHaveLength(1);

    const mine = addendaOverlap([
      addendum("a2", "Addendum 2", [item({ reference: "09 21 16" })], [["092116", "MINE"]]),
      addendum("a5", "Addendum 5", [item({ reference: "09 21 16" })], [["092116", "MINE"]]),
    ]);
    expect(mine).toHaveLength(1);
  });

  it("ignores a reference that normalises to nothing", () => {
    // "Section" alone, or punctuation. An empty key would collect every such
    // item into one group and report a scope called "" touched by three addenda.
    const overlap = addendaOverlap([
      addendum("a2", "Addendum 2", [item({ reference: "Section" })]),
      addendum("a5", "Addendum 5", [item({ reference: "—" })]),
    ]);
    expect(overlap).toEqual([]);
  });
});

group("what the panel is allowed to say about it", () => {
  it("names the addenda and never concludes anything", () => {
    const [scope] = addendaOverlap([
      addendum("a2", "Addendum 2", [item({ reference: "Section 09 21 16" })]),
      addendum("a5", "Addendum 5", [item({ reference: "09 21 16" })]),
    ]);
    const sentence = overlapSentence(scope);
    expect(sentence).toContain("Addendum 2 and Addendum 5");
    expect(sentence).toContain("check what each one changed");
    // The app has not compared the documents, so it may not say they disagree,
    // which one wins, or that anything needs re-pricing.
    expect(sentence).not.toMatch(/conflict|supersed|re-?price|overrid/i);
  });

  it("survives two addenda the GC gave the same name", () => {
    // `BidAddendum` has no unique on `reference` and deliberately so — the number
    // is the GC's. De-duplicating the names leaves ONE, and joining a one-item
    // list as prose produced " and Addendum 3".
    const [scope] = addendaOverlap([
      addendum("a2", "Addendum 3", [item({ reference: "09 21 16" })]),
      addendum("a5", "Addendum 3", [item({ reference: "09 21 16" })]),
    ]);
    const sentence = overlapSentence(scope);
    expect(sentence).toBe(
      "2 addenda both called Addendum 3 both name 09 21 16 — check what each one changed.",
    );
    expect(sentence).not.toMatch(/^\s*and\b/);
    expect(sentence).not.toContain(" and Addendum 3 both name");
  });

  it("lists three addenda readably", () => {
    const [scope] = addendaOverlap([
      addendum("a1", "Addendum 1", [item({ reference: "09 21 16" })]),
      addendum("a2", "Addendum 2", [item({ reference: "09 21 16" })]),
      addendum("a3", "Addendum 3", [item({ reference: "09 21 16" })]),
    ]);
    expect(overlapSentence(scope)).toContain("Addendum 1, Addendum 2 and Addendum 3");
  });
});
