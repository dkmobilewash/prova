import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { parseSubListing } from "@/lib/sub-listing/parse";
import { qualify } from "@/lib/sales-qualification";

/**
 * THE IMPORTER, EXECUTED RATHER THAN READ.
 *
 * `lib/sub-listing/proposedOnlyCensus.test.ts` reads the write site and asserts
 * it never mentions CONFIRMED or stamps a reviewer. That is a real guard and it
 * catches the refactor — but it is a guard on the TEXT of the function, and an
 * adversarial review of this feature correctly marked the whole of the action's
 * behaviour as "read from code, not executed". Tenant scoping, the in-import
 * dedupe, the staleness refusal and the PROPOSED-only promise were all argued
 * rather than demonstrated.
 *
 * This demonstrates them. The assertions that matter are the ones a source
 * census structurally cannot make:
 *
 *   - rows land `PROPOSED` with `reviewedAt` and `reviewedByUserId` NULL, and
 *     `qualify` therefore still reads THIN on a lead the importer just filled —
 *     the band must not move until a person confirms, or it measures how much
 *     reading happened rather than what anybody knows;
 *   - attaching to another company's lead is refused, by a re-read INSIDE the
 *     transaction rather than by the candidate list the screen was rendered
 *     from;
 *   - the same subcontractor on two rows of one listing becomes ONE lead. A
 *     §4104 listing names a sub once per PORTION OF WORK, so a sub doing framing
 *     and plaster appears twice on one page, and `leadCandidatesFor` only ever
 *     sees leads that existed BEFORE the import;
 *   - and the other direction, which cost more: two DIFFERENT companies on one
 *     listing stay two leads. The dedupe ran on a normalised name, which strips
 *     entity suffixes, so an Inc. and an LLC trading under one name collapsed
 *     into one lead holding both companies' claims — the second describe block
 *     at the bottom of this file is one case per rung of the rule that replaced
 *     it;
 *   - a selection the server's own parse does not contain is refused whole,
 *     not reconciled.
 *
 * Line numbers are derived by parsing the fixture here rather than counted by
 * hand, so a fixture edit cannot silently point the assertions at other rows.
 */

/**
 * `isProvaOperator` is part of the mock ON PURPOSE and was missing at first:
 * `assertSalesAccess` reads it off the CONTEXT, not off the row, so six tests
 * failed with "Not found" while the company in the database had the flag set.
 * The guard was working; the harness was lying to it.
 */
const context = {
  company: { id: "", isProvaOperator: true },
  id: "",
  role: "OWNER" as string,
};
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { importSubListing } = await import("./sales");

let otherCompanyLeadId = "";
let existingLeadId = "";

/** One prime, three subs, two of them the same company on two scopes. */
const LISTING = [
  "Project: Lincoln Elementary Modernization",
  "Agency: Riverside Unified School District",
  "Prime Contractor: Swinerton Builders",
  "",
  "Valley Interior Systems\tFontana, CA\tC-9 884201\t1000012345\tMetal stud framing and drywall",
  "Valley Interior Systems, Inc.\tFontana, CA\tC-9 884201\t1000012345\tLath and cement plaster",
  "Summit Acoustics LLC\tRiverside, CA\tC-2 650118\t1000044444\tAcoustical ceilings",
].join("\n");

const parsedListing = parseSubListing(LISTING);
const lineOf = (name: string) => parsedListing.rows.find((row) => row.name.startsWith(name))!.line;

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const base = (over: Record<string, string> = {}) =>
  form({
    listingText: LISTING,
    sourceUrl: "https://example.test/riverside/lincoln-award-packet.pdf",
    sourceTitle: "Riverside USD — Lincoln Elementary award packet",
    primeOutcome: "UNKNOWN",
    lines: parsedListing.rows.map((row) => row.line).join(","),
    ...over,
  });

beforeAll(async () => {
  const company = await prisma.company.create({
    // The sales CRM is operator-only; `assertSalesAccess` refuses otherwise.
    data: { name: "Prova Operator Co", isProvaOperator: true },
  });
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `sl_${stamp}`,
      email: `sl_${stamp}@example.test`,
      role: "OWNER",
    },
  });
  context.company.id = company.id;
  context.id = user.id;

  const existing = await prisma.salesLead.create({
    data: { companyId: company.id, companyName: "Summit Acoustics LLC" },
  });
  existingLeadId = existing.id;

  // A lead belonging to somebody else entirely, for the scoping test.
  const other = await prisma.company.create({ data: { name: "Someone Else Ltd" } });
  const otherLead = await prisma.salesLead.create({
    data: { companyId: other.id, companyName: "Valley Interior Systems" },
  });
  otherCompanyLeadId = otherLead.id;
});

afterAll(async () => {
  // Signals are RESTRICT on both lead and company, so they go first.
  await prisma.salesLeadSignal.deleteMany({ where: { lead: { companyId: context.company.id } } });
  await prisma.salesLead.deleteMany({ where: { companyId: context.company.id } });
  await prisma.user.deleteMany({ where: { companyId: context.company.id } });
  const otherLead = await prisma.salesLead.findUnique({ where: { id: otherCompanyLeadId } });
  if (otherLead) {
    await prisma.salesLeadSignal.deleteMany({ where: { leadId: otherLead.id } });
    await prisma.salesLead.delete({ where: { id: otherLead.id } });
    await prisma.company.delete({ where: { id: otherLead.companyId } });
  }
  await prisma.company.deleteMany({ where: { id: context.company.id } });
});

describe("importing a pasted subcontractor listing", () => {
  it("refuses without a source link, and says why", async () => {
    const result = await importSubListing(base({ sourceUrl: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/needs the page you read it on/);
    expect(await prisma.salesLead.count({ where: { companyId: context.company.id } })).toBe(1);
  });

  it("refuses a link that is not a full web address", async () => {
    const result = await importSubListing(base({ sourceUrl: "not-a-url" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/full web address/);
  });

  it("refuses a selection its own parse does not contain, rather than reconciling", async () => {
    const result = await importSubListing(base({ lines: "1,2,999" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not read the same way/);
    expect(await prisma.salesLeadSignal.count({ where: { companyId: context.company.id } })).toBe(0);
  });

  it("refuses to attach to another company's lead, re-read inside the transaction", async () => {
    const result = await importSubListing(
      base({
        lines: String(lineOf("Valley Interior Systems")),
        [`attach:${lineOf("Valley Interior Systems")}`]: otherCompanyLeadId,
      }),
    );
    expect(result.ok).toBe(false);
    // And nothing partial was written — the throw aborted the transaction.
    expect(await prisma.salesLeadSignal.count({ where: { companyId: context.company.id } })).toBe(0);
    expect(
      await prisma.salesLeadSignal.count({ where: { leadId: otherCompanyLeadId } }),
    ).toBe(0);
  });

  it("imports the listing: one lead per company, attached where asked", async () => {
    const summitLine = lineOf("Summit Acoustics");
    const result = await importSubListing(base({ [`attach:${summitLine}`]: existingLeadId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Valley appears on TWO rows (framing and plaster) and must be ONE lead.
    expect(result.value.leadsCreated).toBe(1);
    expect(result.value.leadsAttached).toBe(1);
    expect(result.value.signalsProposed).toBeGreaterThan(0);

    const leads = await prisma.salesLead.findMany({
      where: { companyId: context.company.id },
      include: { signals: true },
    });
    expect(leads).toHaveLength(2);

    const valley = leads.find((lead) => lead.companyName.startsWith("Valley"))!;
    const summit = leads.find((lead) => lead.id === existingLeadId)!;
    expect(valley).toBeTruthy();
    expect(summit.signals.length).toBeGreaterThan(0);

    // Both of Valley's rows landed on the one lead.
    const valleyLines = new Set(
      valley.signals.map((signal) => /line (\d+)/.exec(signal.claim)?.[1]).filter(Boolean),
    );
    expect(valleyLines.size).toBe(2);
  });

  it("lands every signal PROPOSED with no reviewer, so no band can move", async () => {
    const signals = await prisma.salesLeadSignal.findMany({
      where: { companyId: context.company.id },
    });
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal.state, signal.claim).toBe("PROPOSED");
      expect(signal.reviewedAt, signal.claim).toBeNull();
      expect(signal.reviewedByUserId, signal.claim).toBeNull();
      expect(signal.sourceUrl).toBe("https://example.test/riverside/lincoln-award-packet.pdf");
    }

    // The band itself, computed the way both screens compute it.
    const leads = await prisma.salesLead.findMany({
      where: { companyId: context.company.id },
      include: { signals: true },
    });
    for (const lead of leads) {
      const band = qualify(
        lead.signals.map((signal) => ({
          kind: signal.kind,
          state: signal.state,
          claim: signal.claim,
          disqualifies: signal.disqualifies,
        })),
      );
      expect(band.band, `${lead.companyName} must still be thin`).toBe("THIN");
      expect(band.awaitingReview).toBe(lead.signals.length);
    }
  });

  it("names no prime in any claim when the document names several", async () => {
    const multi = [
      "Project: Two Bidders High School",
      "Prime Contractor: Swinerton Builders",
      "Acme Drywall Inc\tFontana, CA\t884202\tDrywall",
      "Prime Contractor: Bernards Bros Inc",
      "Baker Plastering Co\tRialto, CA\t884203\tLath and plaster",
    ].join("\n");
    const parsedMulti = parseSubListing(multi);
    expect(parsedMulti.header.prime).toBeNull();
    expect(parsedMulti.problems).toHaveLength(1);

    const result = await importSubListing(
      form({
        listingText: multi,
        sourceUrl: "https://example.test/two-bidders.pdf",
        primeOutcome: "AWARDED",
        lines: parsedMulti.rows.map((row) => row.line).join(","),
      }),
    );
    expect(result.ok).toBe(true);

    const claims = (
      await prisma.salesLeadSignal.findMany({
        where: { companyId: context.company.id, lead: { companyName: { contains: "Acme" } } },
      })
    ).map((signal) => signal.claim);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim, "a prime must not be named at all here").not.toMatch(/Swinerton|Bernards/);
      // Even with AWARDED ticked, "Works under" needs a prime to name.
      expect(claim).not.toMatch(/Works under/);
    }
  });

  it("skips a row carrying no checkable fact rather than making an empty lead", async () => {
    const bare = "Nothing Co\t\t\t";
    const parsedBare = parseSubListing(bare);
    if (parsedBare.rows.length === 0) {
      // The parser did not even read it as a row, which is also correct.
      expect(parsedBare.unread.length + parsedBare.ignored.length).toBeGreaterThan(0);
      return;
    }
    const before = await prisma.salesLead.count({ where: { companyId: context.company.id } });
    const result = await importSubListing(
      form({
        listingText: bare,
        sourceUrl: "https://example.test/bare.pdf",
        primeOutcome: "UNKNOWN",
        lines: parsedBare.rows.map((row) => row.line).join(","),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rowsSkipped).toBeGreaterThan(0);
    expect(await prisma.salesLead.count({ where: { companyId: context.company.id } })).toBe(before);
  });
});

/**
 * WHICH TWO ROWS ARE ONE COMPANY, EXECUTED RATHER THAN ARGUED.
 *
 * The dedupe above ran on `normaliseCompanyName` alone, which strips entity
 * suffixes — so "Valley Interiors, Inc." and "Valley Interiors, LLC" both
 * reduced to "valley interiors" and became ONE `SalesLead` carrying both
 * companies' claims. An Inc. and an LLC trading under one name are two legal
 * companies, and the only thing the screen said about it was that `leadsCreated`
 * read one lower than the number of rows that were ticked.
 *
 * Each case below is one rung of the rule in `alreadyImported`, and each uses
 * its OWN listing so the count it asserts is the count that listing produced
 * rather than a running total. Lines are derived from the parse, never counted
 * by hand.
 */
function importListing(lines: string[], sourceUrl: string) {
  const listingText = lines.join("\n");
  const parsed = parseSubListing(listingText);
  // A fixture whose rows the parser does not read would make every assertion
  // below pass on nothing, which is the shape this whole file exists to refuse.
  expect(parsed.rows.length, "the fixture parsed to no rows").toBeGreaterThan(1);
  expect(parsed.unread, "the fixture has lines the parser could not read").toHaveLength(0);
  return importSubListing(
    form({
      listingText,
      sourceUrl,
      primeOutcome: "UNKNOWN",
      lines: parsed.rows.map((row) => row.line).join(","),
    }),
  );
}

/** The leads this listing's companies produced, with their signals. */
async function leadsNamed(prefix: string) {
  return prisma.salesLead.findMany({
    where: { companyId: context.company.id, companyName: { startsWith: prefix } },
    include: { signals: true },
    orderBy: { companyName: "asc" },
  });
}

describe("two rows are one company only when the document says so twice over", () => {
  it("keeps an Inc. and an LLC with one trading name as two leads", async () => {
    const result = await importListing(
      [
        "Project: Hemet High School Modernization",
        "Agency: Hemet Unified School District",
        "Prime Contractor: Bernards Bros Inc",
        "",
        "Valley Interiors, Inc.\tRialto, CA\tC-9 884300\t1000012399\tMetal stud framing and drywall",
        "Valley Interiors, LLC\tRialto, CA\tC-9 990011\t1000012400\tLath and cement plaster",
      ],
      "https://example.test/hemet/award-packet.pdf",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leadsCreated).toBe(2);

    const leads = await leadsNamed("Valley Interiors");
    expect(leads.map((lead) => lead.companyName)).toEqual([
      "Valley Interiors, Inc.",
      "Valley Interiors, LLC",
    ]);
    // And each company's claims are on its own lead, not pooled on one of them.
    for (const lead of leads) expect(lead.signals.length).toBeGreaterThan(0);
  });

  it("treats the same spelling twice as one listing entry, with no licence to corroborate it", async () => {
    const result = await importListing(
      [
        "Project: Perris Middle School Reroof",
        "Agency: Perris Union High School District",
        "Prime Contractor: Tilden-Coil Constructors",
        "",
        // The §4104 case: one company, once per portion of work. No licence
        // column at all, so an identical spelling is the only evidence there is.
        "Baker Drywall Co\tOntario, CA\tMetal stud framing and drywall",
        "Baker Drywall Co\tOntario, CA\tLath and cement plaster",
        // And the company the old normaliser could not tell from it.
        "Baker Drywall Corp\tOntario, CA\tAcoustical ceilings",
      ],
      "https://example.test/perris/award-packet.pdf",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leadsCreated).toBe(2);

    const leads = await leadsNamed("Baker Drywall");
    expect(leads.map((lead) => lead.companyName)).toEqual([
      "Baker Drywall Co",
      "Baker Drywall Corp",
    ]);
    const twoScopes = leads[0];
    const lines = new Set(
      twoScopes.signals.map((signal) => /line (\d+)/.exec(signal.claim)?.[1]).filter(Boolean),
    );
    expect(lines.size, "both of this company's rows must be on the one lead").toBe(2);
  });

  it("reads one licence number printed under two classifications as one contractor", async () => {
    const result = await importListing(
      [
        "Project: Yucaipa High School Gymnasium",
        "Agency: Yucaipa-Calimesa Joint Unified School District",
        "Prime Contractor: Swinerton Builders",
        "",
        // A contractor holds ONE licence number under several classifications,
        // so these two strings differ and the number does not.
        "Northstate Drywall\tOntario, CA\tC-9 775500\tMetal stud framing and drywall",
        "Northstate Drywall, Inc.\tOntario, CA\tC-35 775500\tLath and cement plaster",
      ],
      "https://example.test/yucaipa/award-packet.pdf",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leadsCreated).toBe(1);

    const leads = await leadsNamed("Northstate");
    expect(leads).toHaveLength(1);
    const lines = new Set(
      leads[0].signals.map((signal) => /line (\d+)/.exec(signal.claim)?.[1]).filter(Boolean),
    );
    expect(lines.size).toBe(2);
  });

  it("will not merge rows the document gives different licence numbers, identical spelling and all", async () => {
    const result = await importListing(
      [
        "Project: Banning Elementary Addition",
        "Agency: Banning Unified School District",
        "Prime Contractor: Erickson-Hall Construction",
        "",
        // The one case where a contradiction outranks an identical spelling: the
        // document has already said these are two registrants.
        "Acme Lath Systems\tFontana, CA\tC-9 884201\tMetal stud framing and drywall",
        "Acme Lath Systems\tRialto, CA\tC-9 990099\tLath and cement plaster",
      ],
      "https://example.test/banning/award-packet.pdf",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leadsCreated).toBe(2);
    expect(await leadsNamed("Acme Lath")).toHaveLength(2);
  });

  /**
   * THE RULE HAD TO BE THE SAME RULE WHICHEVER WAY UP THE PAGE IS, AND IT WAS
   * NOT. Found by review 2026-10-05, measured in both orders.
   *
   * A blank-licence row was a BRIDGE between two rows the document says are
   * different registrants. `importedHere` recorded what the row that MADE the
   * entry printed, and a row merging into that entry taught it nothing — so a
   * blank entry stayed blank, every later row compared against a blank, nobody
   * contradicted anybody, and three rows welded into one lead. Put the blank row
   * second and you got two leads from the same three rows.
   *
   * Both orders are asserted, which is the only form of this test that can fail
   * for the right reason: with the arms separate, the one that was already
   * passing would have looked like coverage.
   */
  it.each([
    ["licence first", ["C-9 886001", "", "C-35 886002"], "Bridgefirst Drywall"],
    ["blank first", ["", "C-9 886011", "C-35 886012"], "Bridgeblank Drywall"],
  ])("gives the same answer with the blank-licence row %s", async (_order, licences, name) => {
    const scopes = [
      "Metal stud framing and drywall",
      "Lath and cement plaster",
      "Acoustical ceilings",
    ];
    const result = await importListing(
      [
        `Project: Beaumont Corporation Yard (${name})`,
        "Agency: City of Beaumont",
        "Prime Contractor: Erickson-Hall Construction",
        "",
        ...licences.map((licence, index) =>
          [name, "Fontana, CA", licence, scopes[index]].filter(Boolean).join("\t"),
        ),
      ],
      `https://example.test/bridge/${name.replace(/\s+/g, "-").toLowerCase()}.pdf`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    /* Two leads, not three and not one. The two LICENSED rows contradict each
       other, so they are two registrants; the blank row belongs with whichever
       it shares a page position with and must not drag the other in. */
    expect(result.value.leadsCreated).toBe(2);
    expect(await leadsNamed(name)).toHaveLength(2);
  });

  it("still lands everything these imports wrote PROPOSED, with no reviewer", async () => {
    // The promise above is about WHICH lead a row joins. It must not have bought
    // that by writing anything the band can read.
    const signals = await prisma.salesLeadSignal.findMany({
      where: {
        companyId: context.company.id,
        sourceUrl: { in: [
          "https://example.test/hemet/award-packet.pdf",
          "https://example.test/perris/award-packet.pdf",
          "https://example.test/yucaipa/award-packet.pdf",
          "https://example.test/banning/award-packet.pdf",
        ] },
      },
    });
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal.state, signal.claim).toBe("PROPOSED");
      expect(signal.reviewedAt, signal.claim).toBeNull();
      expect(signal.reviewedByUserId, signal.claim).toBeNull();
    }
  });
});

/**
 * THE COLUMNS THE LISTING FILLS, AND THE ONE IT MUST NEVER OVERWRITE.
 *
 * `SalesLead` grew five columns off the reader — a licence number, a DIR
 * registration, a city, the prime that listed them, the project it was listed
 * on. Until they existed every one of those survived import only as prose inside
 * a claim, which is a true sentence and an unjoinable one: California's CSLB
 * licence file is public and carries a telephone number for very nearly every
 * registrant, and a number inside "Listed with licence C-9 884201 (line 6 of the
 * listing)" cannot be joined to anything.
 *
 * Two of these assertions are the whole point and neither is checkable by
 * reading the function:
 *
 *   - the licence lands as DIGITS while the CLAIM keeps what the document
 *     printed. A contractor holds one number under several classifications, so
 *     the key and the quotation are deliberately different strings;
 *   - a row that joins a lead which already existed FILLS BLANKS AND NEVER
 *     OVERWRITES. A second import must not be able to move another company's
 *     licence onto a lead somebody attached by hand — that is the one
 *     confident-wrong-answer failure the review screen exists to prevent, and it
 *     would look like perfectly well-formed data.
 */
describe("the public-register columns a listing fills", () => {
  const YUCAIPA = [
    "Project: Yucaipa High School Gymnasium",
    "Agency: Yucaipa-Calimesa Joint Unified School District",
    "Prime Contractor: Swinerton Builders",
    "",
    // One contractor, two classifications of one licence, two portions of work.
    "Northstate Interiors\tOntario, CA\tC-9 775501\t1000012346\tMetal stud framing and drywall",
    "Northstate Interiors, Inc.\tOntario, CA\tC-35 775501\t1000012346\tLath and cement plaster",
  ];
  const YUCAIPA_URL = "https://example.test/yucaipa/registry-columns.pdf";

  it("stores the licence, registration, city, GC and project as fields", async () => {
    const result = await importListing(YUCAIPA, YUCAIPA_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leadsCreated).toBe(1);

    const [lead] = await leadsNamed("Northstate Interiors");
    expect(lead).toBeTruthy();
    expect(lead.city).toBe("Ontario, CA");
    expect(lead.registrationNumber).toBe("1000012346");
    expect(lead.listedOnProject).toBe("Yucaipa High School Gymnasium");
    // The document named one prime, so every row of it is attributed to that one.
    expect(lead.listedByGc).toBe("Swinerton Builders");
  });

  /**
   * THE KEY IS THE DIGITS AND THE CLAIM IS THE DOCUMENT'S WORDS, and the pair of
   * assertions is the test rather than either one alone.
   *
   * Storing "C-9 775501" would be a field that never joins, and dropping the
   * class from the claim would be this app quoting a document as saying something
   * it did not. A mutation doing either — `licence: row.licence` on the write, or
   * normalising inside the claim — turns exactly one of these red.
   */
  it("stores the number without its classification while the claim keeps what was printed", async () => {
    const [lead] = await leadsNamed("Northstate Interiors");
    expect(lead.licenceNumber).toBe("775501");

    const signals = await prisma.salesLeadSignal.findMany({
      where: { leadId: lead.id, kind: "LICENCE" },
    });
    expect(signals.length).toBeGreaterThan(0);
    const claims = signals.map((signal) => signal.claim).join("\n");
    // Both classifications, verbatim, because that is what the page said.
    expect(claims).toContain("C-9 775501");
    expect(claims).toContain("C-35 775501");
  });

  /**
   * A PAGE WITH SEVERAL BIDDERS ATTRIBUTES PER ROW OR NOT AT ALL.
   *
   * `header.prime` is null here BY DESIGN — five primes on one project name five
   * drywall subs and only one of them is about to get the work, so the document
   * level refuses to name one. The row level still can, because each listing sits
   * under its own bidder. This is the distinguishing case for the fallback:
   * reading only `header.prime` leaves both of these null, and reading only
   * `row.listedBy` leaves the single-prime listing above null. Both must work.
   */
  it("attributes each row to the bidder whose listing it sat under", async () => {
    const PAGE = `   Example University Capital Programs
   BID SUMMARY SHEET WITH SUBCONTRACTORS
   Contract: Example Hall Mailroom Conversion

   Alpha Example Builders Inc
                                        No.1 - $ 1,149,540.00 **
   Total Bid                            $1,149,540.00
   Sub Contractor Listing               Portion of Work:        Name of Business:           Location:     DIR #:
                                        Metal Stud Framing      Zenith Wallworks Inc        Fairview      1000447788

   Bravo Example Construction Co.,
   Inc.                                 No.2 - $ 1,292,276.00 **
   Total Bid                            $1,292,276.00
                                        Portion of Work:        Name of Business:           Location:     DIR #:
                                        Lath and Plaster        Zenith Lathing Co           Fort Hollow   1000330044`;
    const parsed = parseSubListing(PAGE);
    // The premise of the test, asserted rather than assumed: no single prime.
    expect(parsed.header.prime).toBeNull();
    expect(parsed.rows).toHaveLength(2);

    const result = await importSubListing(
      form({
        listingText: PAGE,
        sourceUrl: "https://example.test/example-university/bid-summary.pdf",
        primeOutcome: "UNKNOWN",
        lines: parsed.rows.map((row) => row.line).join(","),
      }),
    );
    expect(result.ok).toBe(true);

    const leads = await leadsNamed("Zenith");
    expect(
      leads.map((lead) => [lead.companyName, lead.listedByGc]).sort(),
    ).toEqual([
      ["Zenith Lathing Co", "Bravo Example Construction Co., Inc."],
      ["Zenith Wallworks Inc", "Alpha Example Builders Inc"],
    ]);
  });

  /**
   * A WRAPPED PROJECT NAME IS MARKED, not stored as though it were the whole
   * name. `parse.ts` reads line by line, so a two-line project heading leaves
   * "… Modernization and" behind — and this column is rendered on the lead page,
   * where a fragment reads as a whole name to whoever is about to say it out
   * loud. signals.ts records that exact failure reaching a telephone; the words
   * arriving in a column instead of a claim does not make it less true.
   */
  it("marks a project name that ran past the end of its line", async () => {
    const result = await importListing(
      [
        "Project: Banning Elementary Addition and",
        "Agency: Banning Unified School District",
        "Prime Contractor: Erickson-Hall Construction",
        "",
        "Cutoff Drywall Systems\tBanning, CA\tC-9 775502\tMetal stud framing and drywall",
        "Cutoff Ceilings Inc\tBeaumont, CA\tC-2 775503\tAcoustical ceilings",
      ],
      "https://example.test/banning/wrapped-project.pdf",
    );
    expect(result.ok).toBe(true);

    const [lead] = await leadsNamed("Cutoff Drywall");
    expect(lead.listedOnProject).toBe("Banning Elementary Addition and…");
  });

  /**
   * FILL THE BLANKS, NEVER OVERWRITE — one listing, one lead that already exists,
   * and both halves asserted in one case because a mutation that breaks either
   * one passes the other.
   *
   * The lead below is deliberately HALF filled: it holds a licence number that
   * disagrees with the document, and no city. Overwriting would put the
   * listing's licence on a lead a person attached by hand, which is how a lookup
   * ends up finding somebody else's company. Refusing to fill the city would
   * waste the only thing the document adds.
   */
  it("fills what the lead did not know and leaves what it already held", async () => {
    const existing = await prisma.salesLead.create({
      data: {
        companyId: context.company.id,
        companyName: "Half Known Drywall",
        // A number somebody typed in. It disagrees with the listing on purpose.
        licenceNumber: "111222",
      },
    });

    const listingText = [
      "Project: Moreno Valley Aquatics Center",
      "Agency: Moreno Valley Unified School District",
      "Prime Contractor: Tilden-Coil Constructors",
      "",
      "Half Known Drywall\tPerris, CA\tC-9 775504\t1000012347\tMetal stud framing and drywall",
    ].join("\n");
    const parsed = parseSubListing(listingText);
    expect(parsed.rows).toHaveLength(1);
    const line = parsed.rows[0].line;

    const result = await importSubListing(
      form({
        listingText,
        sourceUrl: "https://example.test/moreno-valley/attach.pdf",
        primeOutcome: "UNKNOWN",
        lines: String(line),
        [`attach:${line}`]: existing.id,
      }),
    );
    expect(result.ok).toBe(true);

    const after = await prisma.salesLead.findUnique({ where: { id: existing.id } });
    // Held: the licence somebody already put there. A contradiction stays
    // visible — the row's own LICENCE signal still carries 775504, with its
    // source and line, in front of the person who has to decide.
    expect(after?.licenceNumber).toBe("111222");
    // Filled: everything it did not know.
    expect(after?.city).toBe("Perris, CA");
    expect(after?.registrationNumber).toBe("1000012347");
    expect(after?.listedByGc).toBe("Tilden-Coil Constructors");
    expect(after?.listedOnProject).toBe("Moreno Valley Aquatics Center");

    const licenceClaims = await prisma.salesLeadSignal.findMany({
      where: { leadId: existing.id, kind: "LICENCE" },
    });
    expect(licenceClaims.map((signal) => signal.claim).join("\n")).toContain("775504");
  });

  /**
   * A lead typed in by hand gets none of these, and that is the common case
   * rather than an edge: null means "no document said" everywhere in this file.
   */
  it("leaves every column null on a lead no listing produced", async () => {
    const typed = await prisma.salesLead.create({
      data: { companyId: context.company.id, companyName: "Nobody Listed Us Ltd" },
    });
    const lead = await prisma.salesLead.findUnique({ where: { id: typed.id } });
    expect([
      lead?.licenceNumber,
      lead?.registrationNumber,
      lead?.city,
      lead?.listedByGc,
      lead?.listedOnProject,
    ]).toEqual([null, null, null, null, null]);
  });
});

/**
 * THE SAME FIRM ARRIVING IN A SECOND IMPORT — THE CASE THE AUTOMATED CHANNEL IS
 * ENTIRELY MADE OF, AND THE ONE NOTHING WAS HANDLING.
 *
 * Everything above is about ONE paste. The premise of reading public listings is
 * that MANY of them get read over time and the same drywall firm is on a lot of
 * them, for different GCs and different jobs. Measured before anything was
 * built, on this same scratch database: three imports naming one licence —
 * "Probe Drywall, Inc.", "PROBE DRYWALL INC" and a third spelling — produced
 * THREE `SalesLead` rows, every one stamped `licenceNumber: "884201"`, every one
 * holding five PROPOSED signals and therefore permanently undeletable, with the
 * `(companyId, licenceNumber)` index sitting there unread.
 *
 * The rule that fixed it is deliberately NARROWER than the in-pass one, and the
 * cases below are one per edge of that narrowness rather than one happy path:
 *
 *   - a licence plus a corroborating name MERGES, across any number of imports;
 *   - a licence whose name does NOT corroborate does not, because a stored
 *     licence can have been typed by a person and a merge cannot be undone;
 *   - a name alone never does, which is `leadMatch.ts`'s rule unchanged;
 *   - an identical SPELLING alone never does either, and that is the one rung of
 *     the in-pass rule that deliberately does not travel between documents;
 *   - a contradicting registration outranks the licence;
 *   - and none of it crosses a company boundary.
 */
describe("the same subcontractor arriving in a second import", () => {
  /** A one-row listing for one firm, so each case's count is its own. */
  function oneFirm(
    project: string,
    prime: string,
    row: string,
  ): { listingText: string; line: number } {
    const listingText = [`Project: ${project}`, `Prime Contractor: ${prime}`, "", row].join("\n");
    const parsed = parseSubListing(listingText);
    // Without this the assertions below would pass on nothing, which is the
    // shape this whole file exists to refuse.
    expect(parsed.rows, `the fixture for ${project} parsed to no single row`).toHaveLength(1);
    expect(parsed.unread, `the fixture for ${project} has unreadable lines`).toHaveLength(0);
    return { listingText, line: parsed.rows[0].line };
  }

  function importOneFirm(project: string, prime: string, row: string, sourceUrl: string) {
    const { listingText, line } = oneFirm(project, prime, row);
    return importSubListing(
      form({ listingText, sourceUrl, primeOutcome: "UNKNOWN", lines: String(line) }),
    );
  }

  it("lands a second document's row on the lead the first document made", async () => {
    const first = await importOneFirm(
      "Corona Ranch Elementary Modernization",
      "Swinerton Builders",
      "Crossimport Drywall, Inc.\tFontana, CA\tC-9 884501\t1000055501\tMetal stud framing and drywall",
      "https://example.test/crossimport/first.pdf",
    );
    expect(first.ok).toBe(true);
    // The premise of the case, asserted rather than assumed: there IS one lead
    // for the second import to find.
    if (first.ok) expect(first.value.leadsCreated).toBe(1);
    const [made] = await leadsNamed("Crossimport Drywall");
    expect(made).toBeTruthy();
    const signalsAfterFirst = await prisma.salesLeadSignal.count({ where: { leadId: made.id } });
    expect(signalsAfterFirst).toBeGreaterThan(0);

    // A different agency, a different prime, a different job, and the name in
    // the shouting case a clerk types it in. One licence number.
    const second = await importOneFirm(
      "Norco High School Stadium",
      "Bernards Bros Inc",
      "CROSSIMPORT DRYWALL INC\tFontana, CA\tC-35 884501\t1000055501\tLath and cement plaster",
      "https://example.test/crossimport/second.pdf",
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Nothing new was written, and the screen's own sentence — "…and 1 you
    // already had" — is told the truth about which.
    expect(second.value.leadsCreated).toBe(0);
    expect(second.value.leadsAttached).toBe(1);

    const leads = await prisma.salesLead.findMany({
      where: { companyId: context.company.id, licenceNumber: "884501" },
      include: { signals: true },
    });
    expect(leads).toHaveLength(1);
    expect(leads[0].id).toBe(made.id);
    // The second document's claims are ON the one lead, which is the whole
    // point: a prospect you know two things about rather than two you know one
    // thing about each.
    expect(leads[0].signals.length).toBeGreaterThan(signalsAfterFirst);
    const sources = new Set(leads[0].signals.map((signal) => signal.sourceUrl));
    expect(sources).toEqual(
      new Set([
        "https://example.test/crossimport/first.pdf",
        "https://example.test/crossimport/second.pdf",
      ]),
    );
  });

  it("does not let the second document rewrite where the lead came from", async () => {
    // Same lead as the case above, after both imports. `listedByGc` and
    // `listedOnProject` are PROVENANCE — which document introduced us — so the
    // second import must have filled nothing, because nothing was blank.
    const [lead] = await leadsNamed("Crossimport Drywall");
    expect(lead.listedByGc).toBe("Swinerton Builders");
    expect(lead.listedOnProject).toBe("Corona Ranch Elementary Modernization");
    // And the second document's own attribution is not lost — it is in the
    // signals, where a per-listing fact belongs.
    const claims = (
      await prisma.salesLeadSignal.findMany({
        where: { leadId: lead.id, sourceUrl: "https://example.test/crossimport/second.pdf" },
      })
    ).map((signal) => signal.claim);
    expect(claims.join("\n")).toContain("Bernards Bros Inc");
  });

  /**
   * THE CONSERVATIVE HALF, AND THE ONE MOST LIKELY TO BE ARGUED WITH.
   *
   * A licence is unique per registrant, so it is tempting to merge on it alone.
   * A STORED licence is not always document-sourced — `readTypedLicence` lets a
   * person type one and a transposed digit there is undetectable — and there is
   * no screen anywhere that un-merges a lead. So the name has to corroborate it,
   * and the price is this: a firm trading under a name that normalises
   * differently lands as a duplicate. A visible duplicate beats one company's
   * evidence silently welded onto another's record.
   */
  it("will not merge on a licence the name does not corroborate", async () => {
    const result = await importOneFirm(
      "Jurupa Valley Transportation Center",
      "Tilden-Coil Constructors",
      "Rivergate Interior Systems\tFontana, CA\tC-9 884501\t1000055501\tAcoustical ceilings",
      "https://example.test/crossimport/unrelated-name.pdf",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leadsCreated).toBe(1);
    expect(result.value.leadsAttached).toBe(0);

    const holders = await prisma.salesLead.findMany({
      where: { companyId: context.company.id, licenceNumber: "884501" },
      orderBy: { companyName: "asc" },
    });
    expect(holders.map((lead) => lead.companyName)).toEqual([
      "Crossimport Drywall, Inc.",
      "Rivergate Interior Systems",
    ]);
  });

  /**
   * TWO ARMS, BECAUSE ONE ARM PROVED NOTHING. This case used to be a single pair
   * of documents printing different licences under one trading name, asserting
   * two leads — and review showed it was insensitive to the thing its title
   * names. With the licences different, `leadHoldingThisLicence`'s own
   * `where: { licenceNumber: row.licence }` returns NO candidate, so
   * `sameCompany` is never called once: the name-corroboration leg and
   * `identifiersContradict` could both be deleted and it stayed green. Measured,
   * not argued — the same fixture with names sharing nothing gave a
   * byte-identical summary.
   *
   * Holding the NAMES identical across both arms and varying only the licence
   * means the name cannot be what decides either arm. An Inc. and an LLC with one
   * trading name normalise the same.
   *
   * WHICH ARM BITES, STATED RATHER THAN IMPLIED, because the first draft of this
   * docstring claimed both did. Arm 1 is the live one: it fails if the
   * cross-import merge stops happening. Arm 2 cannot be made to fail by any
   * single mutation, and that is a fact about the CODE rather than a weakness
   * here — two independent guards enforce it. The `where: { licenceNumber:
   * row.licence }` filter means a lead holding a different licence is never a
   * candidate, and `identifiersContradict` would refuse it even if it were. Drop
   * either one and arm 2 stays green. It is kept because it documents the
   * behaviour and will catch the day somebody removes BOTH; it is not evidence
   * about the name rule, which is `"will not merge on a licence the name does not
   * corroborate"` below.
   */
  it.each([
    ["one licence printed twice is one firm", "886401", "886401", 1],
    ["two licences under one trading name are two firms", "886501", "886502", 2],
  ])("%s", async (label, firstLicence, secondLicence, expected) => {
    const name = expected === 1 ? "Twinsame Plastering" : "Twinsplit Plastering";
    const first = await importOneFirm(
      `Beaumont Civic Center (${label})`,
      "Erickson-Hall Construction",
      `${name}, Inc.\tBeaumont, CA\tC-35 ${firstLicence}\tLath and cement plaster`,
      `https://example.test/crossimport/${name.replace(/\s+/g, "-").toLowerCase()}-inc.pdf`,
    );
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.leadsCreated).toBe(1);

    const second = await importOneFirm(
      `Banning Public Library (${label})`,
      "Erickson-Hall Construction",
      `${name}, LLC\tBeaumont, CA\tC-35 ${secondLicence}\tLath and cement plaster`,
      `https://example.test/crossimport/${name.replace(/\s+/g, "-").toLowerCase()}-llc.pdf`,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // The whole differential: same names both arms, and only the licence moved.
    expect(second.value.leadsCreated).toBe(expected - 1);
    expect(second.value.leadsAttached).toBe(expected === 1 ? 1 : 0);
    expect(await leadsNamed(name)).toHaveLength(expected);
  });

  /**
   * THE RUNG THAT DELIBERATELY DOES NOT TRAVEL.
   *
   * Within one listing an identical spelling IS enough: a §4104 form names a sub
   * once per portion of work, so two identical spellings are one table entry
   * written twice by one clerk. Between two documents the same string is two
   * clerks at two agencies spelling a name the same way — exactly what
   * `leadMatch.ts` refuses to act on — and neither document prints an identifier
   * to settle it. Two leads, and the reviewer's own dropdown is where that gets
   * resolved.
   *
   * The distinguishing detail is that NEITHER row has a licence: with one, the
   * licence would decide it and this case would prove nothing about spelling.
   */
  it("will not merge two documents on an identical spelling with no identifier", async () => {
    const first = await importOneFirm(
      "Hemet Valley Health Campus",
      "Swinerton Builders",
      "Spellingonly Ceilings\tHemet, CA\tAcoustical ceilings",
      "https://example.test/crossimport/spelling-first.pdf",
    );
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.leadsCreated).toBe(1);
    const [made] = await leadsNamed("Spellingonly Ceilings");
    // The premise: no identifier anywhere on either side.
    expect(made.licenceNumber).toBeNull();
    expect(made.registrationNumber).toBeNull();

    const second = await importOneFirm(
      "San Jacinto Community Pool",
      "Tilden-Coil Constructors",
      "Spellingonly Ceilings\tHemet, CA\tSuspended ceilings",
      "https://example.test/crossimport/spelling-second.pdf",
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.leadsCreated).toBe(1);
    expect(second.value.leadsAttached).toBe(0);
    expect(await leadsNamed("Spellingonly Ceilings")).toHaveLength(2);
  });

  /**
   * THE KEY IS THE LICENCE AND ONLY THE LICENCE, across imports.
   *
   * The in-pass rule accepts a DIR registration as an identifier too, and this
   * one deliberately does not: the registration column is stored exactly as the
   * document printed it with no normaliser behind it, it carries no index, and
   * `lib/sales-licence.ts` is the one measured key this feature has. Widening an
   * irreversible merge to a second identifier is a decision to take on purpose
   * with the evidence in hand, not a side effect of a lookup. Recorded as a test
   * rather than a comment so that widening it later has to be deliberate — this
   * case turns red the moment somebody does.
   */
  it("does not merge across imports on a registration number alone", async () => {
    const stored = await prisma.salesLead.create({
      data: {
        companyId: context.company.id,
        companyName: "Dironly Lathing, Inc.",
        registrationNumber: "1000088801",
      },
    });
    expect(stored.licenceNumber).toBeNull();

    const result = await importOneFirm(
      "Wildomar Civic Plaza",
      "Swinerton Builders",
      // Same registration, name agrees once the suffix goes, and no licence
      // anywhere — so the one key this rule reads is absent on both sides.
      "Dironly Lathing\tWildomar, CA\t1000088801\tLath and cement plaster",
      "https://example.test/crossimport/dir-only.pdf",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leadsCreated).toBe(1);
    expect(result.value.leadsAttached).toBe(0);
    expect(await prisma.salesLeadSignal.count({ where: { leadId: stored.id } })).toBe(0);

    /* THE PREMISE, PROVED RATHER THAN ASSUMED, because without it this is a
       refusal test that passes on a row the parser never read a registration
       out of at all — and a ten-digit DIR number sitting in a column the parser
       declined would produce exactly the same green. The new lead's own columns
       are the cheapest evidence that both sides really did hold this
       registration and neither held a licence. */
    const leads = await leadsNamed("Dironly Lathing");
    expect(leads).toHaveLength(2);
    const fresh = leads.find((lead) => lead.id !== stored.id)!;
    expect(fresh.registrationNumber).toBe("1000088801");
    expect(fresh.licenceNumber).toBeNull();
  });

  /**
   * A CONTRADICTION OUTRANKS THE KEY, which is the in-pass rule's one piece of
   * reasoning that runs the other way: if both sides print an identifier of the
   * SAME KIND and they differ, the documents have already said these are two
   * registrants, and the licence agreeing does not undo that.
   */
  it("refuses the merge when the registrations disagree, licence and name and all", async () => {
    const stored = await prisma.salesLead.create({
      data: {
        companyId: context.company.id,
        companyName: "Twoyard Drywall, Inc.",
        licenceNumber: "884701",
        registrationNumber: "1000077701",
      },
    });
    expect(stored.id).toBeTruthy();

    const result = await importOneFirm(
      "Menifee Fire Station 68",
      "Bernards Bros Inc",
      // Same licence, same name once the suffix goes, DIFFERENT registration.
      "Twoyard Drywall\tMenifee, CA\tC-9 884701\t1000077799\tMetal stud framing and drywall",
      "https://example.test/crossimport/registration-clash.pdf",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leadsCreated).toBe(1);
    expect(result.value.leadsAttached).toBe(0);
    expect(await leadsNamed("Twoyard Drywall")).toHaveLength(2);
    // And the lead somebody already had was not touched.
    const after = await prisma.salesLead.findUnique({ where: { id: stored.id } });
    expect(after?.registrationNumber).toBe("1000077701");
    expect(await prisma.salesLeadSignal.count({ where: { leadId: stored.id } })).toBe(0);
  });

  /**
   * THE HOLE THIS FIX WOULD OTHERWISE HAVE DUG ONE ROW FURTHER DOWN.
   *
   * Before the licence rule existed, a two-row listing for one firm had the
   * first row CREATE the lead, so the second row found it on the
   * identical-spelling rung. Once the first row ATTACHES to a lead an earlier
   * import made, that lead has to go into the in-pass list too, or a second row
   * whose licence cell is BLANK stops seeing it and writes a duplicate the old
   * code would not have written.
   *
   * The fixture is the mixed case a clerk actually produces — the licence filled
   * on one portion of work and left out on the other — and the parse is asserted
   * to BE that, because a fixture where both rows carry the licence would prove
   * nothing here.
   */
  it("keeps a later blank-licence row of the same paste on the lead it just merged into", async () => {
    const first = await importOneFirm(
      "Perris Union Maintenance Yard",
      "Swinerton Builders",
      "Chandler Walls\tOntario, CA\tC-9 775601\tMetal stud framing and drywall",
      "https://example.test/crossimport/chandler-first.pdf",
    );
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.leadsCreated).toBe(1);
    const [made] = await leadsNamed("Chandler Walls");
    expect(made.licenceNumber).toBe("775601");

    const listingText = [
      "Project: Chandler Middle School Modernization",
      "Prime Contractor: Tilden-Coil Constructors",
      "",
      "Chandler Walls\tOntario, CA\tC-9 775601\tMetal stud framing and drywall",
      "Chandler Walls\tOntario, CA\tLath and cement plaster",
    ].join("\n");
    const parsed = parseSubListing(listingText);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.unread).toHaveLength(0);
    // The premise of the case: one row has the licence and the other does not.
    expect(parsed.rows.map((row) => row.licence)).toEqual(["C-9 775601", null]);

    const second = await importSubListing(
      form({
        listingText,
        sourceUrl: "https://example.test/crossimport/chandler-second.pdf",
        primeOutcome: "UNKNOWN",
        lines: parsed.rows.map((row) => row.line).join(","),
      }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.leadsCreated).toBe(0);
    // ONE attach for the lead, not one per row that landed on it.
    expect(second.value.leadsAttached).toBe(1);
    expect(await leadsNamed("Chandler Walls")).toHaveLength(1);

    // Both rows of the second paste are on it.
    const lines = new Set(
      (
        await prisma.salesLeadSignal.findMany({
          where: { leadId: made.id, sourceUrl: "https://example.test/crossimport/chandler-second.pdf" },
        })
      )
        .map((signal) => /line (\d+)/.exec(signal.claim)?.[1])
        .filter(Boolean),
    );
    expect(lines.size).toBe(2);
  });

  /**
   * A HUMAN'S CHOICE IS NOT OVERRULED BY THE KEY. The reviewer picked a lead for
   * this row; the licence rule is never asked. Deliberate ordering rather than
   * an accident of where the branch sits — a per-row decision somebody made on
   * screen outranks a machine's inference about the same row.
   */
  it("leaves a row the reviewer attached by hand where they put it", async () => {
    const chosen = await prisma.salesLead.create({
      data: { companyId: context.company.id, companyName: "Handpicked Partitions" },
    });
    const holder = await prisma.salesLead.create({
      data: {
        companyId: context.company.id,
        companyName: "Overrule Drywall, Inc.",
        licenceNumber: "884801",
      },
    });

    const { listingText, line } = oneFirm(
      "Riverside Animal Shelter",
      "Erickson-Hall Construction",
      "Overrule Drywall\tRiverside, CA\tC-9 884801\tMetal stud framing and drywall",
    );
    const result = await importSubListing(
      form({
        listingText,
        sourceUrl: "https://example.test/crossimport/handpicked.pdf",
        primeOutcome: "UNKNOWN",
        lines: String(line),
        [`attach:${line}`]: chosen.id,
      }),
    );
    expect(result.ok).toBe(true);

    // The row went where the person said, and the licence holder got nothing.
    expect(await prisma.salesLeadSignal.count({ where: { leadId: chosen.id } })).toBeGreaterThan(0);
    expect(await prisma.salesLeadSignal.count({ where: { leadId: holder.id } })).toBe(0);
  });

  /**
   * TWO LEADS ALREADY HOLD THE LICENCE — the state the database is in BEFORE
   * this rule existed, since nothing stopped a duplicate being written. Oldest
   * first, tie-broken on id, so two runs of one import cannot pick different
   * leads and a pile of pre-existing duplicates converges on the one with the
   * most history instead of growing.
   */
  it("picks the oldest of several leads already holding the licence, every time", async () => {
    const older = await prisma.salesLead.create({
      data: {
        companyId: context.company.id,
        companyName: "Converge Drywall",
        licenceNumber: "884901",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    const newer = await prisma.salesLead.create({
      data: {
        companyId: context.company.id,
        companyName: "Converge Drywall, Inc.",
        licenceNumber: "884901",
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    });

    for (const [index, project] of [
      "Eastvale Sports Park",
      "Norco Equestrian Center",
    ].entries()) {
      const result = await importOneFirm(
        project,
        "Swinerton Builders",
        "Converge Drywall\tEastvale, CA\tC-9 884901\tMetal stud framing and drywall",
        `https://example.test/crossimport/converge-${index}.pdf`,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.leadsCreated).toBe(0);
    }

    // Both imports landed on the older one, and no third lead was made.
    expect(await prisma.salesLeadSignal.count({ where: { leadId: older.id } })).toBeGreaterThan(0);
    expect(await prisma.salesLeadSignal.count({ where: { leadId: newer.id } })).toBe(0);
    expect(await leadsNamed("Converge Drywall")).toHaveLength(2);
  });

  /**
   * AND NONE OF IT CROSSES A COMPANY BOUNDARY. The index is composite for this
   * reason; the query has to be too. A licence held by somebody else's lead is
   * not a candidate, however unique the number is.
   */
  it("ignores a lead in another company that holds the same licence", async () => {
    const otherLead = await prisma.salesLead.findUnique({ where: { id: otherCompanyLeadId } });
    expect(otherLead).toBeTruthy();
    const foreign = await prisma.salesLead.create({
      data: {
        companyId: otherLead!.companyId,
        companyName: "Tenantline Drywall, Inc.",
        licenceNumber: "885001",
      },
    });

    const result = await importOneFirm(
      "Moreno Valley Senior Center",
      "Bernards Bros Inc",
      "Tenantline Drywall\tMoreno Valley, CA\tC-9 885001\tMetal stud framing and drywall",
      "https://example.test/crossimport/tenantline.pdf",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leadsCreated).toBe(1);
    expect(result.value.leadsAttached).toBe(0);
    expect(await prisma.salesLeadSignal.count({ where: { leadId: foreign.id } })).toBe(0);

    // This company got its own lead, with its own copy of the number.
    const [mine] = await leadsNamed("Tenantline Drywall");
    expect(mine.companyId).toBe(context.company.id);
    expect(mine.licenceNumber).toBe("885001");

    // Clean up the extra foreign lead here; `afterAll` only knows about one.
    await prisma.salesLead.delete({ where: { id: foreign.id } });
  });

  /**
   * THE DEFECT THE CROSS-IMPORT MERGE WAS MOST LIKELY TO GROW, found by review
   * 2026-10-05 and measured before it was fixed: a row merging onto a lead from
   * an earlier import pushed ITS OWN identifiers onto `importedHere`, not the
   * lead's. The lead held a DIR registration this document never printed, so the
   * entry recorded `registration: null` — and the next row of the same paste,
   * carrying a DIFFERENT registration, found no contradiction, matched on
   * spelling, and wrote another registrant's DIR number onto a lead with real
   * history. PROPOSED, well-formed, and about somebody else.
   */
  it("does not let a sibling row ride a weaker entry onto a lead it contradicts", async () => {
    const holder = await prisma.salesLead.create({
      data: {
        companyId: context.company.id,
        companyName: "Bridgecontra Drywall, Inc.",
        licenceNumber: "886101",
        registrationNumber: "1000061111",
      },
    });

    const result = await importListing(
      [
        "Project: Rialto Transit Center",
        "Agency: City of Rialto",
        "Prime Contractor: Swinerton Builders",
        "",
        // Same licence as the stored lead, and no DIR cell — this one merges.
        "Bridgecontra Drywall\tFontana, CA\tC-9 886101\tMetal stud framing and drywall",
        // Same licence, same spelling, a DIR number that is NOT the lead's.
        "Bridgecontra Drywall\tFontana, CA\tC-35 886101\t1000069999\tLath and cement plaster",
      ],
      "https://example.test/crossimport/bridgecontra.pdf",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // One row joined the lead; the contradicting one became its own.
    expect(result.value.leadsAttached).toBe(1);
    expect(result.value.leadsCreated).toBe(1);

    /* The assertion that bites: the stored lead must carry no claim quoting the
       other registrant's number. This is the harm, not the lead count. */
    const onHolder = await prisma.salesLeadSignal.findMany({ where: { leadId: holder.id } });
    expect(onHolder.length).toBeGreaterThan(0);
    expect(onHolder.filter((signal) => signal.claim.includes("1000069999"))).toEqual([]);
  });

  /**
   * "…and N you already had" IS A COUNT OF RECORDS, and it was two counters'
   * worth of `+= 1`: one per ROW on the hand-attach path, one per LEAD on the
   * licence path. Two rows landing on one lead reported two. Found by review;
   * the fixture mixes both paths on purpose, because neither path alone can
   * double-count.
   */
  it("counts one lead the reviewer already had, however many rows land on it", async () => {
    const holder = await prisma.salesLead.create({
      data: {
        companyId: context.company.id,
        companyName: "Doubletally Drywall, Inc.",
        licenceNumber: "886201",
      },
    });

    const listingText = [
      "Project: Perris Community Center",
      "Prime Contractor: Bernards Bros Inc",
      "",
      // Found by licence, with no help from the reviewer.
      "Doubletally Drywall\tPerris, CA\tC-9 886201\tMetal stud framing and drywall",
      // A different firm entirely, which the reviewer sends to the same lead.
      "Unrelated Ceilings\tPerris, CA\tC-2 886299\tAcoustical ceilings",
    ].join("\n");
    const parsed = parseSubListing(listingText);
    expect(parsed.rows, "the fixture parsed to the wrong number of rows").toHaveLength(2);
    expect(parsed.unread).toHaveLength(0);

    const result = await importSubListing(
      form({
        listingText,
        sourceUrl: "https://example.test/crossimport/doubletally.pdf",
        primeOutcome: "UNKNOWN",
        lines: parsed.rows.map((row) => row.line).join(","),
        [`attach:${parsed.rows[1].line}`]: holder.id,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both rows reached ONE pre-existing lead, so the sentence says one.
    expect(result.value.leadsAttached).toBe(1);
    expect(result.value.leadsCreated).toBe(0);
    expect(await prisma.salesLeadSignal.count({ where: { leadId: holder.id } })).toBeGreaterThan(1);
  });

  /**
   * THE `{ id: "asc" }` TIE-BREAK, WHICH NOTHING EXERCISED. The case above it
   * gives its two leads explicitly different `createdAt` values, so the tie never
   * fired and the tie-break could be deleted with the suite green — review found
   * that, and it is the one thing the changelog had called "required, not tidy".
   *
   * The tie is reachable because Postgres `CURRENT_TIMESTAMP` is TRANSACTION
   * start, so every row written by one `$transaction` shares it. That premise is
   * asserted rather than assumed: without the equality check below, this test
   * would quietly become another `createdAt` case.
   */
  it("breaks a createdAt tie on the id, so two runs cannot pick different leads", async () => {
    /* THE IDS ARE EXPLICIT AND INSERTED IN THE WRONG ORDER ON PURPOSE. The first
       version of this let both ids default, and the mutation that deletes the
       tie-break SURVIVED it: `cuid()` is time-ordered, so the lower id is also
       the row inserted first, which is roughly what Postgres hands back from a
       two-row heap anyway. The test passed for a reason that had nothing to do
       with the clause it was written for. Inserting the HIGHER id first makes
       insertion order and id order disagree, so only the `orderBy` can produce
       the right answer. */
    const [a, b] = await prisma.$transaction([
      prisma.salesLead.create({
        data: {
          id: "dbtesttiebreakzzzzzzzzzzz",
          companyId: context.company.id,
          companyName: "Tiebreak Drywall",
          licenceNumber: "886301",
        },
      }),
      prisma.salesLead.create({
        data: {
          id: "dbtesttiebreakaaaaaaaaaaa",
          companyId: context.company.id,
          companyName: "Tiebreak Drywall",
          licenceNumber: "886301",
        },
      }),
    ]);
    // Both premises, asserted rather than assumed: one transaction means one
    // CURRENT_TIMESTAMP, and the row inserted FIRST is the one with the HIGHER id.
    expect(a.createdAt.getTime()).toBe(b.createdAt.getTime());
    expect(a.id > b.id).toBe(true);

    const [lower, higher] = [b, a];
    const result = await importOneFirm(
      "Eastvale Library",
      "Swinerton Builders",
      "Tiebreak Drywall\tEastvale, CA\tC-9 886301\tMetal stud framing and drywall",
      "https://example.test/crossimport/tiebreak.pdf",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.leadsCreated).toBe(0);

    expect(await prisma.salesLeadSignal.count({ where: { leadId: lower.id } })).toBeGreaterThan(0);
    expect(await prisma.salesLeadSignal.count({ where: { leadId: higher.id } })).toBe(0);
  });

  it("still lands every one of these PROPOSED, with no reviewer", async () => {
    const signals = await prisma.salesLeadSignal.findMany({
      where: {
        companyId: context.company.id,
        sourceUrl: { startsWith: "https://example.test/crossimport/" },
      },
    });
    // Without this the loop below is a pass over an empty list.
    expect(signals.length).toBeGreaterThan(10);
    for (const signal of signals) {
      expect(signal.state, signal.claim).toBe("PROPOSED");
      expect(signal.reviewedAt, signal.claim).toBeNull();
      expect(signal.reviewedByUserId, signal.claim).toBeNull();
    }
  });
});

/**
 * RE-READING ONE DOCUMENT IS NOT NEW EVIDENCE.
 *
 * Found by review 2026-10-05, after the cross-import merge fixed the lead count
 * and left the claims alone: three imports of one listing produced ONE lead,
 * correctly, carrying fifteen PROPOSED signals over five distinct claims. The
 * reviewer confirms the same sentence three times and the lead stays
 * undeletable, which is the cost the merge was written to remove.
 *
 * `(leadId, sourceUrl, kind, claim)` is the natural key of a piece of evidence.
 * There is no unique constraint for it and these tests deliberately do not add
 * one — a migration would have to be announced before the push, and the rule can
 * be honoured by the one function that writes these rows.
 *
 * Their own source prefix, because one of them DISMISSES a signal and the sweep
 * in the block above asserts every `crossimport/` signal is PROPOSED.
 */
describe("re-reading one document does not write its evidence twice", () => {
  const SOURCE = "https://example.test/idempotent/award-packet.pdf";

  function listingFor(project: string) {
    const listingText = [
      `Project: ${project}`,
      "Prime Contractor: Swinerton Builders",
      "",
      "Repeatread Drywall, Inc.\tFontana, CA\tC-9 886601\t1000066601\tMetal stud framing and drywall",
    ].join("\n");
    const parsed = parseSubListing(listingText);
    expect(parsed.rows, "the fixture parsed to no single row").toHaveLength(1);
    expect(parsed.unread).toHaveLength(0);
    return { listingText, line: parsed.rows[0].line };
  }

  function importAt(project: string, sourceUrl: string) {
    const { listingText, line } = listingFor(project);
    return importSubListing(
      form({ listingText, sourceUrl, primeOutcome: "UNKNOWN", lines: String(line) }),
    );
  }

  async function theLead() {
    const [lead] = await leadsNamed("Repeatread Drywall");
    expect(lead, "the first import made no lead").toBeTruthy();
    return lead;
  }

  it("adds nothing at all on a second import of the same document", async () => {
    const first = await importAt("Fontana Senior Center", SOURCE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // The premise: there is evidence for the second import to duplicate.
    expect(first.value.signalsProposed).toBeGreaterThan(1);

    const lead = await theLead();
    const before = await prisma.salesLeadSignal.count({ where: { leadId: lead.id } });
    expect(before).toBe(first.value.signalsProposed);

    const second = await importAt("Fontana Senior Center", SOURCE);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // It FOUND the lead — this is not a pass bought by the import failing.
    expect(second.value.leadsCreated).toBe(0);
    expect(second.value.leadsAttached).toBe(1);
    // And wrote nothing, which the summary says as well as the database.
    expect(second.value.signalsProposed).toBe(0);
    expect(await prisma.salesLeadSignal.count({ where: { leadId: lead.id } })).toBe(before);
  });

  /**
   * THE HALF THAT MATTERS, AND IT IS NOT THE DUPLICATION. The query behind the
   * filter reads signals in EVERY state, so a claim somebody dismissed is not
   * written back as PROPOSED by the next import. A rejected sentence returning
   * un-reviewed is the review step being undone by a re-read, and on screen it
   * is indistinguishable from fresh evidence.
   */
  it("does not resurrect a claim the reviewer dismissed", async () => {
    const lead = await theLead();
    const victim = await prisma.salesLeadSignal.findFirst({
      where: { leadId: lead.id, sourceUrl: SOURCE, state: "PROPOSED" },
    });
    expect(victim, "no PROPOSED signal to dismiss").toBeTruthy();
    if (!victim) return;
    await prisma.salesLeadSignal.update({
      where: { id: victim.id },
      data: { state: "DISMISSED", reviewedAt: new Date() },
    });

    const again = await importAt("Fontana Senior Center", SOURCE);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.signalsProposed).toBe(0);

    // Still one row carrying that sentence, still dismissed.
    const carrying = await prisma.salesLeadSignal.findMany({
      where: { leadId: lead.id, claim: victim.claim },
    });
    expect(carrying).toHaveLength(1);
    expect(carrying[0].state).toBe("DISMISSED");
  });

  /**
   * AND THE FILTER MUST NOT SWALLOW A CORRECTION. An agency re-posting a fixed
   * listing at the SAME URL is the case a claim-level key exists to allow: the
   * wording changes, so the sentences are new evidence and land. Without this
   * the test above would be satisfied by a filter that simply refused any second
   * import of a URL, which is a different and much worse rule.
   */
  it("still records a document re-posted at the same URL with different wording", async () => {
    const lead = await theLead();
    const before = await prisma.salesLeadSignal.count({ where: { leadId: lead.id } });

    const corrected = await importAt("Fontana Senior Center PHASE TWO", SOURCE);
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;

    expect(corrected.value.signalsProposed).toBeGreaterThan(0);
    expect(await prisma.salesLeadSignal.count({ where: { leadId: lead.id } })).toBeGreaterThan(
      before,
    );
    // Still one lead: the licence is the same contractor.
    expect(await leadsNamed("Repeatread Drywall")).toHaveLength(1);
  });
});
