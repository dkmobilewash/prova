import { describe, expect, it } from "vitest";
import {
  INVITE_TEXT_MAX,
  inviteTextProblem,
  matchGc,
  printedClockMinute,
  printedIn,
  siteFromNotes,
  suggestionFromExtraction,
  tradeFromText,
} from "./bid-invite-read";
import type { BidInviteExtraction } from "@prova/integrations/src/bidInvites";

/**
 * The code half of reading a pasted invitation. The model is not here at all:
 * each case hands `suggestionFromExtraction` what a model COULD return — a
 * faithful read, an invented field, a year it guessed — and asserts what
 * reaches the form. The fixtures are synthetic invitations in the shapes they
 * arrive in (a GC's ITB email, a BuildingConnected notice, a Dodge listing);
 * ground truth is only what each text prints.
 */

const ITB_EMAIL = `From: Sarah Kim <skim@acmebuilders.com>
Subject: Invitation to Bid - Riverside Medical Office Building

Acme Builders, Inc. is pleased to invite you to bid the Riverside Medical Office Building.

Project address: 4500 Brockton Ave, Riverside, CA 92501
Bid package: Drywall & Metal Framing (Div 09 21 16)
Bids due: Tuesday, November 4, 2026 by 2:00 PM PST
Pre-bid job walk: October 28, 2026 at 10:00 AM, meet at the site trailer. Not mandatory.
Bonding: 5% bid bond required. Performance and payment bonds for subcontracts over $250,000.
Plans and specs: https://app.buildingconnected.com/projects/abc123/files

Please confirm your intent to bid.`;

const faithful: BidInviteExtraction = {
  gcName: "Acme Builders, Inc.",
  projectName: "Riverside Medical Office Building",
  siteAddress: "4500 Brockton Ave",
  siteCity: "Riverside, CA 92501",
  tradeText: "Drywall & Metal Framing (Div 09 21 16)",
  bidDueText: "Tuesday, November 4, 2026",
  bidDueDate: "2026-11-04",
  bidDueTime: "2:00 PM PST",
  jobWalk: "October 28, 2026 at 10:00 AM, meet at the site trailer. Not mandatory.",
  bonding: "5% bid bond required.",
  planLink: "https://app.buildingconnected.com/projects/abc123/files",
  readingNotes: null,
};

const GCS = [
  { id: "acme", name: "Acme Builders" },
  { id: "baker", name: "Baker Construction Co." },
];

describe("a faithful read of a GC's ITB email", () => {
  const suggestion = suggestionFromExtraction(ITB_EMAIL, faithful, GCS);

  it("fills every form field the text prints", () => {
    expect(suggestion.contactId).toBe("acme");
    expect(suggestion.projectName).toBe("Riverside Medical Office Building");
    expect(suggestion.tradeScope).toBe("METAL_FRAMING_DRYWALL");
    expect(suggestion.dueDate).toBe("2026-11-04");
    // 2:00 PM, into the due-time column as wall-clock minutes.
    expect(suggestion.dueMinute).toBe(14 * 60);
  });

  it("puts what has no column into labelled notes parts on one line, the Site part first", () => {
    expect(suggestion.notes.split(" · ")).toEqual([
      "Site: 4500 Brockton Ave, Riverside, CA 92501",
      "Job walk: October 28, 2026 at 10:00 AM, meet at the site trailer. Not mandatory.",
      "Bonding: 5% bid bond required.",
      "Plans: https://app.buildingconnected.com/projects/abc123/files",
    ]);
    expect(siteFromNotes(suggestion.notes)).toBe("4500 Brockton Ave, Riverside, CA 92501");
  });

  it("has nothing to warn about on a clean read", () => {
    expect(suggestion.checks).toEqual([]);
    expect(suggestion.dropped).toEqual([]);
  });
});

describe("never invent a field the text doesn't contain", () => {
  it("drops a GC name, an address and a link the text does not print, and says which", () => {
    const suggestion = suggestionFromExtraction(
      ITB_EMAIL,
      {
        ...faithful,
        gcName: "Acme Builders Group", // composed, not copied
        siteAddress: "4500 Brockton Avenue", // expanded, not copied
        planLink: "https://plans.example.com/riverside", // from nowhere
      },
      GCS,
    );
    expect(suggestion.contactId).toBeNull();
    expect(suggestion.gcNamePrinted).toBeNull();
    expect(suggestion.dropped).toEqual(["GC", "address", "plan link"]);
    expect(suggestion.notes).not.toContain("Brockton Avenue");
    expect(suggestion.notes).not.toContain("plans.example.com");
    expect(suggestion.notes).toContain("Site: Riverside, CA 92501");
    expect(suggestion.checks).toContain(
      "Left out because the text doesn't say it word for word: GC, address, plan link. Check the invitation for them.",
    );
  });

  it("keeps a value that differs only in case and spacing — that is still the printed value", () => {
    const suggestion = suggestionFromExtraction(ITB_EMAIL, { ...faithful, projectName: "riverside  medical office building" }, GCS);
    expect(suggestion.projectName).toBe("riverside  medical office building");
    expect(suggestion.dropped).toEqual([]);
  });

  it("drops a 'plan link' that is printed but is not a web address", () => {
    const text = `${ITB_EMAIL}\nPlans available at our office.`;
    const suggestion = suggestionFromExtraction(text, { ...faithful, planLink: "available at our office" }, GCS);
    expect(suggestion.notes).not.toContain("Plans:");
    expect(suggestion.dropped).toEqual(["plan link"]);
  });

  it("treats a reply missing keys exactly like nulls, and asks the person for the rest", () => {
    const suggestion = suggestionFromExtraction(ITB_EMAIL, {}, GCS);
    expect(suggestion).toMatchObject({ contactId: null, projectName: "", tradeScope: null, dueDate: null, notes: "" });
    expect(suggestion.checks).toEqual([
      "No GC was found in the text. Pick the GC who invited you.",
      "No project name was found in the text. Type it in.",
    ]);
  });
});

describe("the due date", () => {
  it("is dropped when the model supplied a year the text does not print", () => {
    const text = ITB_EMAIL.replace("Tuesday, November 4, 2026", "Tuesday, November 4");
    const suggestion = suggestionFromExtraction(text, { ...faithful, bidDueText: "Tuesday, November 4" }, GCS);
    expect(suggestion.dueDate).toBeNull();
    expect(suggestion.checks).toContain(
      'The due date is printed as "Tuesday, November 4", which doesn\'t give a full date. Set it yourself.',
    );
  });

  it("is kept from a numeric date with a two-digit year, and not from a bare day that happens to equal the year", () => {
    const numeric = `${ITB_EMAIL}\nDue 11/04/26`;
    expect(suggestionFromExtraction(numeric, { ...faithful, bidDueText: "11/04/26" }, GCS).dueDate).toBe("2026-11-04");
    const dayOnly = `${ITB_EMAIL}\nDue November 26`;
    expect(
      suggestionFromExtraction(dayOnly, { ...faithful, bidDueText: "November 26", bidDueDate: "2026-11-26" }, GCS).dueDate,
    ).toBeNull();
  });

  it("is dropped when it is not a real calendar day, or its printed form is not in the text", () => {
    expect(suggestionFromExtraction(ITB_EMAIL, { ...faithful, bidDueDate: "2026-02-30" }, GCS).dueDate).toBeNull();
    expect(
      suggestionFromExtraction(ITB_EMAIL, { ...faithful, bidDueText: "December 1, 2026", bidDueDate: "2026-12-01" }, GCS).dueDate,
    ).toBeNull();
  });
});

describe("the GC is matched by name, exactly, or not at all", () => {
  it("ignores case, punctuation and the legal suffix", () => {
    expect(matchGc("ACME BUILDERS, INC.", GCS)?.id).toBe("acme");
    expect(matchGc("Baker Construction", GCS)?.id).toBe("baker");
  });

  it("does not match a longer or different name — no fuzzy guess at who invited you", () => {
    expect(matchGc("Acme Builders West", GCS)).toBeNull();
    expect(matchGc("Acme", GCS)).toBeNull();
  });

  it("does not fill the GC picker with a contact whose name merely starts the same", () => {
    const text = ITB_EMAIL.replaceAll("Acme Builders, Inc.", "Acme Builders West");
    const suggestion = suggestionFromExtraction(text, { ...faithful, gcName: "Acme Builders West" }, GCS);
    expect(suggestion.contactId).toBeNull();
    expect(suggestion.gcNamePrinted).toBe("Acme Builders West");
  });

  it("picks nobody when two contacts normalise to the same name", () => {
    expect(matchGc("Acme Builders", [...GCS, { id: "acme-2", name: "Acme Builders LLC" }])).toBeNull();
  });

  it("names a printed GC who is not in the contacts, so the person can add them", () => {
    const text = ITB_EMAIL.replaceAll("Acme Builders, Inc.", "Cal Pacific Construction");
    const suggestion = suggestionFromExtraction(text, { ...faithful, gcName: "Cal Pacific Construction" }, GCS);
    expect(suggestion.contactId).toBeNull();
    expect(suggestion.gcNamePrinted).toBe("Cal Pacific Construction");
    expect(suggestion.checks[0]).toBe(
      `The invitation is from "Cal Pacific Construction", who isn't in your contacts under that name. Pick the GC, or add them first.`,
    );
  });
});

describe("the trade is mapped by code, to one trade or none", () => {
  it("maps each trade's own words", () => {
    expect(tradeFromText("Drywall & Metal Framing")).toBe("METAL_FRAMING_DRYWALL");
    expect(tradeFromText("Div 09 21 16 Gypsum Board Assemblies")).toBe("METAL_FRAMING_DRYWALL");
    expect(tradeFromText("Lath and Plaster")).toBe("LATH_PLASTER");
    expect(tradeFromText("EIFS")).toBe("EIFS");
    expect(tradeFromText("Acoustical Ceilings")).toBe("ACOUSTICAL_CEILINGS");
    expect(tradeFromText("Spray-applied fireproofing (SFRM)")).toBe("FIREPROOFING");
  });

  it("is null for words naming none of the trades, or more than one", () => {
    expect(tradeFromText("Painting")).toBeNull();
    expect(tradeFromText("Drywall and Acoustical Ceilings")).toBeNull();
    expect(tradeFromText(null)).toBeNull();
  });

  it("keeps an unmapped trade's printed words in the notes and asks the person", () => {
    const text = ITB_EMAIL.replace("Drywall & Metal Framing (Div 09 21 16)", "Interior finishes");
    const suggestion = suggestionFromExtraction(text, { ...faithful, tradeText: "Interior finishes" }, GCS);
    expect(suggestion.tradeScope).toBeNull();
    expect(suggestion.notes).toContain("Trade as printed: Interior finishes");
    expect(suggestion.checks).toContain(
      `The trade is printed as "Interior finishes", which doesn't name one of your trades clearly. Pick it yourself.`,
    );
  });
});

describe("a Dodge listing of several bidding GCs", () => {
  const DODGE = `Dodge Report #202611-0044
Riverside Unified School District - Arlington HS Modernization
Location: 2951 Jackson St, Riverside, CA 92503
Bid Date: 11/18/2026 2:00 PM
Bidders: Acme Builders; Cal Pacific Construction; Dune GC`;

  it("leaves the GC empty and passes the model's warning through to the person", () => {
    const suggestion = suggestionFromExtraction(
      DODGE,
      {
        gcName: "",
        projectName: "Riverside Unified School District - Arlington HS Modernization",
        siteAddress: "2951 Jackson St",
        siteCity: "Riverside, CA 92503",
        tradeText: null,
        bidDueText: "11/18/2026",
        bidDueDate: "2026-11-18",
        bidDueTime: "2:00 PM",
        jobWalk: null,
        bonding: null,
        planLink: null,
        readingNotes: "Three GCs are listed as bidders; pick the one who invited you.",
      },
      GCS,
    );
    expect(suggestion.contactId).toBeNull();
    expect(suggestion.dueDate).toBe("2026-11-18");
    expect(suggestion.checks).toEqual([
      "No GC was found in the text. Pick the GC who invited you.",
      "Three GCs are listed as bidders; pick the one who invited you.",
    ]);
  });
});

describe("the paste itself", () => {
  it("refuses empty, too short and too long, in sentences", () => {
    expect(inviteTextProblem("   ")).toBe("Paste the invitation text first.");
    expect(inviteTextProblem("Bid due Friday")).toBe("That's too short to be an invitation. Paste the whole email or listing.");
    expect(inviteTextProblem("x".repeat(INVITE_TEXT_MAX + 1))).toMatch(/^That's 20,001 characters/);
    expect(inviteTextProblem(ITB_EMAIL)).toBeNull();
  });

  it("checks presence by words, not by an empty needle", () => {
    expect(printedIn(ITB_EMAIL, "   ")).toBe(false);
    expect(printedIn("Acme’s job — Phase 1", "acme's job - phase 1")).toBe(true);
  });

  it("reads the Site line back out of notes whatever its position, and nothing from notes without one", () => {
    expect(siteFromNotes("Job walk: Monday\nsite: 1 Main St, Corona")).toBe("1 Main St, Corona");
    expect(siteFromNotes("Bonding: none · Site: 1 Main St, Corona · Plans: https://x.test/p")).toBe("1 Main St, Corona");
    expect(siteFromNotes("Called Sarah about the date")).toBeNull();
    expect(siteFromNotes(null)).toBeNull();
  });
});

describe("the due time goes into its column only when it is a clear clock time", () => {
  it("reads the printed shapes an invitation uses", () => {
    expect(printedClockMinute("2:00 PM PST")).toBe(14 * 60);
    expect(printedClockMinute("2 pm")).toBe(14 * 60);
    expect(printedClockMinute("10:30a.m.")).toBe(10 * 60 + 30);
    expect(printedClockMinute("12:00 PM")).toBe(12 * 60);
    expect(printedClockMinute("12:15 AM")).toBe(15);
    expect(printedClockMinute("14:00")).toBe(14 * 60);
  });

  it("is null for anything it would have to guess at", () => {
    expect(printedClockMinute("2")).toBeNull();
    expect(printedClockMinute("noon")).toBeNull();
    expect(printedClockMinute("13:00 PM")).toBeNull();
    expect(printedClockMinute("25:00")).toBeNull();
    expect(printedClockMinute("2 pmt")).toBeNull();
    expect(printedClockMinute(null)).toBeNull();
  });

  it("keeps an unclear time in the notes and asks, and sets no time without a day", () => {
    const text = ITB_EMAIL.replace("2:00 PM PST", "close of business");
    const unclear = suggestionFromExtraction(text, { ...faithful, bidDueTime: "close of business" }, GCS);
    expect(unclear.dueMinute).toBeNull();
    expect(unclear.notes).toContain("Bid due time: close of business");
    expect(unclear.checks).toContain(
      'The due time is printed as "close of business", which isn\'t a clear clock time. Set it yourself.',
    );
    const noYear = ITB_EMAIL.replace("Tuesday, November 4, 2026", "Tuesday, November 4");
    const undated = suggestionFromExtraction(noYear, { ...faithful, bidDueText: "Tuesday, November 4" }, GCS);
    expect(undated.dueDate).toBeNull();
    expect(undated.dueMinute).toBeNull();
  });
});
