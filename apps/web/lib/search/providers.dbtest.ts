import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { SEARCH_PROVIDERS } from "./providers";

/**
 * Tenancy, against a real Postgres — the one bug class this app cannot
 * survive ("A result from another company's data is the worst possible
 * bug in this product," per the founder's ask). Unit tests cover
 * capability filtering with fake providers (query.test.ts); this file
 * exists because tenancy scoping is a real Prisma `where` clause joining
 * through `job.companyId` for two of the ten providers, and the only way
 * to prove a join is correct is to run it.
 *
 * ONE search per provider TYPE, run directly against `provider.search()`
 * bypassing `globalSearch`'s capability filter on purpose — that filter is
 * already proven not to call a disallowed provider at all
 * (query.test.ts's "never calls a gated provider's search function"
 * test). What is NOT yet proven, and what this file proves, is that once
 * a provider IS allowed to run, its own query cannot cross into another
 * company's rows.
 *
 * Every fixture title carries the shared marker XSEARCHMARK plus which
 * company it belongs to, so a single query ("XSEARCHMARK") is a real
 * search that would hit both companies' rows if either provider's `where`
 * dropped its companyId (or job.companyId) filter.
 */

let companyAId = "";
let companyBId = "";
let jobAId = "";
let jobBId = "";

const MARKER = "XSEARCHMARK";

beforeAll(async () => {
  const [companyA, companyB] = await Promise.all([
    prisma.company.create({ data: { name: "Search Tenancy Test Co A" } }),
    prisma.company.create({ data: { name: "Search Tenancy Test Co B" } }),
  ]);
  companyAId = companyA.id;
  companyBId = companyB.id;

  const [contactA, contactB] = await Promise.all([
    prisma.contact.create({ data: { companyId: companyAId, name: `${MARKER} Contact A` } }),
    prisma.contact.create({ data: { companyId: companyBId, name: `${MARKER} Contact B` } }),
  ]);

  const [jobA, jobB] = await Promise.all([
    prisma.job.create({ data: { companyId: companyAId, contactId: contactA.id, name: `${MARKER} Job A` } }),
    prisma.job.create({ data: { companyId: companyBId, contactId: contactB.id, name: `${MARKER} Job B` } }),
  ]);
  jobAId = jobA.id;
  jobBId = jobB.id;

  await Promise.all([
    prisma.user.create({
      data: { companyId: companyAId, clerkId: `clerk_search_a_${Date.now()}`, email: `search-a-${Date.now()}@example.test`, name: `${MARKER} User A` },
    }),
    prisma.user.create({
      data: { companyId: companyBId, clerkId: `clerk_search_b_${Date.now()}`, email: `search-b-${Date.now()}@example.test`, name: `${MARKER} User B` },
    }),
    prisma.vendor.create({ data: { companyId: companyAId, name: `${MARKER} Vendor A` } }),
    prisma.vendor.create({ data: { companyId: companyBId, name: `${MARKER} Vendor B` } }),
    prisma.rfi.create({ data: { companyId: companyAId, jobId: jobAId, number: 1, subject: `${MARKER} Rfi A`, question: "q" } }),
    prisma.rfi.create({ data: { companyId: companyBId, jobId: jobBId, number: 1, subject: `${MARKER} Rfi B`, question: "q" } }),
    prisma.submittal.create({ data: { companyId: companyAId, jobId: jobAId, number: 1, title: `${MARKER} Submittal A` } }),
    prisma.submittal.create({ data: { companyId: companyBId, jobId: jobBId, number: 1, title: `${MARKER} Submittal B` } }),
    prisma.punchListItem.create({ data: { companyId: companyAId, jobId: jobAId, description: `${MARKER} Punch A` } }),
    prisma.punchListItem.create({ data: { companyId: companyBId, jobId: jobBId, description: `${MARKER} Punch B` } }),
    prisma.drawingSet.create({ data: { companyId: companyAId, jobId: jobAId, name: `${MARKER} Drawing A` } }),
    prisma.drawingSet.create({ data: { companyId: companyBId, jobId: jobBId, name: `${MARKER} Drawing B` } }),
    prisma.changeOrder.create({ data: { jobId: jobAId, number: 1, title: `${MARKER} CO A` } }),
    prisma.changeOrder.create({ data: { jobId: jobBId, number: 1, title: `${MARKER} CO B` } }),
    prisma.invoice.create({ data: { jobId: jobAId, number: 1, amount: "1000.00", description: `${MARKER} Invoice A` } }),
    prisma.invoice.create({ data: { jobId: jobBId, number: 1, amount: "2000.00", description: `${MARKER} Invoice B` } }),
  ]);
});

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { jobId: { in: [jobAId, jobBId] } } });
  await prisma.changeOrder.deleteMany({ where: { jobId: { in: [jobAId, jobBId] } } });
  await prisma.drawingSet.deleteMany({ where: { jobId: { in: [jobAId, jobBId] } } });
  await prisma.punchListItem.deleteMany({ where: { jobId: { in: [jobAId, jobBId] } } });
  await prisma.submittal.deleteMany({ where: { jobId: { in: [jobAId, jobBId] } } });
  await prisma.rfi.deleteMany({ where: { jobId: { in: [jobAId, jobBId] } } });
  await prisma.vendor.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
  await prisma.user.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
  await prisma.job.deleteMany({ where: { id: { in: [jobAId, jobBId] } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId] } } });
  await prisma.$disconnect();
});

const providerByType = new Map(SEARCH_PROVIDERS.map((provider) => [provider.type, provider]));

/**
 * The literal text each provider's OWN fixture puts in front of the
 * caller, and the literal text the OTHER company's fixture puts in front
 * of the caller if the tenancy filter is missing. Per-provider, not one
 * shared suffix, because `invoiceProvider`'s title is deliberately just
 * "Invoice #1 — $1,000.00" (no job name — see providers.ts) and only its
 * SUBTITLE carries the job name a leak would actually show up in.
 */
const MARKERS: Record<string, [own: string, other: string]> = {
  job: ["Job A", "Job B"],
  contact: ["Contact A", "Contact B"],
  crew: ["User A", "User B"],
  vendor: ["Vendor A", "Vendor B"],
  rfi: ["Rfi A", "Rfi B"],
  submittal: ["Submittal A", "Submittal B"],
  punchListItem: ["Punch A", "Punch B"],
  drawing: ["Drawing A", "Drawing B"],
  changeOrder: ["CO A", "CO B"],
  invoice: ["Job A", "Job B"], // invoice's own title carries no marker; its subtitle carries the job name.
};

describe("every search provider — tenancy against a real database", () => {
  it("the fixtures in this file cover every registered provider — if a type is missing here, add its fixture before trusting this suite", () => {
    // Independent of SEARCH_PROVIDERS.length itself: this is the list of
    // types THIS FILE knows how to seed, checked against the registry so a
    // provider added later without a fixture here fails loudly instead of
    // quietly never being tenancy-tested.
    expect(Object.keys(MARKERS).sort()).toEqual([...providerByType.keys()].sort());
  });

  it.each(Object.keys(MARKERS))("%s: a query matching both companies' rows returns only the caller's own", async (type) => {
    const provider = providerByType.get(type)!;
    const [own, other] = MARKERS[type];
    const resultsA = await provider.search({ companyId: companyAId, query: MARKER, terms: [MARKER.toLowerCase()], limit: 20 });
    const resultsB = await provider.search({ companyId: companyBId, query: MARKER, terms: [MARKER.toLowerCase()], limit: 20 });

    expect(resultsA.length, `${type}: expected at least one result scoped to company A`).toBeGreaterThan(0);
    expect(resultsB.length, `${type}: expected at least one result scoped to company B`).toBeGreaterThan(0);

    for (const result of resultsA) {
      const text = `${result.title} ${result.subtitle ?? ""}`;
      expect(text, `${type}, scoped to company A: expected to see "${own}"`).toContain(own);
      expect(text, `${type}, scoped to company A: leaked company B's "${other}"`).not.toContain(other);
    }
    for (const result of resultsB) {
      const text = `${result.title} ${result.subtitle ?? ""}`;
      expect(text, `${type}, scoped to company B: expected to see "${other}"`).toContain(other);
      expect(text, `${type}, scoped to company B: leaked company A's "${own}"`).not.toContain(own);
    }
  });
});
