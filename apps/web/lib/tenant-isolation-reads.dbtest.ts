import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { createTwoTenants, destroyTenants, type TwoTenants } from "./test-support/twoTenants";
import { EXPORT_DATASETS } from "./export";
import { loadAlerts, countVisibleAlerts } from "./alerts-query";
import { loadApprenticeships, loadTeamForApprenticeship } from "./apprenticeship-query";
import { loadBidPipeline } from "./bid-pipeline-query";
import { loadCertifiedPayrollWeekEntries } from "./certified-payroll-query";
import { loadCloseoutJobs } from "./closeout-query";
import { loadCompanyFinancials } from "./company-financials-query";
import { loadDigestRecipients } from "./notification-run-query";
import { loadPayApplication } from "./pay-application-query";
import {
  loadDeterminations,
  loadReviewableWeeks,
  loadRuleSets,
  reviewJobWeek,
} from "./prevailing-wage-query";
import { loadRetainageHeld } from "./retainage-query";
import {
  loadCrafts,
  loadRatioReviews,
  loadRemittance,
  loadUnionSetup,
} from "./union-compliance-query";

/**
 * READ ISOLATION: tenant A's view contains none of tenant B's rows.
 *
 * The bug this suite exists for does not look like a bug in a diff. It
 * looks like a missing `companyId` in one `where` clause among thirty that
 * have it, and with one company on the system every one of those thirty
 * returns the same answer either way. #169 shipped exactly that way, green
 * the whole time.
 *
 * Two rules the assertions here follow:
 *
 *   1. DISJOINT AND NON-EMPTY. Asserting A's rows exclude B's is worthless
 *      if A's rows are empty — that passes with the query deleted. Every
 *      assertion below checks both sides are populated first. This repo has
 *      shipped eight tests that could not fail (#150); the cheap defence is
 *      to state what must be PRESENT as well as what must be absent.
 *   2. NUMBERS, NOT JUST IDS. The tenants hold deliberately different money
 *      and hours, so a total that pools both is a wrong number. An id-only
 *      assertion misses a leak into a `_sum` — and `loadRetainageHeld` and
 *      `loadCompanyFinancials` return bare numbers with no ids at all.
 */

let t: TwoTenants;

/** A day after every fixture date that matters, so nothing is "not yet". */
const TODAY = "2026-08-20";
const MONTH = "2026-08";
/** Monday of the week holding the fixture's time entries (17-19 Aug 2026). */
const WEEK_START = "2026-08-17";

function disjoint(left: string[], right: string[]) {
  return left.filter((x) => right.includes(x));
}

beforeAll(async () => {
  t = await createTwoTenants();
}, 60_000);

afterAll(async () => {
  await destroyTenants(t);
  await prisma.$disconnect();
});

describe("the fixture itself", () => {
  it("builds two companies that are structurally identical and share a union hall", async () => {
    expect(t.a.companyId).not.toBe(t.b.companyId);
    // Both signed the same local — the configuration every union assertion
    // below depends on. Without it those tests pass while proving nothing.
    const agreements = await prisma.companyUnionAgreement.findMany({
      where: { unionLocalId: t.shared.localId },
      select: { companyId: true },
    });
    expect(agreements.map((a) => a.companyId).sort()).toEqual(
      [t.a.companyId, t.b.companyId].sort(),
    );
    // And both tag work against the same craft classification.
    const usage = await prisma.timeEntry.count({
      where: { craftClassificationId: t.shared.craftId },
    });
    expect(usage).toBe(t.a.sharedCraftTimeEntryIds.length + t.b.sharedCraftTimeEntryIds.length);
  });
});

/**
 * The export surface, all 18 datasets, in one loop.
 *
 * This is the highest-leverage block in the suite: `EXPORT_DATASETS` is the
 * one place in the codebase where per-model tenant scoping is written down
 * as data, so every dataset can be executed the way the export route
 * executes it. Ten scope through a `companyId` column, five through
 * `job.companyId`, three through a two-hop relation — and the three deep
 * ones are where a hand-written path is most likely to be wrong.
 *
 * `export.test.ts` already checks the column allowlist never grows a
 * credential. It does NOT check that `scope` returns one tenant's rows,
 * because with one tenant there was nothing to compare against.
 */
describe("export datasets scope to one company", () => {
  type Delegate = { findMany: (args: unknown) => Promise<{ id: string }[]> };
  const delegates = prisma as unknown as Record<string, Delegate>;

  for (const dataset of EXPORT_DATASETS) {
    it(`${dataset.key}: tenant A's export contains none of tenant B's rows`, async () => {
      const [mine, theirs] = await Promise.all([
        delegates[dataset.model].findMany({ where: dataset.scope(t.a.companyId) }),
        delegates[dataset.model].findMany({ where: dataset.scope(t.b.companyId) }),
      ]);

      // Both non-empty, or the disjointness below is vacuous. If this fires
      // the fixture stopped covering this dataset — fix the fixture, do not
      // delete the assertion.
      expect(mine.length, `fixture has no ${dataset.key} rows for tenant A`).toBeGreaterThan(0);
      expect(theirs.length, `fixture has no ${dataset.key} rows for tenant B`).toBeGreaterThan(0);

      const leaked = disjoint(
        mine.map((r) => r.id),
        theirs.map((r) => r.id),
      );
      expect(leaked, `${dataset.key} leaked ${leaked.length} of tenant B's rows`).toEqual([]);
    });
  }
});

describe("money totals count one company's money only", () => {
  it("loadCompanyFinancials sums only this tenant's invoices and payments", async () => {
    const [a, b] = await Promise.all([
      loadCompanyFinancials(t.a.companyId),
      loadCompanyFinancials(t.b.companyId),
    ]);

    // Bare numbers, no ids — a leak here is invisible except as a wrong
    // total, which is exactly why these are asserted to the cent. Payment
    // and Invoice carry no companyId column, so the relation scope
    // (`invoice.job.companyId`) is the entire tenant boundary.
    expect(a.cashPosition).toBe(t.a.money.paymentAmount);
    expect(b.cashPosition).toBe(t.b.money.paymentAmount);
    expect(a.outstandingReceivable).toBe(t.a.money.invoiceAmount);
    expect(b.outstandingReceivable).toBe(t.b.money.invoiceAmount);

    // Pooling the two tenants would produce exactly this, and nothing else
    // in the result would look wrong.
    expect(a.cashPosition).not.toBe(t.a.money.paymentAmount + t.b.money.paymentAmount);
  });

  it("loadRetainageHeld nets one company's withholdings against its own releases", async () => {
    const [a, b] = await Promise.all([
      loadRetainageHeld(t.a.companyId),
      loadRetainageHeld(t.b.companyId),
    ]);
    // Each tenant: one invoice withholding 10, one release of 25.
    expect(a).toBe(10 - 25);
    expect(b).toBe(10 - 25);
    // Both tenants hold the same figure here on purpose: it means a query
    // that pooled them would return -30 and this assertion would catch it,
    // where an id-based check on a bare number cannot.
  });
});

describe("job-scoped loaders refuse another tenant's job id", () => {
  it("loadPayApplication returns null for a job belonging to the other tenant", async () => {
    // The positive control first — otherwise "returns null" proves nothing.
    const own = await loadPayApplication(t.a.jobId, t.a.invoiceId, t.a.companyId);
    expect(own).not.toBeNull();
    expect(own?.job.companyId).toBe(t.a.companyId);

    const stolen = await loadPayApplication(t.b.jobId, t.b.invoiceId, t.a.companyId);
    expect(stolen).toBeNull();
  });

  it("loadCertifiedPayrollWeekEntries returns nothing for the other tenant's job", async () => {
    const own = await loadCertifiedPayrollWeekEntries(
      t.a.companyId,
      t.a.jobId,
      new Date(`${WEEK_START}T00:00:00.000Z`),
    );
    expect(own.length).toBeGreaterThan(0);

    const stolen = await loadCertifiedPayrollWeekEntries(
      t.a.companyId,
      t.b.jobId,
      new Date(`${WEEK_START}T00:00:00.000Z`),
    );
    expect(stolen).toEqual([]);
  });

  it("reviewJobWeek returns an empty review for the other tenant's job", async () => {
    const own = await reviewJobWeek(t.a.companyId, t.a.jobId, WEEK_START);
    expect(own.jobName).not.toBeNull();
    expect(own.employees.length).toBeGreaterThan(0);

    const stolen = await reviewJobWeek(t.a.companyId, t.b.jobId, WEEK_START);
    expect(stolen.jobName).toBeNull();
    expect(stolen.employees).toEqual([]);
  });
});

describe("list loaders return one company's rows", () => {
  it("loadCloseoutJobs lists only this company's jobs", async () => {
    const [a, b] = await Promise.all([
      loadCloseoutJobs(t.a.companyId, TODAY),
      loadCloseoutJobs(t.b.companyId, TODAY),
    ]);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(disjoint(a.map((r) => r.id), b.map((r) => r.id))).toEqual([]);
    expect(a.map((r) => r.id)).toContain(t.a.jobId);
    expect(a.map((r) => r.id)).not.toContain(t.b.jobId);
  });

  it("loadBidPipeline attributes bids to the right company", async () => {
    const [a, b] = await Promise.all([
      loadBidPipeline(t.a.companyId, TODAY),
      loadBidPipeline(t.b.companyId, TODAY),
    ]);
    expect(a.rows.length).toBeGreaterThan(0);
    expect(b.rows.length).toBeGreaterThan(0);
    expect(disjoint(a.rows.map((r) => r.contactId), b.rows.map((r) => r.contactId))).toEqual([]);
    expect(disjoint(a.live.map((r) => r.id), b.live.map((r) => r.id))).toEqual([]);
    expect(a.live.map((r) => r.id)).not.toContain(t.b.bidInvitationId);
  });

  it("loadApprenticeships lists only this company's enrollments", async () => {
    const [a, b] = await Promise.all([
      loadApprenticeships(t.a.companyId, TODAY),
      loadApprenticeships(t.b.companyId, TODAY),
    ]);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(
      disjoint(a.map((r) => r.enrollmentId), b.map((r) => r.enrollmentId)),
    ).toEqual([]);
    expect(a.map((r) => r.enrollmentId)).not.toContain(t.b.apprenticeshipEnrollmentId);
    // The OJT hours aggregate keys on employeeUserId and is scoped by
    // `job: { companyId }`. Drop that clause and it sums an apprentice's
    // hours at every employer they have ever worked for.
    expect(a.every((r) => r.apprenticeUserId !== t.b.memberId)).toBe(true);
  });

  it("loadTeamForApprenticeship lists only this company's people", async () => {
    const [a, b] = await Promise.all([
      loadTeamForApprenticeship(t.a.companyId),
      loadTeamForApprenticeship(t.b.companyId),
    ]);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(disjoint(a.map((r) => r.id), b.map((r) => r.id))).toEqual([]);
    expect(a.map((r) => r.id)).not.toContain(t.b.ownerId);
  });

  it("loadRuleSets and loadDeterminations stay within the company", async () => {
    const [ruleSetsA, ruleSetsB] = await Promise.all([
      loadRuleSets(t.a.companyId),
      loadRuleSets(t.b.companyId),
    ]);
    expect(ruleSetsA.length).toBeGreaterThan(0);
    expect(ruleSetsB.length).toBeGreaterThan(0);
    expect(disjoint(ruleSetsA.map((r) => r.id), ruleSetsB.map((r) => r.id))).toEqual([]);

    // jobNames is a relation traversal to a table with no companyId of its
    // own — the #169 shape, one hop removed. It must never name the other
    // tenant's job.
    const namesA = ruleSetsA.flatMap((r) => r.jobNames);
    expect(namesA.some((n) => n.includes(`Job ${t.a.label}`))).toBe(true);
    expect(namesA.some((n) => n.includes(`Job ${t.b.label}`))).toBe(false);

    const [detA, detB] = await Promise.all([
      loadDeterminations(t.a.companyId),
      loadDeterminations(t.b.companyId),
    ]);
    expect(detA.length).toBeGreaterThan(0);
    expect(detB.length).toBeGreaterThan(0);
    expect(disjoint(detA.map((r) => r.id), detB.map((r) => r.id))).toEqual([]);
    expect(detA.map((r) => r.jobId)).not.toContain(t.b.jobId);
  });

  it("loadReviewableWeeks lists only this company's job weeks", async () => {
    const [a, b] = await Promise.all([
      loadReviewableWeeks(t.a.companyId),
      loadReviewableWeeks(t.b.companyId),
    ]);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.map((r) => r.jobId)).not.toContain(t.b.jobId);
    expect(b.map((r) => r.jobId)).not.toContain(t.a.jobId);
  });

  it("loadAlerts raises alerts about this company only", async () => {
    const [a, b] = await Promise.all([
      loadAlerts(t.a.companyId, t.a.ownerId, TODAY),
      loadAlerts(t.b.companyId, t.b.ownerId, TODAY),
    ]);
    const keysA = [...a.visible, ...a.silenced].map((x) => x.key);
    const keysB = [...b.visible, ...b.silenced].map((x) => x.key);
    expect(keysA.length).toBeGreaterThan(0);
    expect(keysB.length).toBeGreaterThan(0);
    expect(disjoint(keysA, keysB)).toEqual([]);

    // An Alert carries no companyId, so the ids embedded in its key and
    // href are the only trace of which company it is about.
    const blob = JSON.stringify([...a.visible, ...a.silenced]);
    expect(blob).not.toContain(t.b.jobId);
    expect(blob).not.toContain(t.b.backchargeId);
    expect(blob).not.toContain(t.b.companyId);

    const count = await countVisibleAlerts(t.a.companyId, t.a.ownerId, TODAY);
    expect(count).toBe(a.visible.length);
  });
});

/**
 * The nightly digest is the one read that is SUPPOSED to span tenants, and
 * asserting the opposite would be the easiest way for someone to "fix" a
 * failing isolation suite by breaking the cron. Pinned deliberately: it
 * must see both companies, and every row must carry its own user's company.
 */
describe("the cron recipient list is global on purpose", () => {
  it("loadDigestRecipients sees both companies and attributes each user correctly", async () => {
    const recipients = await loadDigestRecipients();
    const byId = new Map(recipients.map((r) => [r.id, r]));

    expect(byId.get(t.a.ownerId)?.companyId).toBe(t.a.companyId);
    expect(byId.get(t.b.ownerId)?.companyId).toBe(t.b.companyId);
    // Not a leak: this list is how each person's own digest gets built,
    // and the tenant boundary is applied downstream from RunRecipient
    // .companyId. See the block comment in notification-run-query.ts.
  });
});

/**
 * THE GLOBAL UNION REFERENCE TABLES.
 *
 * UnionLocal, CraftClassification, FringeRateSchedule and
 * ApprenticeRatioRule carry no companyId. The access check everywhere is
 * "does this company hold an agreement with the local" — and two
 * contractors signing the same hall is the ordinary case in this trade, not
 * an edge case. That is the configuration the fixture builds, and it is the
 * only one under which any of this is observable.
 */
describe("union reference data", () => {
  it("a company never sees a local it holds no agreement with", async () => {
    const [a, b] = await Promise.all([loadCrafts(t.a.companyId), loadCrafts(t.b.companyId)]);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);

    // Each tenant's OWN local is invisible to the other.
    expect(a.map((c) => c.unionLocalId)).not.toContain(t.b.unionLocalId);
    expect(b.map((c) => c.unionLocalId)).not.toContain(t.a.unionLocalId);
    expect(a.map((c) => c.id)).not.toContain(t.b.craftClassificationId);
    expect(b.map((c) => c.id)).not.toContain(t.a.craftClassificationId);

    // Both DO see the shared local's craft — that is the design, and
    // pinning it here means a future change to the access join has to be
    // deliberate rather than incidental.
    expect(a.map((c) => c.id)).toContain(t.shared.craftId);
    expect(b.map((c) => c.id)).toContain(t.shared.craftId);
  });

  it("loadUnionSetup lists only locals this company signed with", async () => {
    const [a, b] = await Promise.all([
      loadUnionSetup(t.a.companyId),
      loadUnionSetup(t.b.companyId),
    ]);
    expect(a.map((r) => r.unionLocalId)).toContain(t.a.unionLocalId);
    expect(a.map((r) => r.unionLocalId)).not.toContain(t.b.unionLocalId);
    expect(b.map((r) => r.unionLocalId)).not.toContain(t.a.unionLocalId);
    expect(disjoint(a.map((r) => r.agreementId), b.map((r) => r.agreementId))).toEqual([]);
  });

  /**
   * PENDING — THIS IS BUG #169 AND IT IS LIVE ON `main`.
   *
   * `loadUnionSetup` builds `usageCount` from a relation `_count` on
   * CraftClassification, which is a GLOBAL table. The four counted
   * relations (timeEntries, jobLineItems, catalogEntries, dispatchSlips)
   * are not filtered to the viewing company, so the "N records tagged"
   * a contractor reads on their own screen is every contractor's total
   * under that hall.
   *
   * The fixture makes the two tenants' counts differ on purpose: tenant A
   * hangs 4 rows off the shared craft and tenant B hangs 3, so a pooled
   * count reads 7 to both and neither tenant's own records justify it.
   *
   * Skipped, not fixed: a fix exists on `cyrus/union-count-company-scope`
   * (commit 011fd85) and belongs in that reviewed PR, not buried in a test
   * change. Un-skip when that lands. Note that the DELETE guard's count is
   * global ON PURPOSE and must stay that way — scoping it would let one
   * contractor delete a classification another has costed work against.
   */
  it.skip("KNOWN FAILURE (#169): usageCount counts only the viewing company's records", async () => {
    const a = await loadUnionSetup(t.a.companyId);
    const sharedLocal = a.find((r) => r.unionLocalId === t.shared.localId);
    const sharedCraft = sharedLocal?.crafts.find((c) => c.id === t.shared.craftId);
    expect(sharedCraft).toBeDefined();
    expect(sharedCraft?.usageCount).toBe(t.a.sharedCraftUsageCount);

    const b = await loadUnionSetup(t.b.companyId);
    const sharedCraftB = b
      .find((r) => r.unionLocalId === t.shared.localId)
      ?.crafts.find((c) => c.id === t.shared.craftId);
    expect(sharedCraftB?.usageCount).toBe(t.b.sharedCraftUsageCount);
  });

  /**
   * PENDING — a design question, not a clear defect, and deliberately not
   * "fixed" here.
   *
   * FringeRateSchedule is global and hangs off a craft classification two
   * companies can both use. `loadRemittance` takes the schedule in force by
   * effective date, so whichever contractor entered the later one prices
   * BOTH contractors' remittance — the money on a document that goes to a
   * union trust fund.
   *
   * There is a real argument that this is correct: a negotiated fringe rate
   * IS a hall-wide fact, and two signatories genuinely do pay the same. The
   * problem is not that the rate is shared, it is that nothing verifies who
   * may write it — `createUnionLocalAndAgreement` adopts a local on a typed
   * local number with no check, so any tenant can move any other tenant's
   * remittance total.
   *
   * Recorded rather than changed: picking a behaviour here is a product
   * decision with money attached, and it needs Cyrus and Diego, not a test.
   */
  it.skip("OPEN QUESTION: one tenant's fringe rate does not price another's remittance", async () => {
    const a = await loadRemittance(t.a.companyId, MONTH);
    const sharedCraftRow = a.locals
      .find((l) => l.unionLocalId === t.shared.localId)
      ?.crafts.find((c) => c.craftClassificationId === t.shared.craftId);
    expect(sharedCraftRow).toBeDefined();
    // Tenant A's own schedule sets pension = its own `quantity`; tenant B's
    // later-dated schedule sets a different one and currently wins.
    const hours = t.a.sharedCraftTimeEntryIds.length * 8;
    expect(sharedCraftRow?.components.pension).toBe(hours * t.a.money.quantity);
  });

  /**
   * PENDING — same family as the fringe-rate question above.
   *
   * ApprenticeRatioRule is global. Both tenants wrote one against the
   * shared local with different numbers, and the loader keeps exactly one
   * per local — the most recently created. So the ratio a contractor is
   * judged compliant or non-compliant against can be the one the OTHER
   * contractor typed. Compliance verdicts, not just display.
   */
  it.skip("OPEN QUESTION: the governing apprentice ratio is this company's own rule", async () => {
    const reviews = await loadRatioReviews(t.a.companyId, MONTH);
    const shared = reviews.find((r) => r.unionLocalId === t.shared.localId);
    expect(shared?.rule?.programStandardReference).toContain(`Standard ${t.a.label}`);
  });

  it("remittance and ratio reviews count only this company's hours", async () => {
    const [remitA, remitB] = await Promise.all([
      loadRemittance(t.a.companyId, MONTH),
      loadRemittance(t.b.companyId, MONTH),
    ]);
    // TimeEntry is scoped by `job: { companyId }` — this part is right, and
    // it is worth pinning separately from the rate question above, because
    // the hours and the price they are multiplied by fail independently.
    const hoursA = 8 * (1 + t.a.sharedCraftTimeEntryIds.length);
    const hoursB = 5 * (1 + t.b.sharedCraftTimeEntryIds.length);
    expect(remitA.totalHours).toBe(hoursA);
    expect(remitB.totalHours).toBe(hoursB);
    expect(remitA.totalHours).not.toBe(hoursA + hoursB);

    const [ratioA, ratioB] = await Promise.all([
      loadRatioReviews(t.a.companyId, MONTH),
      loadRatioReviews(t.b.companyId, MONTH),
    ]);
    expect(ratioA.map((r) => r.jobId)).not.toContain(t.b.jobId);
    expect(ratioB.map((r) => r.jobId)).not.toContain(t.a.jobId);
  });
});
