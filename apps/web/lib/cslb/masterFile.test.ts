import { describe, expect, it } from "vitest";
import { licenceKey } from "../sales-licence";
import {
  CSLB_COLUMNS,
  cslbClassifications,
  cslbPhone,
  cslbRecordFrom,
  displayName,
} from "./masterFile";

/**
 * Every fixture here is INVENTED. No real licence number, firm name or telephone
 * number appears, per the repo's fixture rule, and the phone numbers use the 555
 * exchange reserved for fiction. The SHAPES are the measured ones.
 */

/** A row in the measured shape, with only the columns this module reads. */
function row(over: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    [CSLB_COLUMNS.licence]: "1234567",
    [CSLB_COLUMNS.businessName]: "ACME DRYWALL INC",
    [CSLB_COLUMNS.fullBusinessName]: "",
    [CSLB_COLUMNS.secondName]: "",
    [CSLB_COLUMNS.phone]: "(916) 555 1234",
    [CSLB_COLUMNS.city]: "SACRAMENTO",
    [CSLB_COLUMNS.county]: "SACRAMENTO",
    [CSLB_COLUMNS.status]: "CLEAR",
    [CSLB_COLUMNS.classifications]: "C-9| C35",
    ...over,
  };
}

describe("cslbPhone", () => {
  it("reads the shape the file actually prints, and writes the conventional one", () => {
    /* Measured: ONE shape over 621 records, with a SPACE before the last four. */
    expect(cslbPhone("(916) 555 1234")).toBe("(916) 555-1234");
  });

  it("accepts the shapes the sample did not show", () => {
    /* 621 of 243,786 rows is not a promise about the rest. */
    expect(cslbPhone("(916) 555-1234")).toBe("(916) 555-1234");
    expect(cslbPhone("9165551234")).toBe("(916) 555-1234");
    expect(cslbPhone("916.555.1234")).toBe("(916) 555-1234");
    expect(cslbPhone("916-555-1234")).toBe("(916) 555-1234");
  });

  it("drops a leading country code", () => {
    expect(cslbPhone("1 (916) 555 1234")).toBe("(916) 555-1234");
    expect(cslbPhone("19165551234")).toBe("(916) 555-1234");
  });

  it("refuses anything that is not ten digits, rather than inventing one", () => {
    expect(cslbPhone("555 1234")).toBeNull();
    expect(cslbPhone("(916) 555 123")).toBeNull();
    expect(cslbPhone("291655512345")).toBeNull();
    expect(cslbPhone("")).toBeNull();
    expect(cslbPhone(null)).toBeNull();
    expect(cslbPhone(undefined)).toBeNull();
    expect(cslbPhone("NONE")).toBeNull();
  });

  it("refuses an all-zero placeholder", () => {
    expect(cslbPhone("(000) 000 0000")).toBeNull();
  });

  it("does not change the digits it was given", () => {
    /* The one liberty taken is punctuation. A transposition here would be a wrong
       number on a call list, which is worse than no number at all. */
    const digits = (value: string) => value.replace(/\D/g, "");
    for (const raw of ["(916) 555 1234", "5305550101", "1 (707) 555 9876"]) {
      const out = cslbPhone(raw);
      expect(out).not.toBeNull();
      expect(digits(out!)).toBe(digits(raw).replace(/^1/, ""));
    }
  });
});

describe("cslbClassifications", () => {
  it("drops the padding hyphen so one code has one spelling", () => {
    /* `C-9` and `C35` are both three characters: the hyphen is padding, so a
       filter written `C-35` or `C9` matches nothing in this data and goes green. */
    expect(cslbClassifications("C-9| C35| D50")).toEqual(["C9", "C35", "D50"]);
  });

  it("reads a single code and a bare letter class", () => {
    expect(cslbClassifications("B")).toEqual(["B"]);
    expect(cslbClassifications("C-2")).toEqual(["C2"]);
  });

  it("collapses a code the row printed twice, keeping order", () => {
    expect(cslbClassifications("C35| C-9| C35")).toEqual(["C35", "C9"]);
  });

  it("reads nothing from an empty cell", () => {
    expect(cslbClassifications("")).toEqual([]);
    expect(cslbClassifications(null)).toEqual([]);
    expect(cslbClassifications("| ")).toEqual([]);
  });

  it("keeps a code it has never heard of", () => {
    /* A reading, not a filter: the file is the authority on which codes exist. */
    expect(cslbClassifications("C-9| ZZ99")).toEqual(["C9", "ZZ99"]);
  });
});

describe("displayName", () => {
  it("prefers FullBusinessName, which is the name the right way round", () => {
    /* Measured: BusinessName is an INDEX form, so a sole owner is filed surname
       first. Reading somebody their own name backwards ends a cold call. */
    expect(
      displayName(
        row({
          [CSLB_COLUMNS.businessName]: "RODRIGUE JOSE",
          [CSLB_COLUMNS.fullBusinessName]: "JOSE RODRIGUE",
        }),
      ),
    ).toBe("JOSE RODRIGUE");
  });

  it("falls back to BusinessName when the full name is empty", () => {
    expect(displayName(row({ [CSLB_COLUMNS.fullBusinessName]: "" }))).toBe("ACME DRYWALL INC");
  });
});

describe("cslbRecordFrom", () => {
  it("reads a whole row", () => {
    const { record, refusal } = cslbRecordFrom(row());
    expect(refusal).toBeUndefined();
    expect(record).toEqual({
      licence: "1234567",
      licenceAsFiled: "1234567",
      phone: "(916) 555-1234",
      name: "ACME DRYWALL INC",
      nameAsFiled: "ACME DRYWALL INC",
      city: "SACRAMENTO",
      county: "SACRAMENTO",
      status: "CLEAR",
      inGoodStanding: true,
      classifications: ["C9", "C35"],
    });
  });

  it("refuses a row with no usable licence, because nothing can be joined to it", () => {
    expect(cslbRecordFrom(row({ [CSLB_COLUMNS.licence]: "" })).refusal).toBe("NO_LICENCE_KEY");
    expect(cslbRecordFrom(row({ [CSLB_COLUMNS.licence]: "PENDING" })).refusal).toBe(
      "NO_LICENCE_KEY",
    );
  });

  it("KEEPS a row whose phone cannot be read", () => {
    /* The name, city and classifications are still true and still worth having.
       Refusing the row would throw them away to avoid a null. */
    const { record } = cslbRecordFrom(row({ [CSLB_COLUMNS.phone]: "" }));
    expect(record?.phone).toBeNull();
    expect(record?.name).toBe("ACME DRYWALL INC");
  });

  it("KEEPS a suspended licence and reports the status rather than hiding it", () => {
    /* 5.2% of the file is some flavour of suspension. A lapsed bond is a reason to
       ring somebody, not a reason to hide them — and the caller decides. */
    const { record } = cslbRecordFrom(row({ [CSLB_COLUMNS.status]: "Contr Bond Susp" }));
    expect(record?.status).toBe("Contr Bond Susp");
    expect(record?.inGoodStanding).toBe(false);
    expect(record?.phone).toBe("(916) 555-1234");
  });

  it("reads a blank city and county as null rather than empty string", () => {
    const { record } = cslbRecordFrom(
      row({ [CSLB_COLUMNS.city]: "", [CSLB_COLUMNS.county]: "" }),
    );
    expect(record?.city).toBeNull();
    expect(record?.county).toBeNull();
  });

  it("takes the join key from licenceKey and not from a second rule of its own", () => {
    /* The #526 shape: a canonical rule with a hand-rolled duplicate beside it is a
       rule whose test cannot see the code that runs. If anybody inlines a digit
       regex here, these disagree and this reds. */
    const awkward = ["C-9 1234567", "0123456", " 92 ", "License No. 102", "1234567"];
    for (const raw of awkward) {
      const mine = cslbRecordFrom(row({ [CSLB_COLUMNS.licence]: raw }));
      const canonical = licenceKey(raw);
      expect(mine.record?.licence ?? null).toBe(canonical.key);
    }
    /* A control: the set must actually contain a value that normalisation CHANGES,
       or every row agrees trivially and this proves nothing. */
    expect(awkward.some((raw) => licenceKey(raw).key !== raw.trim())).toBe(true);
  });
});
