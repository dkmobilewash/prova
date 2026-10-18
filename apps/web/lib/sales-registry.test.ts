import { describe, expect, it } from "vitest";
import {
  CSLB_LICENCE_SEARCH_URL,
  lookupStanding,
  registerLookup,
  registryEntries,
  registrySummaryLine,
  telHref,
  type LeadRegistry,
} from "./sales-registry";

/**
 * WHAT THE LEAD PAGE SAYS ABOUT A LEAD'S PUBLIC-REGISTER COLUMNS.
 *
 * The decisions live here rather than in `SalesLeadRegistry.tsx` because no test
 * in this repo can see layout, and a sentence assembled inside JSX is a sentence
 * only a human eye can check. `components/salesLeadRegistry.test.ts` renders the
 * component and asserts it uses these answers; this asserts the answers.
 */

const bare: LeadRegistry = {
  licenceNumber: null,
  registrationNumber: null,
  city: null,
  listedByGc: null,
  listedOnProject: null,
  phone: null,
};

const imported: LeadRegistry = {
  licenceNumber: "884201",
  registrationNumber: "1000012345",
  city: "Fontana, CA",
  listedByGc: "Swinerton Builders",
  listedOnProject: "Lincoln Elementary Modernization",
  phone: null,
};

describe("the rows the card shows", () => {
  it("shows only what the document said, in reading order", () => {
    expect(registryEntries(imported).map((entry) => entry.label)).toEqual([
      "CSLB licence",
      "DIR registration",
      "City",
      "Listed by",
      "Listed on",
    ]);
  });

  /**
   * Kills the mutation that renders an absent column as "Not recorded". Most
   * leads are typed in by hand and have none of these; five rows of nothing on
   * every one of them teaches a reader to skip the card, including on the
   * imported leads where it is the only route to a phone number.
   */
  it("omits what is absent rather than printing a row of nothing", () => {
    expect(registryEntries(bare)).toEqual([]);
    expect(
      registryEntries({ ...bare, licenceNumber: "884201" }).map((e) => e.label),
    ).toEqual(["CSLB licence"]);
  });

  /**
   * The two identifiers are marked as identifiers and the prose is not — that is
   * what puts a tabular face on a number somebody reads out digit by digit, and
   * leaves a project name in normal text. A mutation marking everything, or
   * nothing, dies here.
   */
  it("marks the identifiers, and only the identifiers", () => {
    const marked = registryEntries(imported)
      .filter((entry) => entry.identifier)
      .map((entry) => entry.label);
    expect(marked).toEqual(["CSLB licence", "DIR registration"]);
  });

  /**
   * A column holding whitespace is an absent column. This is not hypothetical
   * tidiness: `importSubListing` trims, but a person editing the lead by hand can
   * leave a space in the city box, and a card row whose value is " " renders as a
   * label with nothing beside it.
   */
  it("treats a whitespace-only column as absent", () => {
    expect(registryEntries({ ...bare, city: "   " })).toEqual([]);
  });
});

describe("whether this lead can be rung, which is what the licence is for", () => {
  /**
   * THE STATE THE COLUMN WAS ADDED FOR. A §4104 listing carries no telephone
   * number, so this is every imported lead: no phone, a licence, and a sentence
   * that says what the licence is a key TO. A mutation that renders the number
   * without naming the lookup leaves a fact nobody acts on.
   */
  it("names the licence as the lookup key when there is no number to ring", () => {
    const standing = lookupStanding(imported);
    expect(standing.kind).toBe("LOOKUP_READY");
    expect(standing.sentence).toContain("884201");
    expect(standing.sentence).toMatch(/CSLB/);
    expect(standing.sentence).toMatch(/No phone number on file/);
    // And it must not claim a number has been found.
    expect(standing.sentence).not.toMatch(/\d{3}-\d{4}/);
  });

  /**
   * The distinguishing case for the ORDER of the two checks, and the one that
   * matters: a lead with BOTH is callable, and the licence's job changes from
   * finding a number to confirming the company. Swap the branches and the lead
   * you can already ring is reported as one you cannot.
   */
  it("puts a phone number first when there is one, and re-purposes the licence", () => {
    const standing = lookupStanding({ ...imported, phone: "(909) 555-0134" });
    expect(standing.kind).toBe("CALLABLE");
    expect(standing.sentence).toMatch(/A phone number is on file/);
    expect(standing.sentence).toContain("884201");
    expect(standing.sentence).toMatch(/confirms/);
  });

  it("says a number is on file without mentioning a licence it does not have", () => {
    const standing = lookupStanding({ ...bare, phone: "(909) 555-0134" });
    expect(standing.kind).toBe("CALLABLE");
    expect(standing.sentence).toBe("A phone number is on file.");
  });

  /**
   * Said out loud rather than left blank: a card that goes quiet here reads as
   * "nothing to do", and the truth is "this one cannot be reached yet".
   */
  it("says plainly when there is no way to reach them and nothing to look up with", () => {
    const standing = lookupStanding(bare);
    expect(standing.kind).toBe("NO_KEY");
    expect(standing.sentence).toMatch(/nothing here to look a number up with/);
  });

  /**
   * A phone column holding a space is not a phone number. Without the trim this
   * lead reports CALLABLE and the licence sentence disappears — the one lead that
   * most needs the lookup key loses it.
   */
  it("does not count a blank phone column as a number", () => {
    expect(lookupStanding({ ...imported, phone: "   " }).kind).toBe("LOOKUP_READY");
  });
});

describe("the one line a list row gets", () => {
  it("abbreviates the licence and names the city and the GC", () => {
    expect(registrySummaryLine(imported)).toBe(
      "Lic. 884201 · Fontana, CA · listed by Swinerton Builders",
    );
  });

  it("is null for a lead with none of them, so no empty line is rendered", () => {
    expect(registrySummaryLine(bare)).toBeNull();
    expect(registrySummaryLine({ ...bare, city: " " })).toBeNull();
  });

  it("drops the parts that are missing instead of leaving separators behind", () => {
    expect(registrySummaryLine({ ...bare, city: "Riverside, CA" })).toBe("Riverside, CA");
    expect(registrySummaryLine({ ...bare, licenceNumber: "650118" })).toBe("Lic. 650118");
  });
});

/**
 * THE LOOKUP LINK, AND THE ONE THING IT MUST NOT BE.
 *
 * Every licence number below is synthesised. The URL SHAPE was established by
 * loading CSLB in a real Chromium on 2026-10-05, with real numbers used only to
 * compare the two paths; none of them is in this file, and no firm name,
 * address or telephone number from that site is either.
 *
 * The finding these tests pin: CSLB's `LicenseDetail.aspx?LicNum=<n>` URL looks
 * deep-linkable and is not. The same number reached through the search form
 * renders the detail page; requested cold, with no CSLB session, it answers 302
 * to `CheckLicense.aspx` and delivers innerText byte-identical to just visiting
 * that search page. Every visitor arriving from this app is the cold case, so a
 * `LicenseDetail` href would promise a record and hand over an empty search box.
 */
describe("the link that lets somebody actually perform the lookup", () => {
  it("sends them to CSLB's licence search with the number to paste", () => {
    const lookup = registerLookup(imported);
    expect(lookup).not.toBeNull();
    expect(lookup?.url).toBe(CSLB_LICENCE_SEARCH_URL);
    expect(lookup?.licenceNumber).toBe("884201");
    expect(lookup?.instruction).toContain("884201");
  });

  /**
   * THE MUTATION THIS FILE EXISTS FOR, and it is the one a well-meaning reader
   * will make: `LicenseDetail.aspx?LicNum=${licence}` is the URL a browser shows
   * after a successful search, so it looks like the better link. Requested cold
   * it 302s to the search page, so that href claims a record and delivers a
   * blank box. Nothing else in this suite would notice.
   */
  it("does NOT build a LicenseDetail deep link, which 302s to the search page", () => {
    const lookup = registerLookup(imported);
    expect(lookup?.url).not.toMatch(/LicenseDetail/i);
    expect(lookup?.url).not.toMatch(/LicNum/i);
    // Nor does it smuggle the number into the href some other way.
    expect(lookup?.url).not.toContain("884201");
    expect(lookup?.url).toMatch(/^https:\/\/www\.cslb\.ca\.gov\//);
  });

  /**
   * The link must say it lands on a search box BEFORE it is clicked. A link that
   * promises a record and opens an empty form is a link people stop using, and
   * the number is useless unless they know to paste it.
   */
  it("warns that it opens a search box rather than the licence itself", () => {
    const lookup = registerLookup(imported);
    expect(lookup?.instruction).toMatch(/search/i);
    expect(lookup?.instruction).toMatch(/paste/i);
    expect(lookup?.instruction).toMatch(/no link that opens a licence directly/i);
  });

  /**
   * The link's own words may not promise a telephone number or an email. The
   * measurement is a RATE over thousands of firms, which says nothing about this
   * company, and CSLB publishes no email address at all.
   */
  it("promises a lookup, never a phone number and never an email", () => {
    const lookup = registerLookup(imported);
    const words = `${lookup?.linkLabel} ${lookup?.instruction}`;
    expect(lookup?.linkLabel).toMatch(/look/i);
    expect(words).not.toMatch(/email/i);
    expect(words).not.toMatch(/\bcall\b/i);
    expect(words).not.toMatch(/phone number for|get (?:their|a) (?:phone|number)/i);
  });

  it("is null with no licence, rather than a dead link to nowhere", () => {
    expect(registerLookup(bare)).toBeNull();
    expect(registerLookup({ ...imported, licenceNumber: "  " })).toBeNull();
  });

  /**
   * A lead that already has a number STILL gets the lookup, because the standing
   * sentence says the licence is then what confirms the company is the right
   * one. Gate the link on "no phone" and that sentence points at nothing.
   */
  it("still offers the lookup on a lead that can already be rung", () => {
    expect(registerLookup({ ...imported, phone: "(909) 555-0134" })?.licenceNumber).toBe(
      "884201",
    );
  });
});

describe("the tel: link, which is a link a person taps", () => {
  it("strips the number down to digits for the href", () => {
    expect(telHref({ ...bare, phone: "(909) 555-0134" })).toBe("tel:9095550134");
  });

  /**
   * The distinguishing case, and the reason stripping is not cosmetic: a stored
   * number is whatever somebody typed into a free-text box, and an extension
   * concatenated into the href dials a different number than the one on screen.
   * A raw `tel:${phone}` passes the plain case above and fails this.
   */
  it("does not dial an extension as part of the number", () => {
    expect(telHref({ ...bare, phone: "(909) 555-0134 ext 2" })).toBe("tel:90955501342");
    // ...which is why the displayed text stays what was typed, not this href.
  });

  it("keeps a leading + so an international number still dials", () => {
    expect(telHref({ ...bare, phone: "+1 909 555 0134" })).toBe("tel:+19095550134");
    expect(telHref({ ...bare, phone: "1 909 555 0134" })).toBe("tel:19095550134");
  });

  /**
   * A phone column holding prose must not become a link that dials nothing.
   * `phone` is a free-text box on the hand-typed lead form, so "call the office"
   * is a value a person can really store.
   */
  it("is null when there is no number in the column at all", () => {
    expect(telHref(bare)).toBeNull();
    expect(telHref({ ...bare, phone: "   " })).toBeNull();
    expect(telHref({ ...bare, phone: "call the office" })).toBeNull();
    expect(telHref({ ...bare, phone: "x2" })).toBeNull();
  });
});
