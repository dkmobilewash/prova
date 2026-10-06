import { describe, expect, it } from "vitest";
import type { CslbRecord } from "./masterFile";
import {
  applyPhoneFill,
  emptySummary,
  fillOutcome,
  fillPlan,
  indexByLicence,
  writesFrom,
  type LeadForFill,
} from "./phoneFill";

/** Invented throughout; 555 is the exchange reserved for fiction. */
function record(over: Partial<CslbRecord> = {}): CslbRecord {
  return {
    licence: "1234567",
    licenceAsFiled: "1234567",
    phone: "(916) 555-1234",
    name: "ACME DRYWALL INC",
    nameAsFiled: "ACME DRYWALL INC",
    city: "SACRAMENTO",
    county: "SACRAMENTO",
    status: "CLEAR",
    inGoodStanding: true,
    classifications: ["C9"],
    ...over,
  };
}

function lead(over: Partial<LeadForFill> = {}): LeadForFill {
  return {
    id: "lead_1",
    companyName: "ACME DRYWALL",
    licenceNumber: "1234567",
    phone: null,
    ...over,
  };
}

const found = (records: CslbRecord[]) => {
  const { byLicence } = indexByLicence(records);
  return (licence: string) => byLicence.get(licence);
};

describe("fillOutcome", () => {
  it("fills a lead that has a licence and no phone", () => {
    const outcome = fillOutcome(lead(), found([record()]));
    expect(outcome.kind).toBe("FILLED");
    expect(outcome.kind === "FILLED" && outcome.phone).toBe("(916) 555-1234");
  });

  it("NEVER overwrites a number a person typed", () => {
    /* The one rule that matters. A typed number may be the mobile of the estimator
       they actually speak to; the file has an office line. */
    const outcome = fillOutcome(lead({ phone: "(707) 555-9999" }), found([record()]));
    expect(outcome.kind).toBe("ALREADY_HAS_PHONE");
    expect(outcome.kind === "ALREADY_HAS_PHONE" && outcome.existing).toBe("(707) 555-9999");
  });

  it("reports the file's different number WITHOUT acting on it", () => {
    /* Noticing the disagreement is useful and belongs in a report. Acting on it is
       not this job's to do. */
    const outcome = fillOutcome(lead({ phone: "(707) 555-9999" }), found([record()]));
    expect(outcome.kind === "ALREADY_HAS_PHONE" && outcome.fileHas).toBe("(916) 555-1234");
  });

  it("treats a whitespace-only phone as no phone", () => {
    expect(fillOutcome(lead({ phone: "   " }), found([record()])).kind).toBe("FILLED");
  });

  it("says NO_LICENCE when the listing had no licence column", () => {
    expect(fillOutcome(lead({ licenceNumber: null }), found([record()])).kind).toBe("NO_LICENCE");
    expect(fillOutcome(lead({ licenceNumber: "" }), found([record()])).kind).toBe("NO_LICENCE");
  });

  it("says NOT_IN_FILE for a licence the file does not carry", () => {
    const outcome = fillOutcome(lead({ licenceNumber: "7654321" }), found([record()]));
    expect(outcome.kind).toBe("NOT_IN_FILE");
    expect(outcome.kind === "NOT_IN_FILE" && outcome.licence).toBe("7654321");
  });

  it("says NO_PHONE_IN_FILE when the row is there and the column is not", () => {
    const outcome = fillOutcome(lead(), found([record({ phone: null })]));
    expect(outcome.kind).toBe("NO_PHONE_IN_FILE");
  });

  it("matches across a class prefix and a leading zero on either side", () => {
    /* One normaliser for both sides, so neither of these is a miss. */
    expect(fillOutcome(lead({ licenceNumber: "C-9 1234567" }), found([record()])).kind).toBe(
      "FILLED",
    );
    expect(
      fillOutcome(
        lead({ licenceNumber: "0123456" }),
        found([record({ licence: "123456", licenceAsFiled: "123456" })]),
      ).kind,
    ).toBe("FILLED");
  });

  it("fills from a SUSPENDED licence, because the firm still answers the telephone", () => {
    const outcome = fillOutcome(
      lead(),
      found([record({ status: "Contr Bond Susp", inGoodStanding: false })]),
    );
    expect(outcome.kind).toBe("FILLED");
    expect(outcome.kind === "FILLED" && outcome.record.inGoodStanding).toBe(false);
  });

  it("NO lead that had a phone ever appears in the writes", () => {
    /* THE SAFETY PROPERTY, stated over the writes rather than over the outcome
       name. Found by mutation: moving the guard below the lookup left the
       plainly-named overwrite test GREEN, because a different branch was then
       doing the work — so that test was about nothing for the one edit most
       likely to break this. What cannot be true is a write against a lead that
       already had a number, and that is what this asserts. */
    const withPhones = ["(707) 555-9999", " x ", "unknown", "0"];
    const licences = [null, "", "1234567", "C-9 1234567", "7654321", "0123456"];
    const leads = withPhones.flatMap((phone) =>
      licences.map((licenceNumber, index) =>
        lead({ id: `${phone}:${index}`, phone, licenceNumber }),
      ),
    );
    const { decisions } = fillPlan(leads, found([record()]));
    expect(writesFrom(decisions)).toEqual([]);
    /* A control: the same leads WITHOUT their phones must produce writes, or this
       passes because nothing was ever fillable. */
    const unphoned = leads.map((one) => ({ ...one, phone: null }));
    expect(writesFrom(fillPlan(unphoned, found([record()])).decisions).length).toBeGreaterThan(0);
  });

  it("cannot reach the writing branch from a lead that has a phone", () => {
    /* Asserted over the whole cross product rather than one case, because the
       ordering inside the function is the safety property and an edit that moved
       the licence test above the phone test would pass every case above. */
    const phones = ["(707) 555-9999", " x ", "unknown"];
    const licences = [null, "", "1234567", "C-9 1234567", "7654321"];
    for (const phone of phones) {
      for (const licenceNumber of licences) {
        const outcome = fillOutcome(lead({ phone, licenceNumber }), found([record()]));
        expect(outcome.kind).toBe("ALREADY_HAS_PHONE");
      }
    }
  });
});

describe("fillPlan", () => {
  it("counts every outcome and writes only the FILLED ones", () => {
    const leads = [
      lead({ id: "a" }),
      lead({ id: "b", phone: "(707) 555-9999" }),
      lead({ id: "c", licenceNumber: null }),
      lead({ id: "d", licenceNumber: "7654321" }),
      lead({ id: "e", licenceNumber: "9999999" }),
    ];
    const { decisions, summary } = fillPlan(
      leads,
      found([record(), record({ licence: "9999999", licenceAsFiled: "9999999", phone: null })]),
    );
    expect(summary).toEqual({
      FILLED: 1,
      ALREADY_HAS_PHONE: 1,
      NO_LICENCE: 1,
      NOT_IN_FILE: 1,
      NO_PHONE_IN_FILE: 1,
    });
    /* Every lead got exactly one verdict — the count must equal what was asked. */
    expect(decisions).toHaveLength(leads.length);
    expect(Object.values(summary).reduce((a, b) => a + b, 0)).toBe(leads.length);
    expect(writesFrom(decisions)).toEqual([
      { id: "a", phone: "(916) 555-1234", expectPhone: null },
    ]);
  });

  it("writes nothing at all for an empty set", () => {
    const { decisions, summary } = fillPlan([], found([record()]));
    expect(summary).toEqual(emptySummary());
    expect(writesFrom(decisions)).toEqual([]);
  });

  it("every summary key starts at zero and the record is total", () => {
    expect(Object.values(emptySummary()).every((n) => n === 0)).toBe(true);
    expect(Object.keys(emptySummary()).sort()).toEqual([
      "ALREADY_HAS_PHONE",
      "FILLED",
      "NOT_IN_FILE",
      "NO_LICENCE",
      "NO_PHONE_IN_FILE",
    ]);
  });
});

describe("indexByLicence", () => {
  it("keeps the first row for a licence and counts the collision", () => {
    /* `LicenseNo` is the file's primary key, so a duplicate is a surprise worth
       reporting rather than a case to absorb silently. */
    const { byLicence, duplicates } = indexByLicence([
      record({ name: "FIRST" }),
      record({ name: "SECOND" }),
    ]);
    expect(byLicence.get("1234567")?.name).toBe("FIRST");
    expect(duplicates).toBe(1);
    expect(byLicence.size).toBe(1);
  });

  it("counts no duplicates for distinct licences", () => {
    const { byLicence, duplicates } = indexByLicence([
      record(),
      record({ licence: "7654321", licenceAsFiled: "7654321" }),
    ]);
    expect(duplicates).toBe(0);
    expect(byLicence.size).toBe(2);
  });
});

describe("applyPhoneFill", () => {
  /** A client that records its calls and reports what the WHERE matched. */
  function client(matches: (id: string, expect: string | null) => boolean) {
    const calls: { id: string; expectPhone: string | null; phone: string }[] = [];
    return {
      calls,
      salesLead: {
        async updateMany(args: {
          where: { id: string; phone: string | null };
          data: { phone: string };
        }) {
          calls.push({
            id: args.where.id,
            expectPhone: args.where.phone,
            phone: args.data.phone,
          });
          return { count: matches(args.where.id, args.where.phone) ? 1 : 0 };
        },
      },
    };
  }

  it("updates only on the phone it expected to find", async () => {
    const spy = client(() => true);
    const result = await applyPhoneFill(spy, [
      { id: "a", phone: "(916) 555-1234", expectPhone: null },
    ]);
    expect(result).toEqual({ written: 1, raced: [] });
    /* The WHERE carries the expected value — without it the update is
       unconditional and the race below cannot be detected at all. */
    expect(spy.calls).toEqual([{ id: "a", expectPhone: null, phone: "(916) 555-1234" }]);
  });

  it("reports a lead that gained a phone between planning and applying", async () => {
    /* The real race: somebody types a number into the lead form mid-run. The
       database refuses, and that must be visible rather than counted as a write. */
    const spy = client(() => false);
    const result = await applyPhoneFill(spy, [
      { id: "a", phone: "(916) 555-1234", expectPhone: null },
    ]);
    expect(result).toEqual({ written: 0, raced: ["a"] });
  });

  it("writes nothing when there is nothing to write", async () => {
    const spy = client(() => true);
    expect(await applyPhoneFill(spy, [])).toEqual({ written: 0, raced: [] });
    expect(spy.calls).toEqual([]);
  });
});
