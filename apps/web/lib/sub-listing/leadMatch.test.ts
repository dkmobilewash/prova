import { describe, expect, it } from "vitest";
import { identifiersContradict, leadCandidatesFor, normaliseCompanyName } from "./leadMatch";

/**
 * The asymmetry this suite is built around: a MISSED match costs a duplicate
 * lead, which somebody merges in a minute. A WRONG match attaches a researched
 * signal about one company to a different company's record, and then somebody
 * rings a stranger and reads it to them. So every ambiguous case must come back
 * as a candidate for a person to settle, never as an answer.
 *
 * Every licence here is a pre-existing fixture number from this repo and every
 * DIR registration is synthetic. No real registrant appears in this file.
 */

/** A lead with no identifiers, which is what a hand-typed one looks like. */
function lead(id: string, companyName: string): Lead {
  return { id, companyName, licenceNumber: null, registrationNumber: null };
}

type Lead = {
  id: string;
  companyName: string;
  licenceNumber: string | null;
  registrationNumber: string | null;
};

/** A listed row carrying nothing but a name, which many rows genuinely are. */
function listed(name: string) {
  return { name, licence: null, registration: null };
}

const leads = [
  lead("1", "Valley Interior Systems, Inc."),
  lead("2", "Western Fireproofing Co."),
  lead("3", "Western Electric"),
  lead("4", "Summit Acoustics LLC"),
  lead("5", "Baker Drywall"),
  lead("6", "Baker Plastering"),
];

describe("reducing a company name to the part that carries identity", () => {
  it.each([
    ["Valley Interior Systems, Inc.", "valley interior systems"],
    ["Summit Acoustics LLC", "summit acoustics"],
    ["Western Fireproofing Co.", "western fireproofing"],
    ["Pacific Lath & Plaster Inc.", "pacific lath plaster"],
    ["Acme Drywall Co. Inc.", "acme drywall"],
    ["NORTHSTATE DRYWALL", "northstate drywall"],
    ["Diablo Ceiling & Partition", "diablo ceiling partition"],
  ])("reads %s as %s", (raw, expected) => {
    expect(normaliseCompanyName(raw)).toBe(expected);
  });

  /**
   * Stripping trade words was considered and refused. "Baker Drywall" and
   * "Baker Plastering" are two companies, and a normaliser that collapsed them
   * would merge two real prospects into one silently.
   */
  it("keeps trade words, because they distinguish real companies", () => {
    expect(normaliseCompanyName("Baker Drywall")).not.toBe(normaliseCompanyName("Baker Plastering"));
  });
});

describe("finding the lead a listed subcontractor might already be, by name", () => {
  it("calls an entity-suffix difference the same company", () => {
    const { attachable } = leadCandidatesFor(listed("Valley Interior Systems"), leads);
    expect(attachable).toHaveLength(1);
    expect(attachable[0].lead.id).toBe("1");
    expect(attachable[0].evidence).toBe("SAME_NAME");
  });

  it("offers a word-subset match as SIMILAR_NAME and never as settled", () => {
    const { attachable } = leadCandidatesFor(listed("Summit Acoustics of Riverside"), leads);
    expect(attachable).toHaveLength(1);
    expect(attachable[0].lead.id).toBe("4");
    expect(attachable[0].evidence).toBe("SIMILAR_NAME");
  });

  it("puts an exact name match above a merely similar one", () => {
    const withBoth = [...leads, lead("7", "Valley Interior")];
    const { attachable } = leadCandidatesFor(listed("Valley Interior Systems"), withBoth);
    expect(attachable.map((c) => c.evidence)).toEqual(["SAME_NAME", "SIMILAR_NAME"]);
    expect(attachable[0].lead.id).toBe("1");
  });

  /**
   * The failure mode that matters. "Western Fireproofing" and "Western Electric"
   * share every word that is not the trade, and a one-word resemblance is not a
   * resemblance at all.
   */
  it("does not match two companies that share only one word", () => {
    expect(leadCandidatesFor(listed("Western Plastering"), leads).attachable).toEqual([]);
  });

  /**
   * FOUND BY MUTATION, NOT BY READING. Relaxing the two-word floor to one left
   * the suite entirely green, because every case above happens to compare two
   * two-word names where the subset check fails on its own. The floor only bites
   * when the shorter name is a SINGLE word — and then it is the difference
   * between "no match" and silently attaching a researched signal to whichever
   * "Western" was entered first.
   */
  it("does not treat a single-word name as a subset of every longer one", () => {
    expect(leadCandidatesFor(listed("Western"), leads).attachable).toEqual([]);
    expect(leadCandidatesFor(listed("Baker"), leads).attachable).toEqual([]);
    expect(leadCandidatesFor(listed("Summit"), leads).attachable).toEqual([]);
  });

  it("does not confuse two trades under one family name", () => {
    const { attachable } = leadCandidatesFor(listed("Baker Drywall"), leads);
    expect(attachable).toHaveLength(1);
    expect(attachable[0].lead.id).toBe("5");
    expect(attachable[0].evidence).toBe("SAME_NAME");
  });

  it("returns nothing for a company nobody has entered, which is the common case", () => {
    expect(leadCandidatesFor(listed("Oakwood Interior Contractors"), leads)).toEqual({
      attachable: [],
      differentRegistrant: [],
    });
  });

  it("returns nothing rather than throwing on empty input", () => {
    expect(leadCandidatesFor(listed(""), leads).attachable).toEqual([]);
    expect(leadCandidatesFor(listed("Inc."), leads).attachable).toEqual([]);
    expect(leadCandidatesFor(listed("Valley Interior Systems"), []).attachable).toEqual([]);
  });

  it("ignores a lead whose name normalises to nothing", () => {
    expect(leadCandidatesFor(listed("Valley Interior Systems"), [lead("8", "LLC")]).attachable).toEqual(
      [],
    );
  });
});

describe("matching on an identifier neither party typed", () => {
  const holder: Lead = {
    id: "L",
    companyName: "Acme Lath Systems",
    licenceNumber: "884201",
    registrationNumber: null,
  };

  /**
   * THE CAPABILITY THIS WHOLE SLICE EXISTS FOR. The names have nothing in
   * common, so the name rules return nothing — and before the licence was
   * visible here the reviewer saw no candidate at all and created the duplicate
   * by hand. `importSubListing` deliberately will NOT merge this pair on its own
   * (the name does not corroborate the licence, and a hand-typed digit can be
   * transposed); offering it to a person is the whole point of the difference.
   */
  it("offers a licence match whose name corroborates nothing", () => {
    const { attachable } = leadCandidatesFor(
      { name: "Sierra Wall & Ceiling", licence: "884201", registration: null },
      [...leads, holder],
    );
    expect(attachable).toHaveLength(1);
    expect(attachable[0].lead.id).toBe("L");
    expect(attachable[0].evidence).toBe("SAME_LICENCE");
  });

  /**
   * One contractor holds ONE number under several classifications, so a listing
   * prints "C-9 884201" on the framing row and "C-35 884201" on the plaster row
   * for one man. Without `licenceNumberFrom` here, the stored key and the matched
   * key would be produced by two different rules and every prefixed row would
   * miss — which is the exact defect `lib/sales-licence.ts` was written for.
   */
  it.each(["C-9 884201", "C-35 884201", "  884201  "])(
    "reads %s as the same licence the lead holds",
    (printed) => {
      const { attachable } = leadCandidatesFor(
        { name: "Sierra Wall & Ceiling", licence: printed, registration: null },
        [holder],
      );
      expect(attachable.map((c) => c.evidence)).toEqual(["SAME_LICENCE"]);
    },
  );

  it("matches on a DIR registration when that is the only identifier printed", () => {
    const registrant: Lead = {
      id: "R",
      companyName: "Keystone Acoustical",
      licenceNumber: null,
      registrationNumber: "1000012345",
    };
    const { attachable } = leadCandidatesFor(
      { name: "Nothing Alike", licence: null, registration: "1000012345" },
      [registrant],
    );
    expect(attachable.map((c) => c.evidence)).toEqual(["SAME_REGISTRATION"]);
  });

  /**
   * An identifier outranks a name, because the licence is printed on the
   * document and typed by neither party while both names were typed by somebody.
   * The order is what the reviewer reads top-down, so it is asserted rather than
   * left to the array's insertion order.
   */
  it("ranks a licence match above an exact name match", () => {
    const { attachable } = leadCandidatesFor(
      { name: "Valley Interior Systems", licence: "884201", registration: null },
      [...leads, holder],
    );
    expect(attachable.map((c) => c.evidence)).toEqual(["SAME_LICENCE", "SAME_NAME"]);
    expect(attachable[0].lead.id).toBe("L");
  });

  /**
   * The name check is deliberately BELOW the identifier checks rather than a
   * guard at the top of the function, which is where it used to be (`if
   * (!target) return []`). A column split badly enough to leave the name cell
   * empty, or holding only the "&" out of "Lath & Plaster", can still have read
   * the licence cell — and that licence is the best evidence in the building.
   *
   * THE FIRST VERSION OF THIS CASE USED "Inc." AND PROVED NOTHING. Moving the
   * guard back above the identifier checks left it green, because
   * `normaliseCompanyName("Inc.")` is `"inc"`, not `""` — the normaliser strips a
   * suffix only where the name ENDS WITH " inc", leading space and all, so a
   * bare suffix survives as a word. Measured, not assumed: "", "   ", "&", "."
   * and "-" are what normalise to nothing; "Inc.", "LLC" and "Co." do not.
   */
  it.each(["", "   ", "&"])(
    "matches on the licence when the row's name (%j) normalises to nothing",
    (name) => {
      const { attachable } = leadCandidatesFor({ name, licence: "884201", registration: null }, [
        holder,
      ]);
      expect(attachable.map((c) => c.evidence)).toEqual(["SAME_LICENCE"]);
    },
  );

  it("still matches a lead that holds no identifiers at all, on its name", () => {
    const { attachable } = leadCandidatesFor(
      { name: "Baker Drywall", licence: "884201", registration: null },
      leads,
    );
    expect(attachable.map((c) => [c.lead.id, c.evidence])).toEqual([["5", "SAME_NAME"]]);
  });
});

describe("the one case it refuses to offer: the documents say two registrants", () => {
  /**
   * An identical name over contradicting licences is not a strong candidate, it
   * is two companies — `importSubListing` has said so since it was written, and
   * this is the same predicate rather than a second opinion. Attaching here
   * welds two firms together for good.
   */
  it("keeps an identical name out of the dropdown when the licences disagree", () => {
    const other: Lead = {
      id: "X",
      companyName: "Valley Interior Systems, Inc.",
      licenceNumber: "650118",
      registrationNumber: null,
    };
    const { attachable, differentRegistrant } = leadCandidatesFor(
      { name: "Valley Interior Systems", licence: "884201", registration: null },
      [other],
    );
    expect(attachable).toEqual([]);
    expect(differentRegistrant).toEqual([
      { lead: other, kind: "licence", listed: "884201", existing: "650118" },
    ]);
  });

  /**
   * Reported rather than dropped, and reported WITH BOTH NUMBERS. A suppression
   * nobody can see is this module deciding, which its own title says it does
   * not do — and one of the two numbers may be a transposed digit somebody has
   * to go and fix, which they cannot do without seeing them.
   */
  it("names the registration when that is the identifier that disagrees", () => {
    const other: Lead = {
      id: "Y",
      companyName: "Keystone Acoustical",
      licenceNumber: null,
      registrationNumber: "1000099999",
    };
    const { attachable, differentRegistrant } = leadCandidatesFor(
      { name: "Keystone Acoustical", licence: null, registration: "1000012345" },
      [other],
    );
    expect(attachable).toEqual([]);
    expect(differentRegistrant).toEqual([
      { lead: other, kind: "registration", listed: "1000012345", existing: "1000099999" },
    ]);
  });

  it("reports the licence in preference to the registration when both disagree", () => {
    const other: Lead = {
      id: "Z",
      companyName: "Keystone Acoustical",
      licenceNumber: "650118",
      registrationNumber: "1000099999",
    };
    const { differentRegistrant } = leadCandidatesFor(
      { name: "Keystone Acoustical", licence: "884201", registration: "1000012345" },
      [other],
    );
    expect(differentRegistrant.map((d) => d.kind)).toEqual(["licence"]);
  });

  /**
   * The `||` in `identifiersContradict` is deliberate and this is the case that
   * proves it: one kind AGREEING does not cancel the other kind DISAGREEING. A
   * shared licence with two different DIR registrations is still two
   * registrants, and without the `||` this would have come back as a confident
   * SAME_LICENCE.
   */
  it("treats a shared licence with contradicting registrations as two registrants", () => {
    const other: Lead = {
      id: "W",
      companyName: "Keystone Acoustical",
      licenceNumber: "884201",
      registrationNumber: "1000099999",
    };
    const { attachable, differentRegistrant } = leadCandidatesFor(
      { name: "Keystone Acoustical", licence: "884201", registration: "1000012345" },
      [other],
    );
    expect(attachable).toEqual([]);
    expect(differentRegistrant.map((d) => d.kind)).toEqual(["registration"]);
  });

  it("is not a contradiction when only one side printed the identifier", () => {
    expect(identifiersContradict({ licence: "884201", registration: null }, { licence: null, registration: null })).toBe(false);
    expect(identifiersContradict({ licence: null, registration: null }, { licence: "884201", registration: null })).toBe(false);
    expect(identifiersContradict({ licence: "884201", registration: null }, { licence: "884201", registration: null })).toBe(false);
    expect(identifiersContradict({ licence: "884201", registration: null }, { licence: "650118", registration: null })).toBe(true);
  });
});

describe("which identifier is named when more than one agrees", () => {
  /**
   * Both identifiers agree, so both labels would be TRUE and the order of the
   * two blocks decides which the reviewer reads. Pinned because a mutation
   * swapping them survived everything else in this file: no other case has two
   * identifiers agreeing at once. The licence wins because it is the key CSLB's
   * own published file is built on, which is what makes it the number a person
   * can act on.
   */
  it("names the licence, not the registration, when both agree", () => {
    const both = {
      id: "B",
      companyName: "Nothing Alike",
      licenceNumber: "884201",
      registrationNumber: "1000012345",
    };
    const { attachable } = leadCandidatesFor(
      { name: "Sierra Wall & Ceiling", licence: "884201", registration: "1000012345" },
      [both],
    );
    expect(attachable.map((c) => c.evidence)).toEqual(["SAME_LICENCE"]);
  });
});
