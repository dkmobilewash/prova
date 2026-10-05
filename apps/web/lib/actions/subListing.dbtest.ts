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
