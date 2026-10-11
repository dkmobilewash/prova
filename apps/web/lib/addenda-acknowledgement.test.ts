import { describe, expect, it } from "vitest";
import {
  addendaProblem,
  addendaStanding,
  addendumNumber,
  type AcknowledgeableAddendum,
} from "./addenda-acknowledgement";

const on = "2026-10-01";

const addendum = (
  reference: string,
  over: Partial<AcknowledgeableAddendum> = {},
): AcknowledgeableAddendum => ({
  reference,
  acknowledgedOn: on,
  affectsPricedScope: false,
  ...over,
});

describe("addendumNumber", () => {
  it("reads the number out of the ways a GC writes it", () => {
    expect(addendumNumber("Addendum No. 3")).toBe(3);
    expect(addendumNumber("ADDENDUM #03")).toBe(3);
    expect(addendumNumber("Add 3")).toBe(3);
    expect(addendumNumber("3")).toBe(3);
    expect(addendumNumber("Addendum 12")).toBe(12);
  });

  it("takes the number the reference is ABOUT, not a later one", () => {
    expect(addendumNumber("Addendum 2 to Bid Package 7")).toBe(2);
  });

  it("REFUSES A DATE OR A YEAR that wandered into the field", () => {
    // Nobody issues a 2,026th addendum. Without this, `Addendum 2026-01-14`
    // reads as number 2026 and every real addendum below it is reported
    // missing — two thousand of them.
    expect(addendumNumber("Addendum 2026-01-14")).toBeNull();
    expect(addendumNumber("2026")).toBeNull();
  });

  it("says null for a reference nobody can number", () => {
    // Some GCs issue `Addendum A`. Not an error, but it cannot take part in a
    // sequence check and must not be given a position.
    expect(addendumNumber("Addendum A")).toBeNull();
    expect(addendumNumber("")).toBeNull();
    expect(addendumNumber("Addendum 0")).toBeNull();
  });
});

describe("addendaStanding", () => {
  it("writes the line a bid form asks for", () => {
    const standing = addendaStanding([addendum("Addendum 1"), addendum("Addendum 2"), addendum("Addendum 3")]);
    expect(standing.sentence).toBe("Includes Addenda 1 through 3.");
    expect(standing.missing).toEqual([]);
  });

  it("lists them out when there are only two", () => {
    expect(addendaStanding([addendum("Addendum 1"), addendum("Addendum 2")]).sentence).toBe(
      "Includes Addenda 1 and 2.",
    );
  });

  it("FINDS THE ADDENDUM THAT WAS NEVER LOGGED", () => {
    // The whole point. Three addenda, all read, all acknowledged, all priced —
    // every other screen in the product is happy. The only evidence that a
    // fourth was issued is the number that is not there.
    const standing = addendaStanding([addendum("Addendum 1"), addendum("Addendum 2"), addendum("Addendum 4")]);
    expect(standing.missing).toEqual([3]);
    expect(standing.sentence).toBeNull();
  });

  it("COUNTS FROM ONE, not from the lowest one held", () => {
    // A bid holding only addendum 3 is missing 1 and 2. Starting at the lowest
    // held would call that set complete — the same set seen from the most
    // dangerous angle.
    expect(addendaStanding([addendum("Addendum 3")]).missing).toEqual([1, 2]);
  });

  it("REFUSES TO WRITE THE LINE over a set with a hole in it", () => {
    // A bid form saying "Includes Addenda 1 through 4" on a set missing number
    // 3 is worse than no line at all: it is a written claim to have read
    // something nobody has.
    const standing = addendaStanding([addendum("Addendum 1"), addendum("Addendum 4")]);
    expect(standing.sentence).toBeNull();
  });

  it("refuses the line while anything is unacknowledged", () => {
    const standing = addendaStanding([addendum("Addendum 1"), addendum("Addendum 2", { acknowledgedOn: null })]);
    expect(standing.sentence).toBeNull();
    expect(standing.unacknowledged).toEqual(["Addendum 2"]);
  });

  it("names the ones that change priced scope AND are not acknowledged", () => {
    const standing = addendaStanding([
      addendum("Addendum 1"),
      addendum("Addendum 2", { acknowledgedOn: null, affectsPricedScope: true }),
    ]);
    expect(standing.pricedAndUnacknowledged).toEqual(["Addendum 2"]);
  });

  it("keeps an unnumbered addendum out of the sequence rather than guessing", () => {
    const standing = addendaStanding([addendum("Addendum 1"), addendum("Addendum A")]);
    expect(standing.unnumbered).toEqual(["Addendum A"]);
    expect(standing.missing).toEqual([]);
    // And no confident line, because the set cannot be checked for gaps.
    expect(standing.sentence).toBeNull();
  });

  it("writes NO LINE for a bid with no addenda, rather than an empty claim", () => {
    const standing = addendaStanding([]);
    expect(standing.sentence).toBeNull();
    expect(standing.missing).toEqual([]);
  });

  it("does not report a gap for the same addendum logged twice", () => {
    const standing = addendaStanding([addendum("Addendum 1"), addendum("Addendum No. 1"), addendum("Addendum 2")]);
    expect(standing.missing).toEqual([]);
    expect(standing.sentence).toBe("Includes Addenda 1 and 2.");
  });
});

describe("addendaProblem", () => {
  it("says nothing when there is a sentence to give", () => {
    const standing = addendaStanding([addendum("Addendum 1"), addendum("Addendum 2")]);
    expect(addendaProblem(standing, 2)).toBeNull();
  });

  it("NAMES THE MISSING NUMBER and says to ask the GC", () => {
    // "Something is wrong with the addenda" sends somebody to read five rows.
    // Naming the number sends them to the GC, which is the action.
    const standing = addendaStanding([addendum("Addendum 1"), addendum("Addendum 3")]);
    const problem = addendaProblem(standing, 2);
    expect(problem).toContain("Addendum 2");
    expect(problem).toContain("Ask the GC");
  });

  it("names several missing numbers in one sentence", () => {
    const standing = addendaStanding([addendum("Addendum 5")]);
    const problem = addendaProblem(standing, 1);
    expect(problem).toContain("Addenda 1 through 4");
  });

  it("tells a bid with no addenda that the form still asks", () => {
    expect(addendaProblem(addendaStanding([]), 0)).toContain("No addenda logged");
  });

  it("leads with the priced-scope ones rather than burying them in a list", () => {
    const standing = addendaStanding([
      addendum("Addendum 1", { acknowledgedOn: null, affectsPricedScope: true }),
      addendum("Addendum 2", { acknowledgedOn: null }),
    ]);
    const problem = addendaProblem(standing, 2);
    expect(problem).toContain("change");
    expect(problem).toContain("priced scope");
    expect(problem).toContain("Addendum 1");
  });
});
