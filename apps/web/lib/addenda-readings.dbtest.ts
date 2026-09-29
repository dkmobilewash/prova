import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { normaliseReference } from "./addenda-overlap";

/**
 * READING AN ADDENDUM TWICE MUST NOT LOSE WHAT SOMEBODY DECIDED THE FIRST TIME.
 *
 * This file exists because the first design of this feature would have failed
 * it, and every unit test would have stayed green while it did.
 *
 * That design keyed an estimator's per-item decisions to the READING, copying
 * `PlanSheetProposal`. The copy does not survive the difference between them:
 * `PlanSheetProposal` is keyed `[ingestJobId, pageNumber]` and a re-run lines up
 * with the first run because PAGE 12 IS PAGE 12 IN EVERY RUN. An addendum's
 * items have no such key — `ordinal` is the model's ordering within one run, and
 * `label`, `reference` and `summary` are free text a second pass words
 * differently. So a decision hung off a reading is discarded the moment anybody
 * reads the document again, and every item comes back as though nobody had ever
 * looked at it. `plan-ingest.prisma` and `intake.prisma` both refuse exactly
 * that ("not proposed afresh as though nobody had looked at it").
 *
 * So decisions are keyed on `[bidAddendumId, normalisedReference]` — on the
 * ADDENDUM and the SCOPE. What is asserted below is the property that makes
 * that worth the second table, and it cannot be asserted without a database:
 * the behaviour under test IS the row semantics.
 *
 * The other half is the readings themselves being APPEND-ONLY. A re-read must
 * insert, never update, so the reason an estimator was shown stays the reason
 * they were actually shown.
 */

let companyId = "";
let contactId = "";
let bidId = "";
let addendumId = "";
let secondAddendumId = "";

/** The same scope, worded three ways, as two runs of a model and a GC would. */
const SPELLINGS = ["Section 09 21 16", "09 21 16", "09-21-16"];

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Addenda Reading Test Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  contactId = contact.id;

  const bid = await prisma.bidInvitation.create({
    data: { companyId, contactId, projectName: "Addenda test project" },
  });
  bidId = bid.id;

  const addendum = await prisma.bidAddendum.create({
    data: { companyId, bidInvitationId: bidId, reference: "Addendum 3" },
  });
  addendumId = addendum.id;

  const second = await prisma.bidAddendum.create({
    data: { companyId, bidInvitationId: bidId, reference: "Addendum 5" },
  });
  secondAddendumId = second.id;
});

afterAll(async () => {
  // Readings and decisions cascade from BidAddendum, which cascades from
  // BidInvitation — so deleting the invitation reaches all four. The company
  // delete is last because `Company` is a RESTRICT parent of the invitation.
  await prisma.bidAddendum.deleteMany({ where: { companyId } });
  await prisma.bidInvitation.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

async function read(addendum: string, spelling: string, summary: string) {
  return prisma.bidAddendumReading.create({
    data: {
      bidAddendumId: addendum,
      bidInvitationId: bidId,
      items: [
        {
          ordinal: 1,
          label: "Item 4",
          reference: spelling,
          referenceKind: "SPEC_SECTION",
          summary,
          reason: "the letter says so",
          confidence: "HIGH",
          sourcePageLabel: "Page 2",
        },
      ],
      readingReason: "clean scan",
      proposedIssueDateText: "3 October 2026",
      proposedBidDateText: null,
      pagesCharged: 4,
      model: "claude-opus-5",
      promptVersion: "bid-addendum.1",
    },
  });
}

describe("a decision survives the document being read again", () => {
  it("keeps a NOT_MINE across a re-read that words the reference differently", async () => {
    await read(addendumId, SPELLINGS[0]!, "partition types revised");

    await prisma.bidAddendumItemDecision.create({
      data: {
        bidAddendumId: addendumId,
        normalisedReference: normaliseReference(SPELLINGS[0]!),
        displayReference: SPELLINGS[0]!,
        decision: "NOT_MINE",
      },
    });

    // The second reading words it differently, which is the whole hazard: a key
    // built from the model's own text would not match.
    await read(addendumId, SPELLINGS[1]!, "partition types revised again");

    const decisions = await prisma.bidAddendumItemDecision.findMany({
      where: { bidAddendumId: addendumId },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decision).toBe("NOT_MINE");

    // And it is reachable from the NEW reading's item, which is the property the
    // screen depends on: the estimator sees their own decision against the
    // freshly-read item rather than being asked again.
    const newest = await prisma.bidAddendumReading.findFirst({
      where: { bidAddendumId: addendumId },
      orderBy: { createdAt: "desc" },
    });
    const items = newest!.items as { reference: string }[];
    expect(normaliseReference(items[0]!.reference)).toBe(decisions[0]!.normalisedReference);
  });

  it("matches a third spelling the same way", async () => {
    await read(addendumId, SPELLINGS[2]!, "partition types, third wording");
    const newest = await prisma.bidAddendumReading.findFirst({
      where: { bidAddendumId: addendumId },
      orderBy: { createdAt: "desc" },
    });
    const items = newest!.items as { reference: string }[];
    const decision = await prisma.bidAddendumItemDecision.findUnique({
      where: {
        bidAddendumId_normalisedReference: {
          bidAddendumId: addendumId,
          normalisedReference: normaliseReference(items[0]!.reference),
        },
      },
    });
    expect(decision?.decision).toBe("NOT_MINE");
  });

  it("lets the estimator change their mind without a second row", async () => {
    await prisma.bidAddendumItemDecision.update({
      where: {
        bidAddendumId_normalisedReference: {
          bidAddendumId: addendumId,
          normalisedReference: normaliseReference(SPELLINGS[0]!),
        },
      },
      data: { decision: "MINE" },
    });
    const decisions = await prisma.bidAddendumItemDecision.findMany({
      where: { bidAddendumId: addendumId },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decision).toBe("MINE");
  });

  it("keeps a decision to ONE addendum — the same scope on another is undecided", async () => {
    // The key is [addendum, scope], not [bid, scope], and that is deliberate:
    // deciding that 09 21 16 is not yours in Addendum 3 says nothing about
    // whether Addendum 5 changing it matters. A bid-wide key would silence the
    // second letter, which is the one the feature exists to catch.
    await read(secondAddendumId, SPELLINGS[1]!, "partition types revised AGAIN");
    const onSecond = await prisma.bidAddendumItemDecision.findUnique({
      where: {
        bidAddendumId_normalisedReference: {
          bidAddendumId: secondAddendumId,
          normalisedReference: normaliseReference(SPELLINGS[1]!),
        },
      },
    });
    expect(onSecond).toBeNull();
  });
});

describe("readings are append-only", () => {
  it("keeps every reading, so the reason somebody was shown is still on file", async () => {
    const readings = await prisma.bidAddendumReading.findMany({
      where: { bidAddendumId: addendumId },
      orderBy: { createdAt: "asc" },
    });
    // Three reads above, three rows. A re-read that UPDATED would leave one and
    // would have quietly rewritten the reason an estimator acted on.
    expect(readings).toHaveLength(3);
    const summaries = readings.map((r) => (r.items as { summary: string }[])[0]!.summary);
    expect(summaries).toEqual([
      "partition types revised",
      "partition types revised again",
      "partition types, third wording",
    ]);
  });

  it("allows two addenda on one bid to share a reference", async () => {
    // `BidAddendum` has no unique on `reference` and deliberately so — the
    // number is the GC's, and "3" arriving twice is their error to make. A
    // constraint here would refuse a real document.
    const twin = await prisma.bidAddendum.create({
      data: { companyId, bidInvitationId: bidId, reference: "Addendum 3" },
    });
    expect(twin.reference).toBe("Addendum 3");
    await prisma.bidAddendum.delete({ where: { id: twin.id } });
  });
});

describe("what deleting reaches", () => {
  it("takes readings and decisions with the addendum", async () => {
    const doomed = await prisma.bidAddendum.create({
      data: { companyId, bidInvitationId: bidId, reference: "Addendum 9" },
    });
    await read(doomed.id, "Sheet A-201", "grid revised");
    await prisma.bidAddendumItemDecision.create({
      data: {
        bidAddendumId: doomed.id,
        normalisedReference: normaliseReference("Sheet A-201"),
        displayReference: "Sheet A-201",
        decision: "MINE",
      },
    });

    // A plain delete, with no cleanup of the children — which is what
    // `deleteBidAddendum` does. If either child were RESTRICT rather than
    // CASCADE this throws, and an estimator could not delete an addendum they
    // had read. That is the shape #224 paid for with InvoiceCounter.
    await prisma.bidAddendum.delete({ where: { id: doomed.id } });

    expect(await prisma.bidAddendumReading.count({ where: { bidAddendumId: doomed.id } })).toBe(0);
    expect(await prisma.bidAddendumItemDecision.count({ where: { bidAddendumId: doomed.id } })).toBe(0);
  });
});
