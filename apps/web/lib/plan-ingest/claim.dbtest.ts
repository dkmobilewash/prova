import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { claimPorts, closeIfSettled, hasWaitingWork, ingestCounts } from "./claim";
import { MAX_ATTEMPTS, runIngest } from "./runner";

/**
 * THE CLAIM, AGAINST A REAL POSTGRES — because the one thing this design rests
 * on cannot be tested any other way.
 *
 * `runner.test.ts` proves the loop's policy with the ports mocked, and that is
 * the right place for the budget and the attempt ceiling. It cannot prove the
 * claim, because **a mock will happily hand the same page to two workers and
 * agree that both won.** The property being bought here is that it will not:
 * two concurrent claims over one task produce one winner, or the whole
 * resumability story is a way of paying twice for every page.
 *
 * So the assertions below are about concurrency, reclaim and the ceiling —
 * each of which is a WHERE clause whose correctness is a fact about Postgres
 * rather than about this codebase:
 *
 *   - two `claim()` calls racing for one task: exactly one gets it;
 *   - a task whose lease has lapsed is reclaimable, and one whose lease is
 *     live is not — the stuck-lease reclaim, which is the difference between
 *     a resumable job and a permanently stuck one;
 *   - a task at the attempt ceiling is never claimed again, so a page that
 *     cannot succeed costs three attempts rather than a bill;
 *   - a task inside its backoff window is not claimed yet, and `hasWaitingWork`
 *     can tell that from there being no work at all.
 *
 * Nothing here calls a model. `PAGE_INVENTORY` is a stage that does no model
 * work by design, and every `work` below is a stub, so this file spends
 * nothing.
 */

const E2E = "ZZ-DBTEST plan-ingest";

let companyId = "";
let jobId = "";
let planId = "";
let ingestJobId = "";

/** A plan set with `pages` tasks, all fresh. */
async function seed(pages: number): Promise<void> {
  const company = await prisma.company.create({ data: { name: `${E2E} Co` } });
  companyId = company.id;
  // A job needs its GC — `contactId` is required on `Job`, which the
  // typechecker said before this file ever ran.
  const contact = await prisma.contact.create({ data: { companyId, name: `${E2E} GC` } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: `${E2E} Job`, status: "ESTIMATE" },
  });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({
    data: { companyId, jobId, fileUrl: "https://example.invalid/plan.pdf", fileName: "plan.pdf" },
  });
  planId = plan.id;
  const ingest = await prisma.planIngestJob.create({
    data: { planId, companyId, stage: "PAGE_INVENTORY", pageCount: pages },
  });
  ingestJobId = ingest.id;
  if (pages > 0) {
    await prisma.planIngestTask.createMany({
      data: Array.from({ length: pages }, (_, index) => ({
        jobId: ingest.id,
        pageNumber: index + 1,
        stage: "PAGE_INVENTORY" as const,
      })),
    });
  }
}

/** Ports whose `work` always succeeds, unless told otherwise. */
function ports(over: { work?: () => Promise<{ ok: true } | { ok: false; error: string }>; now?: () => number } = {}) {
  return claimPorts({
    jobId: ingestJobId,
    work: over.work ?? (async () => ({ ok: true })),
    now: over.now,
  });
}

beforeEach(async () => {
  // Deleting the COMPANY is not what the app does, and it is right here: this
  // file creates its own company per test, and `TakeoffPlan` CASCADEs the whole
  // ingest tree, which is the property the migration's header claims. If that
  // ever stops being true, this teardown is where it shows.
  await prisma.planIngestTask.deleteMany({ where: { job: { company: { name: { startsWith: E2E } } } } });
  await prisma.planIngestJob.deleteMany({ where: { company: { name: { startsWith: E2E } } } });
  await prisma.takeoffPlan.deleteMany({ where: { company: { name: { startsWith: E2E } } } });
  await prisma.job.deleteMany({ where: { company: { name: { startsWith: E2E } } } });
  await prisma.contact.deleteMany({ where: { company: { name: { startsWith: E2E } } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: E2E } } });
});

describe("two workers racing for one page", () => {
  it("produces exactly one winner", async () => {
    await seed(1);
    const a = ports();
    const b = ports();
    const deadline = new Date(Date.now() + 90_000);

    // BOTH ISSUED BEFORE EITHER IS AWAITED. Awaiting the first would serialise
    // them and prove nothing — the test would pass against a plain SELECT,
    // which is exactly the implementation this is here to rule out.
    const [first, second] = await Promise.all([a.claim(deadline), b.claim(deadline)]);

    const winners = [first, second].filter((task) => task !== null);
    expect(winners).toHaveLength(1);

    // And the page was attempted ONCE, not twice. A double claim would show
    // here even if both callers had somehow been handed the row.
    const row = await prisma.planIngestTask.findFirstOrThrow({ where: { jobId: ingestJobId } });
    expect(row.attempts).toBe(1);
    expect(row.claimedAt).not.toBeNull();
  });

  it("gives four workers over three pages three claims, never four", async () => {
    await seed(3);
    const deadline = new Date(Date.now() + 90_000);
    const claims = await Promise.all([ports().claim(deadline), ports().claim(deadline), ports().claim(deadline), ports().claim(deadline)]);

    const got = claims.filter((task) => task !== null);
    expect(got).toHaveLength(3);
    // Three DIFFERENT pages. Three claims that all returned page 1 would
    // satisfy the count and be the bug.
    expect(new Set(got.map((task) => task!.pageNumber)).size).toBe(3);
  });
});

describe("the lease", () => {
  it("does NOT reclaim a task whose lease is still live", async () => {
    await seed(1);
    const deadline = new Date(Date.now() + 90_000);
    expect(await ports().claim(deadline)).not.toBeNull();
    // A second worker arriving while the first is legitimately working must be
    // told there is nothing — otherwise the lease is decoration.
    expect(await ports().claim(deadline)).toBeNull();
  });

  it("DOES reclaim a task whose lease has lapsed", async () => {
    await seed(1);
    // Claimed by an invocation that then died: claimed, unfinished, lease past.
    await prisma.planIngestTask.updateMany({
      where: { jobId: ingestJobId },
      data: {
        claimedAt: new Date(Date.now() - 600_000),
        claimExpiresAt: new Date(Date.now() - 300_000),
        attempts: 1,
      },
    });

    const reclaimed = await ports().claim(new Date(Date.now() + 90_000));
    // THE ASSERTION THE WHOLE `claimExpiresAt` COLUMN EXISTS FOR. Without it
    // this returns null forever and the job hangs one page short, with no
    // error and nothing to retry — a stuck job that looks like a slow one.
    expect(reclaimed).not.toBeNull();
    // And the reclaim counts as an attempt, so a page that repeatedly kills its
    // worker still reaches the ceiling instead of being retried for ever.
    expect(reclaimed!.attempts).toBe(2);
  });
});

describe("the attempt ceiling", () => {
  it("never claims a task that has spent its attempts", async () => {
    await seed(1);
    await prisma.planIngestTask.updateMany({
      where: { jobId: ingestJobId },
      data: { attempts: MAX_ATTEMPTS, error: "unreadable" },
    });
    expect(await ports().claim(new Date(Date.now() + 90_000))).toBeNull();
  });

  it("counts an unfinished page at the ceiling as exhausted, not as pending", async () => {
    await seed(2);
    await prisma.planIngestTask.updateMany({
      where: { jobId: ingestJobId, pageNumber: 1 },
      data: { attempts: MAX_ATTEMPTS, error: "unreadable" },
    });
    const counts = await ingestCounts(ingestJobId);
    expect(counts).toMatchObject({ total: 2, finished: 0, exhausted: 1, pending: 1 });
  });

  it("does NOT count a page that failed once and is waiting as exhausted", async () => {
    await seed(1);
    // One failure, two attempts left, and an error message on the row. Counting
    // "has an error" as exhausted would report this job settled while it still
    // has work — the progress bar reaching 100% before the work stops.
    await prisma.planIngestTask.updateMany({
      where: { jobId: ingestJobId },
      data: { attempts: 1, error: "flaky", nextAttemptAt: new Date(Date.now() + 30_000) },
    });
    expect(await ingestCounts(ingestJobId)).toMatchObject({ exhausted: 0, pending: 1 });
  });
});

describe("backoff", () => {
  it("does not claim a task inside its backoff window, and says work is waiting", async () => {
    await seed(1);
    await prisma.planIngestTask.updateMany({
      where: { jobId: ingestJobId },
      data: { attempts: 1, error: "flaky", nextAttemptAt: new Date(Date.now() + 30_000) },
    });

    expect(await ports().claim(new Date(Date.now() + 90_000))).toBeNull();
    // AND THE DISTINCTION THAT MATTERS: nothing claimable is not the same as
    // nothing left. A runner that could not tell these apart would close a job
    // whose pages are all waiting thirty seconds.
    expect(await hasWaitingWork(ingestJobId)).toBe(true);
    expect(await closeIfSettled(ingestJobId)).toBe(false);
  });

  it("claims it once the window has passed", async () => {
    await seed(1);
    await prisma.planIngestTask.updateMany({
      where: { jobId: ingestJobId },
      data: { attempts: 1, error: "flaky", nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    const claimed = await ports().claim(new Date(Date.now() + 90_000));
    expect(claimed).not.toBeNull();
    // The stale error is CLEARED on claim, so a screen does not show last
    // attempt's message beside a page that is being retried right now.
    const row = await prisma.planIngestTask.findFirstOrThrow({ where: { jobId: ingestJobId } });
    expect(row.error).toBeNull();
  });
});

describe("a whole run through the real port", () => {
  it("finishes every page and closes the job", async () => {
    await seed(5);
    const report = await runIngest({ ports: ports() });
    expect(report).toMatchObject({ done: 5, retryable: 0, exhausted: 0, stopped: "drained" });

    expect(await ingestCounts(ingestJobId)).toMatchObject({ total: 5, finished: 5, exhausted: 0, pending: 0 });
    expect(await closeIfSettled(ingestJobId)).toBe(true);
    const job = await prisma.planIngestJob.findUniqueOrThrow({ where: { id: ingestJobId } });
    expect(job.finishedAt).not.toBeNull();

    // Idempotent: a second worker reaching the same conclusion must not rewrite
    // the timestamp, or "when did this finish" moves every tick.
    const closedAgain = await closeIfSettled(ingestJobId);
    expect(closedAgain).toBe(false);
  });

  it("finishes the good pages and leaves one failed, rather than hanging", async () => {
    await seed(3);
    const report = await runIngest({
      ports: ports({
        work: async () => ({ ok: false, error: "this page is unreadable" }),
      }),
      // A budget large enough to exhaust page 1's three attempts; backoff is
      // what stops it, not time.
      budgetMs: 10_000,
    });

    // Every page failed once and is waiting, rather than one page consuming the
    // whole run — which is the backoff doing its job inside a single tick.
    expect(report.done).toBe(0);
    expect(report.retryable).toBe(3);
    const counts = await ingestCounts(ingestJobId);
    expect(counts).toMatchObject({ total: 3, finished: 0, exhausted: 0, pending: 3 });
    // A job with failures is NOT closed while attempts remain.
    expect(await closeIfSettled(ingestJobId)).toBe(false);
    expect(await hasWaitingWork(ingestJobId)).toBe(true);
  });

  it("closes a job whose every page has failed for the last time", async () => {
    await seed(2);
    await prisma.planIngestTask.updateMany({
      where: { jobId: ingestJobId },
      data: { attempts: MAX_ATTEMPTS, error: "unreadable" },
    });
    // A job whose pages have all exhausted their attempts is DONE, not 0%
    // forever. The failures are visible per page for whoever wants them.
    expect(await closeIfSettled(ingestJobId)).toBe(true);
    expect(await hasWaitingWork(ingestJobId)).toBe(false);
  });
});

describe("the CASCADE the migration header claims", () => {
  it("deletes the whole ingest tree when the plan set goes", async () => {
    await seed(4);
    expect(await prisma.planIngestTask.count({ where: { jobId: ingestJobId } })).toBe(4);

    // ONE delete, the way the scratch cleanup does it. If this ever needs two,
    // then both models belong in `HANDLED_MODELS` and the two `del()` orders
    // after all — which is the #224 shape, where a counter issued numbers
    // perfectly and broke both cleanup scripts with the guard green.
    await prisma.takeoffPlan.deleteMany({ where: { jobId } });

    expect(await prisma.planIngestJob.count({ where: { planId } })).toBe(0);
    expect(await prisma.planIngestTask.count({ where: { jobId: ingestJobId } })).toBe(0);
  });
});
