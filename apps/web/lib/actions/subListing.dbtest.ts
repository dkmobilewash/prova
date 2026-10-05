import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { parseSubListing } from "@/lib/sub-listing/parse";
import { qualify } from "@/lib/sales-qualification";
import { MAX_LISTING_ROWS, rowKeysFor, signalsForSub, tooManyRows } from "@/lib/sub-listing/signals";

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

/**
 * THE SELECTION TRAVELS AS ROW KEYS, NOT LINE NUMBERS, so these tests post what
 * the review screen posts — asked of `rowKeysFor`, the one function the screen
 * and the server both ask.
 *
 * Every document in this file is a column table with one firm per line, so each
 * key happens to be `line.0`. These helpers DERIVE it rather than spelling that
 * out: a test that hard-coded `.0` would be a second copy of the identity scheme,
 * and it would keep passing if the scheme changed under it.
 */
const keysOf = (parsed: { rows: readonly { line: number }[] }) => rowKeysFor(parsed.rows).join(",");
const keyAt = (parsed: { rows: readonly { line: number }[] }, line: number) =>
  rowKeysFor(parsed.rows)[parsed.rows.findIndex((row) => row.line === line)]!;

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
    rows: keysOf(parsedListing),
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
    /* Three well-formed keys for rows this parse does not have — its rows sit on
       lines 5, 6 and 7. Well-formed on purpose: a garbage string would be refused
       by the parse of the field rather than by the guard under test. */
    const result = await importSubListing(base({ rows: "1.0,2.0,999.0" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not read the same way/);
    expect(await prisma.salesLeadSignal.count({ where: { companyId: context.company.id } })).toBe(0);
  });

  /**
   * THE CAP, FROM THE SERVER END, AND THE ORDER IS HALF THE POINT.
   *
   * The selection here is 61 line numbers that this listing does not contain, so
   * BOTH refusals apply — the cap and "does not read the same way". It must be
   * the cap, because the cap is the cheap check and reconciling the rows is not.
   * Move the cap below the reconciliation and this test reds with the other
   * sentence, which is how it pins the order rather than just the limit.
   *
   * The expected string comes from `tooManyRows`, not retyped here, so the
   * sentence a reviewer reads on screen before submitting and the one the server
   * answers with are asserted to be the same object of truth and not two strings
   * somebody kept in step.
   */
  it("refuses more than the cap, before it reconciles a single row", async () => {
    const over = MAX_LISTING_ROWS + 1;
    const rows = Array.from({ length: over }, (_, index) => `${index + 1}.0`).join(",");
    const result = await importSubListing(base({ rows }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(tooManyRows(over));
      // Not the reconciliation refusal, which these line numbers also earn.
      expect(result.error).not.toMatch(/does not read the same way/);
    }
    expect(await prisma.salesLeadSignal.count({ where: { companyId: context.company.id } })).toBe(0);
  });

  it("accepts exactly the cap without complaining about the count", async () => {
    /* The other side of the boundary, and it cannot pass by the import
       succeeding: this selection is still wrong for a different reason, so the
       assertion is that the error is the RECONCILIATION one rather than the cap.
       A cap written `>=` reds here; a cap written `>` reds the case above. */
    const rows = Array.from({ length: MAX_LISTING_ROWS }, (_, index) => `${index + 1}.0`).join(",");
    const result = await importSubListing(base({ rows }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/does not read the same way/);
      expect(result.error).not.toMatch(/at once/);
    }
  });

  it("refuses to attach to another company's lead, re-read inside the transaction", async () => {
    const result = await importSubListing(
      base({
        rows: keyAt(parsedListing, lineOf("Valley Interior Systems")),
        [`attach:${keyAt(parsedListing, lineOf("Valley Interior Systems"))}`]: otherCompanyLeadId,
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
    const result = await importSubListing(
      base({ [`attach:${keyAt(parsedListing, summitLine)}`]: existingLeadId }),
    );
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
        rows: keysOf(parsedMulti),
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
        rows: keysOf(parsedBare),
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
      rows: keysOf(parsed),
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
        rows: keysOf(parsed),
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
        rows: keyAt(parseSubListing(listingText), line),
        [`attach:${keyAt(parseSubListing(listingText), line)}`]: existing.id,
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
      form({
        listingText,
        sourceUrl,
        primeOutcome: "UNKNOWN",
        rows: keyAt(parseSubListing(listingText), line),
      }),
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
        rows: keysOf(parsed),
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
        rows: keyAt(parseSubListing(listingText), line),
        [`attach:${keyAt(parseSubListing(listingText), line)}`]: chosen.id,
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
        rows: keysOf(parsed),
        [`attach:${keyAt(parsed, parsed.rows[1].line)}`]: holder.id,
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

  function listingFor(project: string, city = "Fontana, CA") {
    const listingText = [
      `Project: ${project}`,
      "Prime Contractor: Swinerton Builders",
      "",
      `Repeatread Drywall, Inc.\t${city}\tC-9 886601\t1000066601\tMetal stud framing and drywall`,
    ].join("\n");
    const parsed = parseSubListing(listingText);
    expect(parsed.rows, "the fixture parsed to no single row").toHaveLength(1);
    expect(parsed.unread).toHaveLength(0);
    return { listingText, line: parsed.rows[0].line };
  }

  function importAt(project: string, sourceUrl: string, city?: string) {
    const { listingText, line } = listingFor(project, city);
    return importSubListing(
      form({
        listingText,
        sourceUrl,
        primeOutcome: "UNKNOWN",
        rows: keyAt(parseSubListing(listingText), line),
      }),
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
  /**
   * THE COUNT MUST BE WHAT WAS WRITTEN, not what was offered — and the case below
   * could not tell the difference. Review found it: changing
   * `signalsProposed += fresh.length` to `+= proposals.length` left the whole db
   * suite green, because no case exercised a PARTIAL overlap and the ones that
   * existed asserted only `> 0`.
   *
   * A partial overlap is a real shape rather than a contrived one: an agency
   * reposts a corrected listing at the same URL with ONE field changed. Changing
   * the city alone moves exactly one of the five claims — the GEOGRAPHY one,
   * measured rather than assumed — so the honest count is 1 and the inflated one
   * is 5.
   *
   * Asserted as an identity against the database rather than as a literal, so it
   * stays true if the number of claims a row yields ever changes.
   */
  it("counts the claims it WROTE, not the ones it considered, on a partial re-import", async () => {
    const lead = await theLead();
    const before = await prisma.salesLeadSignal.count({ where: { leadId: lead.id } });

    const corrected = await importAt("Fontana Senior Center", SOURCE, "Rialto, CA");
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    const after = await prisma.salesLeadSignal.count({ where: { leadId: lead.id } });

    // The identity: the summary's number IS the number of rows written.
    expect(corrected.value.signalsProposed).toBe(after - before);
    /* And the overlap really is PARTIAL — without these the identity above is
       satisfied by a re-import that wrote everything, or nothing. */
    expect(corrected.value.signalsProposed).toBeGreaterThan(0);
    expect(corrected.value.signalsProposed).toBeLessThan(5);
  });

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

/**
 * THE MAXIMUM LEGAL IMPORT, WHICH NOTHING HAD EVER RUN.
 *
 * Every other case in this file imports one to three rows. The cap is 60, a real
 * award packet for a large school job carries that many subcontractors, and the
 * whole feature's premise is that somebody pastes a whole listing — so the one
 * input the product is FOR was the one input untested. Added 2026-10-05 after a
 * night in which both genuine defects were found by asking what the code does at
 * realistic scale rather than fixture scale.
 *
 * It is deliberately AT the cap rather than near it: 60 is the largest import the
 * action accepts, so this is simultaneously the upper boundary of `tooManyRows`
 * from the accepting side.
 *
 * ── WHAT THIS DOES NOT ESTABLISH, MEASURED RATHER THAN HAND-WAVED ──
 *
 * It asserts CORRECTNESS at 60 rows. It says nothing about production speed, and
 * the gap is bigger than "a few queries per row". Measured by turning on
 * `log_min_duration_statement=0` and counting what lands between this import's own
 * BEGIN and COMMIT:
 *
 *   **484 operations inside ONE transaction** — 120 SELECT, 120 INSERT and the
 *   prepared-statement traffic around them, about **8 per row** — summing to 39 ms
 *   of statement time over a local unix socket.
 *
 * Production is Neon through a pooler with `connection_limit=5`, where each of
 * those is a network round trip. At 5 ms that is ~2.4 s; at 20 ms, ~10 s; and
 * CLAUDE.md records that Neon suspends idle computes, so the first request also
 * pays a wake. A 60-row import is therefore the most likely thing in this feature
 * to be slow or to hit an execution limit, and this test cannot see any of it.
 *
 * Deliberately NOT optimised here. Batching the per-row lookups into one query
 * each would change the ordering the in-pass and cross-import rules depend on —
 * code that has just been through two reviews and had two scope errors — and it
 * would be a performance change verified on the one machine where performance
 * does not matter. The number is recorded so the decision is somebody's rather
 * than nobody's.
 */
describe("a full-size listing, at the cap", () => {
  const SOURCE = "https://example.test/scale/sixty-row-award-packet.pdf";
  const ROWS = 60;

  function sixtyRows() {
    const lines = [
      "Project: Riverside Unified High School No. 4",
      "Agency: Riverside Unified School District",
      "Prime Contractor: Swinerton Builders",
      "",
      ...Array.from({ length: ROWS }, (_, index) => {
        const n = String(index + 1).padStart(2, "0");
        return [
          `Scalefirm ${n} Drywall`,
          "Fontana, CA",
          `C-9 ${710001 + index}`,
          `10000${String(70001 + index)}`,
          "Metal stud framing and drywall",
        ].join("\t");
      }),
    ];
    const listingText = lines.join("\n");
    const parsed = parseSubListing(listingText);
    // The premise. Without it every count below could be about a shorter paste.
    expect(parsed.rows, "the 60-row fixture did not parse to 60 rows").toHaveLength(ROWS);
    expect(parsed.unread, "the 60-row fixture has unreadable lines").toHaveLength(0);
    return { listingText, rows: keysOf(parsed) };
  }

  it("imports all 60, and the counts add up", async () => {
    const { listingText, rows } = sixtyRows();
    const result = await importSubListing(
      form({ listingText, sourceUrl: SOURCE, primeOutcome: "UNKNOWN", rows }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.leadsCreated).toBe(ROWS);
    expect(result.value.leadsAttached).toBe(0);
    expect(result.value.rowsSkipped).toBe(0);

    const leads = await leadsNamed("Scalefirm");
    expect(leads).toHaveLength(ROWS);

    /* The summary's figure IS the number of rows written, asserted as an identity
       rather than against 300 — so it survives the day a row yields a different
       number of claims. */
    const signals = await prisma.salesLeadSignal.count({
      where: { companyId: context.company.id, sourceUrl: SOURCE },
    });
    expect(result.value.signalsProposed).toBe(signals);
    // And every lead really did get its own evidence, not one lead getting all of it.
    expect(signals).toBe(leads.reduce((total, lead) => total + lead.signals.length, 0));
    for (const lead of leads) expect(lead.signals.length).toBeGreaterThan(0);
  });

  /**
   * IDEMPOTENCE AT SCALE. The single-row case is pinned above; this is the one a
   * reviewer actually performs — re-pasting a whole packet after an addendum — and
   * it is where 60 duplicate leads and 300 duplicate claims would have appeared.
   */
  it("re-importing the whole packet adds no lead and no claim", async () => {
    const { listingText, rows } = sixtyRows();
    const before = await prisma.salesLeadSignal.count({
      where: { companyId: context.company.id, sourceUrl: SOURCE },
    });
    expect(before).toBeGreaterThan(0);

    const again = await importSubListing(
      form({ listingText, sourceUrl: SOURCE, primeOutcome: "UNKNOWN", rows }),
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    // It FOUND all sixty rather than passing by failing to match them.
    expect(again.value.leadsAttached).toBe(ROWS);
    expect(again.value.leadsCreated).toBe(0);
    expect(again.value.signalsProposed).toBe(0);

    expect(await leadsNamed("Scalefirm")).toHaveLength(ROWS);
    expect(
      await prisma.salesLeadSignal.count({
        where: { companyId: context.company.id, sourceUrl: SOURCE },
      }),
    ).toBe(before);
  });
});

/**
 * TWO FIRMS ON ONE LINE — THE SHAPE THAT COULD BE READ AND COULD NEVER BE
 * IMPORTED.
 *
 * `readLabelledColumnsForm` emits one row per BIDDER COLUMN and stamps every one
 * with the slot's own `firstLine`, honestly: the document really does print two
 * firms across one line. Every other reader in `parse.ts` gives each row a line
 * of its own, so nothing had ever exercised `importSubListing` with
 * `parsed.rows` holding a repeated line number — and every fixture in this file
 * is a column table.
 *
 * What that cost, measured rather than reasoned about. The screen posted the
 * selection as LINE NUMBERS, the server deduplicated them and filtered
 * `parsed.rows` back, and got MORE rows than keys — so
 * `chosen.length !== unique.length` fired and the whole paste was refused with
 * "the listing does not read the same way now as it did on screen. Paste it
 * again." The reader is deterministic, so re-pasting reproduces it exactly: **a
 * multi-bidder labelled-column listing was unimportable, and the refusal named
 * the one remedy that cannot work.** That is the shape the labelled reader was
 * written FOR; its own header says the real documents print four columns.
 *
 * Three quieter faults had the same cause and are gone with it: `chosen[line]`
 * and `attach[line]` ALIASED across the columns of a slot, so one tick ticked
 * two firms and one "Already a lead?" applied to both; and `<li key={row.line}>`
 * repeated a React key.
 *
 * The selection travels as `rowKeysFor` keys now — `line.ordinal`, derived from
 * the reading, so two parses of one text still agree on it.
 *
 * ── AND THE SECOND HALF, WHICH IS A DEDUPE THIS BRANCH HAD DELETED ──
 *
 * Both rows of a slot share a line, so `atLine` does not separate them, and the
 * PROJECT and GC_RELATIONSHIP claims draw on nothing else that differs per
 * column — that reader sets `listedBy`, `amount` and `percentOfBid` null on every
 * row. So two such rows produce byte-identical `(kind, claim)` pairs: measured at
 * 5 claims each, 2 identical, 8 distinct, under BOTH prime outcomes.
 *
 * Earlier on this branch the per-lead claim set stopped adding written claims
 * back, justified by "`chosen` is a filter over `parsed.rows`, whose line numbers
 * are distinct". They are not. The deletion was checked against the db suite and
 * the db suite had no document of this shape — the right method, the wrong
 * corpus. The third case below is the one that would have caught it.
 */
describe("a labelled-column form with two bidder columns on one line", () => {
  /**
   * The repo's own labelled-column shape, with invented identifiers. Two firms
   * printed across the `Subcontractor 1` slot; the `Subcontractor 2` block is
   * present and empty, as the real forms print it.
   *
   * ONE FORM PER CASE, with its own firm names and licences, because this file's
   * cases share a company: a second case asserting `leadsCreated` on the same two
   * names reads 0 and is RIGHT to — the importer correctly attached to the lead
   * the first case made. Found by writing it the other way first, which is how the
   * two-column names below came to be parameters rather than literals.
   *
   * The column offsets are load-bearing: this reader matches values by the column
   * they START at, across the labelled lines. The names are padded to a fixed
   * width here so a longer firm name cannot silently shift the licence column.
   */
  const slotForm = (tag: string, licenceA: string, licenceB: string) => {
    const nameA = `${tag} Ridge Interiors`;
    const nameB = `${tag} Crest Lathing`;
    const pad = (value: string) => value.padEnd(30, " ");
    return {
      nameA,
      nameB,
      text: [
        "Project: Mesa Verde Science Building",
        "Agency: Example Community College District",
        "Prime Contractor: Northgate Builders",
        "Bid Date: May 6, 2026",
        "LIST OF SUBCONTRACTORS:",
        "      Subcontractor 1 - Portion of the Work Activity",
        `      (e.g. electrical, mechanical, concrete)       ${pad("Metal Stud Framing & Drywall")}${"Lath and Plaster"}`,
        `      Subcontractor 1 - Name of Business            ${pad(nameA)}${nameB}`,
        `      Subcontractor 1 - Location of Business (city) ${pad("Fontana")}${"COLTON"}`,
        `      Subcontractor 1 - License No.                 ${pad(licenceA)}${licenceB}`,
        `      Subcontractor 1 - DIR Registration No.        ${pad("1000030001")}${"1000030002"}`,
        "      Subcontractor 2 - Portion of the Work Activity",
        "      (e.g. electrical, mechanical, concrete)",
        "      Subcontractor 2 - Name of Business",
        "      Subcontractor 2 - Location of Business (city)",
        "      Subcontractor 2 - License No.",
        "      Subcontractor 2 - DIR Registration No.",
      ].join("\n"),
    };
  };

  /**
   * THE PREMISE, AND IT IS THE WHOLE REASON THE TWO CASES BELOW MEAN ANYTHING.
   *
   * If the reader ever stops putting both firms on one line — reasonably; it
   * could number them — every assertion below passes for a different reason and
   * this describe quietly stops testing what it is named after. So the shape is
   * asserted first, and the keys are asserted to distinguish rows the line
   * cannot.
   */
  it("really does read two firms off one line, and the keys tell them apart", () => {
    const form = slotForm("Shape", "990801", "990802");
    const parsed = parseSubListing(form.text);
    expect(parsed.rows.map((row) => row.name)).toEqual([form.nameA, form.nameB]);
    expect(new Set(parsed.rows.map((row) => row.line)).size).toBe(1);
    const keys = rowKeysFor(parsed.rows);
    expect(new Set(keys).size).toBe(2);
    // And both carry their own identifiers, so the two leads below are two
    // firms rather than one row read twice.
    expect(parsed.rows.map((row) => row.licence)).toEqual(["990801", "990802"]);
  });

  it("imports both columns instead of refusing the paste", async () => {
    const listing = slotForm("Both", "990811", "990812");
    const SOURCE = "https://example.test/mesa-verde/both-columns.pdf";
    const parsed = parseSubListing(listing.text);
    const result = await importSubListing(
      form({ listingText: listing.text, sourceUrl: SOURCE, primeOutcome: "AWARDED", rows: keysOf(parsed) }),
    );
    // Asserted as the ERROR being absent rather than only as ok, because this is
    // the sentence the whole shape used to get.
    if (!result.ok) expect(result.error).not.toMatch(/does not read the same way/);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.leadsCreated).toBe(2);
    expect(result.value.rowsSkipped).toBe(0);

    /* Selected by NAME rather than by the import's source, because a lead does
       not record which document made it — `listedByGc` and `listedOnProject` are
       what it keeps, and the per-claim `sourceUrl` is on the signal. */
    const made = await prisma.salesLead.findMany({
      where: {
        companyId: context.company.id,
        companyName: { in: [listing.nameA, listing.nameB] },
      },
      select: { companyName: true, licenceNumber: true, registrationNumber: true },
      orderBy: { companyName: "asc" },
    });
    expect(made).toEqual([
      { companyName: listing.nameB, licenceNumber: "990812", registrationNumber: "1000030002" },
      { companyName: listing.nameA, licenceNumber: "990811", registrationNumber: "1000030001" },
    ]);
  });

  /**
   * ONE COLUMN OF THE SLOT, WHICH IS THE CASE THE ALIASING MADE IMPOSSIBLE.
   *
   * Keyed by line, `chosen[7]` was one boolean for both firms: unticking either
   * unticked both, so a reviewer could not take Ridgeline and leave Crestline.
   * This is also the case that DISCRIMINATES the fix from a near-miss — resolving
   * the selection by line PREFIX rather than by key gives the right answer when
   * both columns are ticked and the wrong one here, because it finds two rows for
   * one key and refuses the paste as unreadable. Found by mutation: that version
   * survived every other case in this describe.
   */
  it("imports one column of a slot and leaves the other alone", async () => {
    const listing = slotForm("Single", "990821", "990822");
    const parsed = parseSubListing(listing.text);
    const keys = rowKeysFor(parsed.rows);
    const sourceUrl = "https://example.test/mesa-verde/one-column.pdf";

    const result = await importSubListing(
      form({ listingText: listing.text, sourceUrl, primeOutcome: "AWARDED", rows: keys[1] }),
    );
    if (!result.ok) expect(result.error).not.toMatch(/does not read the same way/);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.leadsCreated).toBe(1);
    // The SECOND column, so this cannot pass by a reader that only ever reaches
    // the first row of a slot.
    const names = await prisma.salesLead.findMany({
      where: {
        companyId: context.company.id,
        companyName: { in: [listing.nameA, listing.nameB] },
      },
      select: { companyName: true },
    });
    expect(names.map((lead) => lead.companyName)).toEqual([listing.nameB]);
    expect(
      await prisma.salesLeadSignal.count({ where: { companyId: context.company.id, sourceUrl } }),
    ).toBe(signalsForSub(parsed.rows[1], parsed.header, "AWARDED").length);
  });

  /**
   * THE DEDUPE, FROM THE ONLY SHAPE THAT CAN REACH IT.
   *
   * A reviewer points BOTH columns at one lead they already had — a normal thing
   * to do when a form prints a firm's two divisions side by side. Each row
   * proposes five claims and two of them are byte-identical, so the lead must
   * end with EIGHT signals. Without the per-lead set being updated as it writes,
   * it ends with ten: two pairs of duplicate rows on a lead nothing in this
   * product can delete.
   *
   * Eight is asserted as an identity against the database, and the 2 shared
   * claims are counted from `signalsForSub` rather than hard-coded, so a claim
   * table that changes shape fails here saying so instead of silently agreeing.
   */
  it("writes a claim once when two rows of one slot land on one lead", async () => {
    const existing = await prisma.salesLead.create({
      data: { companyId: context.company.id, companyName: "Mesa Verde Holding Lead" },
    });
    const listing = slotForm("Onelead", "990831", "990832");
    const parsed = parseSubListing(listing.text);
    const keys = rowKeysFor(parsed.rows);

    const perRow = parsed.rows.map((row) => signalsForSub(row, parsed.header, "AWARDED"));
    const distinct = new Set(perRow.flat().map((signal) => `${signal.kind}\u0000${signal.claim}`));
    // The premise of this case: the two rows really do overlap, and not entirely.
    expect(perRow[0].length + perRow[1].length).toBeGreaterThan(distinct.size);
    expect(distinct.size).toBeGreaterThan(perRow[0].length);

    const result = await importSubListing(
      form({
        listingText: listing.text,
        sourceUrl: "https://example.test/mesa-verde/both-on-one-lead.pdf",
        primeOutcome: "AWARDED",
        rows: keys.join(","),
        [`attach:${keys[0]}`]: existing.id,
        [`attach:${keys[1]}`]: existing.id,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.leadsCreated).toBe(0);
    expect(result.value.leadsAttached).toBe(1);
    expect(result.value.signalsProposed).toBe(distinct.size);

    const written = await prisma.salesLeadSignal.count({
      where: {
        companyId: context.company.id,
        leadId: existing.id,
        sourceUrl: "https://example.test/mesa-verde/both-on-one-lead.pdf",
      },
    });
    expect(written).toBe(distinct.size);

    // And no two of them are the same sentence, which is the property rather
    // than the count: a miscount that wrote 8 duplicates of 4 claims would pass
    // the assertion above.
    const rowsWritten = await prisma.salesLeadSignal.findMany({
      where: { companyId: context.company.id, leadId: existing.id },
      select: { kind: true, claim: true },
    });
    expect(new Set(rowsWritten.map((signal) => `${signal.kind}\u0000${signal.claim}`)).size).toBe(
      rowsWritten.length,
    );
  });
});
