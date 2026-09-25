import { describe, expect, it } from "vitest";

import {
  addendumProblem,
  bidResponsiveness,
  requirementProblem,
  responsivenessSentence,
  type AddendumInput,
  type RequirementInput,
  type ResponsivenessLine,
} from "./bid-responsiveness";

const line = (
  over: Partial<ResponsivenessLine> & Pick<ResponsivenessLine, "id" | "kind">,
): ResponsivenessLine => ({
  label: "Soffits",
  amount: 1_000,
  unit: null,
  unitPrice: null,
  accepted: null,
  ...over,
});

const addendum = (over: Partial<AddendumInput> & Pick<AddendumInput, "id">): AddendumInput => ({
  reference: "Addendum 1",
  issuedOn: "2026-09-20",
  acknowledgedOn: "2026-09-21",
  affectsPricedScope: false,
  impactNote: null,
  ...over,
});

const requirement = (
  over: Partial<RequirementInput> & Pick<RequirementInput, "id">,
): RequirementInput => ({
  kind: "BID_BOND",
  label: "Bid bond, 10% of base",
  required: true,
  satisfiedOn: "2026-09-22",
  ...over,
});

const clean = { lines: [], addenda: [], requirements: [] };

describe("an unacknowledged addendum is reported, because it is what gets bids binned", () => {
  it("names the addendum the GC's way and says why it matters", () => {
    const result = bidResponsiveness({
      ...clean,
      addenda: [addendum({ id: "a", reference: "Addendum 3", acknowledgedOn: null })],
    });
    expect(result.blockingCount).toBe(1);
    expect(result.outstanding[0].sentence).toContain("Addendum 3");
    expect(result.outstanding[0].sentence).toContain("thrown out");
    expect(result.outstanding[0].source).toBe("DERIVED");
  });

  it("says nothing about one that HAS been acknowledged", () => {
    const result = bidResponsiveness({ ...clean, addenda: [addendum({ id: "a" })] });
    expect(result.outstanding).toEqual([]);
    expect(result.blockingCount).toBe(0);
  });

  it("an acknowledgement is a DATE, so any date closes it", () => {
    // The model stores a date rather than a boolean; this pins that the
    // check is "is there one", not "is it recent" or "is it after issue".
    const result = bidResponsiveness({
      ...clean,
      addenda: [addendum({ id: "a", issuedOn: "2026-09-20", acknowledgedOn: "1999-01-01" })],
    });
    expect(result.outstanding).toEqual([]);
  });
});

describe("the derived checks come off the bid lines and cannot be ticked", () => {
  it("an ALTERNATE with no amount sinks the whole bid, and says so", () => {
    const result = bidResponsiveness({
      ...clean,
      lines: [line({ id: "l", kind: "ALTERNATE", label: "Alt 2 — upgraded ceiling", amount: null })],
    });
    expect(result.blockingCount).toBe(1);
    expect(result.outstanding[0].sentence).toContain("Alt 2 — upgraded ceiling");
    expect(result.outstanding[0].sentence).toContain("whole bid");
  });

  it("a UNIT_PRICE with no rate is outstanding — its amount is SUPPOSED to be null", () => {
    // The trap: UNIT_PRICE carries no amount by design (bid-lines.prisma:
    // "NULL, always"), so a check written against `amount` would fire on
    // every unit price forever. The rate is the field that matters.
    const result = bidResponsiveness({
      ...clean,
      lines: [line({ id: "l", kind: "UNIT_PRICE", label: "Extra stud, per LF", amount: null, unit: "LF", unitPrice: null })],
    });
    expect(result.blockingCount).toBe(1);
    expect(result.outstanding[0].key).toBe("unit-price:l");
  });

  it("a UNIT_PRICE WITH a rate is fine even though its amount is null", () => {
    const result = bidResponsiveness({
      ...clean,
      lines: [line({ id: "l", kind: "UNIT_PRICE", amount: null, unit: "LF", unitPrice: 12.5 })],
    });
    expect(result.outstanding).toEqual([]);
  });

  it("an ALLOWANCE with no sum is outstanding, and the sentence says it is inside the base", () => {
    const result = bidResponsiveness({
      ...clean,
      lines: [line({ id: "l", kind: "ALLOWANCE", label: "Hardware allowance", amount: null })],
    });
    expect(result.outstanding[0].sentence).toContain("INSIDE the base");
  });

  it("a NEGATIVE alternate is priced — a deduct is a price, not a blank", () => {
    // bid-lines stores a deduct as a signed negative. Treating "falsy" as
    // "missing" would report every deduct as unpriced.
    const result = bidResponsiveness({
      ...clean,
      lines: [line({ id: "l", kind: "ALTERNATE", amount: -4_000 })],
    });
    expect(result.outstanding).toEqual([]);
  });

  it("an alternate priced at ZERO is priced", () => {
    const result = bidResponsiveness({ ...clean, lines: [line({ id: "l", kind: "ALTERNATE", amount: 0 })] });
    expect(result.outstanding).toEqual([]);
  });
});

describe("recorded requirements are somebody's attestation, not a computation", () => {
  it("an unsatisfied required item blocks", () => {
    const result = bidResponsiveness({
      ...clean,
      requirements: [requirement({ id: "r", label: "Bid bond, 10% of base", satisfiedOn: null })],
    });
    expect(result.blockingCount).toBe(1);
    expect(result.outstanding[0].source).toBe("RECORDED");
    expect(result.outstanding[0].sentence).toContain("Bid bond, 10% of base");
  });

  it("an unsatisfied OPTIONAL item is shown and does NOT block", () => {
    const result = bidResponsiveness({
      ...clean,
      requirements: [requirement({ id: "r", required: false, satisfiedOn: null })],
    });
    expect(result.outstanding).toHaveLength(1);
    expect(result.outstanding[0].blocking).toBe(false);
    expect(result.blockingCount).toBe(0);
    expect(result.outstanding[0].sentence).toContain("optional");
  });

  it("blocking items sort above non-blocking ones", () => {
    const result = bidResponsiveness({
      ...clean,
      requirements: [
        requirement({ id: "optional", required: false, satisfiedOn: null }),
        requirement({ id: "blocking", required: true, satisfiedOn: null }),
      ],
    });
    expect(result.outstanding.map((o) => o.key)).toEqual(["requirement:blocking", "requirement:optional"]);
  });
});

describe("nothing here ever says the bid is ready", () => {
  it("the all-clear sentence still says the app has not read the ITB", () => {
    // THE POINT OF THE WHOLE MODULE. The best case is not a green tick: this
    // app has only ever seen what somebody typed in from the GC's document.
    const sentence = responsivenessSentence(bidResponsiveness(clean));
    expect(sentence).toContain("has not read the ITB");
    expect(sentence).toContain("check the form");
    expect(sentence.toLowerCase()).not.toContain("ready");
    expect(sentence.toLowerCase()).not.toContain("compliant");
  });

  it("counts the blocking items and warns what a miss costs", () => {
    const sentence = responsivenessSentence(
      bidResponsiveness({
        ...clean,
        addenda: [addendum({ id: "a", acknowledgedOn: null })],
        lines: [line({ id: "l", kind: "ALTERNATE", amount: null })],
      }),
    );
    expect(sentence).toContain("2 things");
    expect(sentence).toContain("rejected unread");
  });

  it("says the singular properly for one", () => {
    const sentence = responsivenessSentence(
      bidResponsiveness({ ...clean, addenda: [addendum({ id: "a", acknowledgedOn: null })] }),
    );
    expect(sentence).toContain("1 thing would");
  });

  it("optional-only outstanding does not read as a failure, and still hedges", () => {
    const sentence = responsivenessSentence(
      bidResponsiveness({
        ...clean,
        requirements: [requirement({ id: "r", required: false, satisfiedOn: null })],
      }),
    );
    expect(sentence).toContain("would sink the bid");
    expect(sentence).toContain("typed in");
    expect(sentence.toLowerCase()).not.toContain("ready");
  });
});

describe("an addendum that changed priced work is a different warning from a paperwork miss", () => {
  it("warns separately, and an ACKNOWLEDGED one still warns", () => {
    // Acknowledging an addendum says you received it. It says nothing about
    // whether you re-priced what it changed — which is the expensive half.
    const result = bidResponsiveness({
      ...clean,
      addenda: [
        addendum({
          id: "a",
          reference: "Addendum 2",
          acknowledgedOn: "2026-09-21",
          affectsPricedScope: true,
          impactNote: "soffit detail changed at grid C",
        }),
      ],
    });
    expect(result.outstanding).toEqual([]);
    expect(result.blockingCount).toBe(0);
    expect(result.repriceWarnings).toEqual([
      "Addendum 2 changed work you had already priced — soffit detail changed at grid C",
    ]);
  });

  it("warns without a note too", () => {
    const result = bidResponsiveness({
      ...clean,
      addenda: [addendum({ id: "a", reference: "ASI 4", affectsPricedScope: true })],
    });
    expect(result.repriceWarnings).toEqual(["ASI 4 changed work you had already priced."]);
  });

  it("stays quiet when nothing changed priced scope", () => {
    const result = bidResponsiveness({ ...clean, addenda: [addendum({ id: "a" })] });
    expect(result.repriceWarnings).toEqual([]);
  });
});

describe("input validation", () => {
  it("an addendum needs whatever the GC called it", () => {
    expect(addendumProblem({ reference: "  " })).toContain("which addendum");
    expect(addendumProblem({ reference: "Addendum 3" })).toBeNull();
  });

  it("a requirement needs the GC's own wording", () => {
    expect(requirementProblem({ label: "" })).toContain("in their words");
    expect(requirementProblem({ label: "Bid bond 10%" })).toBeNull();
  });

  it("an unnamed row still renders a sentence rather than an empty quote", () => {
    const result = bidResponsiveness({
      ...clean,
      lines: [line({ id: "l", kind: "ALTERNATE", label: "   ", amount: null })],
    });
    expect(result.outstanding[0].sentence).toContain("(unnamed)");
  });
});
