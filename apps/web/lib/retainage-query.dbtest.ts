import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";

/**
 * The company-wide retainage figure, against a real Postgres.
 *
 * `.dbtest.ts` because the defect was ENTIRELY in a `where` clause, and a
 * pure test structurally cannot see one. That is not a guess about #97, it
 * is its cause: #46 was fixed by extracting the summing rule into a pure,
 * well-tested helper, which left the population rule — `status IN
 * (CONTRACTED, IN_PROGRESS)` — sitting untested in a query, where it
 * quietly survived the fix and shipped the same wrong number again three
 * days later. Eight green unit tests said nothing about it.
 *
 * Run against a SCRATCH database — it creates and deletes companies:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * The fixture is the seeded demo shape (packages/db/scripts/seed-demo.mjs
 * has Cedar Park Elementary at $13,420 withheld on a COMPLETE job), so the
 * numbers below are the ones a preview actually renders.
 */

const { loadRetainageHeld } = await import("./retainage-query");
const { loadCompanyFinancials } = await import("./company-financials-query");
const { loadTodayDashboard } = await import("./today-dashboard");

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
// Pinned. loadTodayDashboard takes `now` and dates several of its other
// figures from it; a test that passed `new Date()` would drift.
const NOW = utc("2026-09-03");

let companyId = "";
let completedJobId = "";

describe("retainage held, company-wide", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Retainage Bar Co" } });
    companyId = company.id;
    const gc = await prisma.contact.create({ data: { companyId, name: "Turner GC" } });

    // The job the metric bar used to drop on the floor: finished, so its
    // retainage is exactly the money a sub is chasing, and COMPLETE, so a
    // CONTRACTED/IN_PROGRESS filter cannot see it.
    const done = await prisma.job.create({
      data: {
        companyId,
        contactId: gc.id,
        name: "Cedar Park Elementary",
        status: "COMPLETE",
        substantialCompletionDate: utc("2026-08-10"),
      },
    });
    completedJobId = done.id;
    await prisma.jobLineItem.create({
      data: { jobId: done.id, description: "Framing", quantity: "1", unitPrice: "100000" },
    });
    await prisma.invoice.create({
      data: {
        jobId: done.id,
        number: 1,
        amount: "100000",
        retainageWithheld: "13420",
        issuedAt: utc("2026-07-01"),
      },
    });

    const live = await prisma.job.create({
      data: { companyId, contactId: gc.id, name: "Harbor Point Tower", status: "IN_PROGRESS" },
    });
    await prisma.jobLineItem.create({
      data: { jobId: live.id, description: "Drywall", quantity: "1", unitPrice: "50000" },
    });
    await prisma.invoice.create({
      data: {
        jobId: live.id,
        number: 1,
        amount: "50000",
        retainageWithheld: "2500",
        issuedAt: utc("2026-08-01"),
      },
    });
  });

  afterAll(async () => {
    const jobs = await prisma.job.findMany({ where: { companyId }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    await prisma.retainageRelease.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.invoice.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("counts retainage on a COMPLETE job — the only ones whose retainage releases", async () => {
    // #97 exactly. Before the fix this read 2500: the $13,420 on the
    // finished job was dropped by a status filter written for backlog.
    expect(await loadRetainageHeld(companyId)).toBe(15920);
    expect((await loadCompanyFinancials(companyId)).retainageHeld).toBe(15920);
  });

  it("agrees with the dashboard card it renders eighteen inches below", async () => {
    // The assertion #97 is actually about, and the durable one: it does not
    // care WHICH side is right, so whichever drifts next, this goes red.
    // The static single-source guard cannot do this — it only catches
    // copies that are spelled the way it expects.
    const [bar, card] = await Promise.all([
      loadCompanyFinancials(companyId),
      loadTodayDashboard(companyId, NOW),
    ]);
    expect(bar.retainageHeld).toBe(card.retainageHeld);
    expect(card.retainageHeld).toBe(15920);
  });

  it("still scopes backlog to live jobs — the over-correction guard", async () => {
    // "No filter" is the rule for retainage ONLY. Applying it to the whole
    // function would turn backlog into "every job we ever had" and inflate
    // the first number on the same bar. $100k of the $150k on the books is
    // on the completed job and must not appear here.
    expect((await loadCompanyFinancials(companyId)).estimatedRevenue).toBe(50000);
  });

  it("counts a job with NO completion date, and one expecting completion in the FUTURE", async () => {
    // Migrated from retainage.test.ts. substantialCompletionDate is the
    // date a job is EXPECTED to reach substantial completion — a
    // forecasting anchor, not a record that it happened. An earlier fix
    // filtered on it and dropped real money held on jobs nobody had
    // forecast yet.
    const gc = await prisma.contact.findFirstOrThrow({ where: { companyId } });
    const unforecast = await prisma.job.create({
      data: { companyId, contactId: gc.id, name: "No date", status: "CONTRACTED" },
    });
    await prisma.invoice.create({
      data: { jobId: unforecast.id, number: 1, amount: "80000", retainageWithheld: "8000", issuedAt: utc("2026-08-05") },
    });
    expect(await loadRetainageHeld(companyId)).toBe(23920);

    const future = await prisma.job.create({
      data: {
        companyId,
        contactId: gc.id,
        name: "Finishing in October",
        status: "IN_PROGRESS",
        substantialCompletionDate: utc("2026-10-28"),
      },
    });
    await prisma.invoice.create({
      data: { jobId: future.id, number: 1, amount: "3000", retainageWithheld: "300", issuedAt: utc("2026-09-01") },
    });
    // The GC is holding that $300 today, whatever the forecast says.
    expect(await loadRetainageHeld(companyId)).toBe(24220);
  });

  it("drops as retainage is released, on both figures together", async () => {
    await prisma.retainageRelease.create({
      data: { jobId: completedJobId, amount: "5000", releasedAt: utc("2026-08-28") },
    });
    const [bar, card] = await Promise.all([
      loadCompanyFinancials(companyId),
      loadTodayDashboard(companyId, NOW),
    ]);
    expect(bar.retainageHeld).toBe(19220);
    expect(card.retainageHeld).toBe(19220);
  });

  it("treats a fully released job as nothing held, without clamping at zero per job", async () => {
    // The no-per-job-clamp property is load-bearing: the figure is now two
    // aggregates, SUM(withheld) − SUM(released), which equals the sum of
    // per-job balances ONLY because no job's balance is floored. Anyone
    // adding a floor has to break this.
    await prisma.retainageRelease.create({
      data: { jobId: completedJobId, amount: "8420", releasedAt: utc("2026-08-29") },
    });
    // Cedar Park is now fully released: 13420 − 5000 − 8420 = 0.
    expect(await loadRetainageHeld(companyId)).toBe(10800);
  });

  it("is zero, not NaN, for a company with no invoices at all", async () => {
    // `_sum` is null when nothing matches. Absence and zero are different
    // facts everywhere else in this codebase; for a company-wide TOTAL they
    // genuinely mean the same thing, and this pins that they collapse
    // rather than propagate.
    const empty = await prisma.company.create({ data: { name: "Retainage Empty Co" } });
    try {
      expect(await loadRetainageHeld(empty.id)).toBe(0);
    } finally {
      await prisma.company.delete({ where: { id: empty.id } });
    }
  });
});
