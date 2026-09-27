import { describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MS,
  CLAIM_LEASE_MS,
  DEFAULT_RUN_BUDGET_MS,
  MAX_ATTEMPTS,
  backoffFor,
  ingestProgress,
  runIngest,
  type ClaimedTask,
  type RunnerPorts,
  type WorkOutcome,
} from "./runner";

/**
 * The run loop's policy, tested without a database, a clock or a PDF.
 *
 * WHAT IS WORTH PINNING HERE is not that the loop does work — that is the easy
 * half and any smoke test catches it. It is the four behaviours that only show
 * up when something goes wrong, each of which this repo has a scar for
 * somewhere:
 *
 *   - the budget stops the run BEFORE claiming, so no task is left claimed by
 *     a worker that will never do it;
 *   - a page that throws is recorded against the page and the run continues,
 *     because one bad sheet must not abandon 299 others;
 *   - the attempt ceiling is enforced, so a page that cannot succeed costs
 *     three attempts rather than a bill;
 *   - backoff is applied from the attempt number, so one invocation cannot
 *     spend all three attempts inside one 45-second run.
 *
 * Time is injected, which is the only reason a 45-second budget can be a test
 * that runs in a millisecond — the argument `notification-run.ts` makes for the
 * digest, and the reason its budget is tested at all.
 */

function task(over: Partial<ClaimedTask> = {}): ClaimedTask {
  return { id: "t1", pageNumber: 1, stage: "PAGE_INVENTORY", attempts: 1, ...over };
}

/** A port set over a finite queue of tasks, recording every call. */
function ports(queue: ClaimedTask[], work?: (t: ClaimedTask) => Promise<WorkOutcome>) {
  const finished: ClaimedTask[] = [];
  const failed: { task: ClaimedTask; error: string; retryAt: Date | null; exhausted: boolean }[] = [];
  const claimedWith: Date[] = [];
  const p: RunnerPorts = {
    claim: async (deadline) => {
      claimedWith.push(deadline);
      return queue.shift() ?? null;
    },
    work: work ?? (async () => ({ ok: true })),
    finish: async (t) => {
      finished.push(t);
    },
    fail: async (t, error, retryAt, exhausted) => {
      failed.push({ task: t, error, retryAt, exhausted });
    },
  };
  return { p, finished, failed, claimedWith };
}

describe("the run loop", () => {
  it("works every available page and reports drained", async () => {
    const { p, finished } = ports([task({ id: "a", pageNumber: 1 }), task({ id: "b", pageNumber: 2 })]);
    const report = await runIngest({ ports: p, now: () => 0 });
    expect(report).toEqual({ done: 2, retryable: 0, exhausted: 0, stopped: "drained" });
    expect(finished.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("stops on the budget BEFORE claiming, so nothing is left claimed and undone", async () => {
    // Three pages available, a clock that jumps a full budget after the first.
    let ticks = 0;
    const { p, finished, claimedWith } = ports([task({ id: "a" }), task({ id: "b" }), task({ id: "c" })]);
    const report = await runIngest({
      ports: p,
      budgetMs: 1_000,
      // 0 at start, 0 for the first check, then past the budget.
      now: () => (ticks++ < 2 ? 0 : 5_000),
    });

    expect(report.stopped).toBe("budget");
    expect(report.done).toBe(1);
    // THE ASSERTION THAT MATTERS: exactly one claim was made. A loop that
    // checked the budget after claiming would have taken a second task and
    // abandoned it, leaving a page that looks stuck for a whole lease.
    expect(claimedWith).toHaveLength(1);
    expect(finished).toHaveLength(1);
  });

  it("hands the claim a deadline a lease ahead, not a lease behind", async () => {
    const { p, claimedWith } = ports([task()]);
    await runIngest({ ports: p, now: () => 1_000_000, leaseMs: 90_000 });
    expect(claimedWith[0].getTime()).toBe(1_090_000);
  });

  it("records a page that THREW and keeps going", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { p, failed, finished } = ports(
      [task({ id: "bad", pageNumber: 7 }), task({ id: "good", pageNumber: 8 })],
      async (t) => {
        if (t.id === "bad") throw new Error("postgresql://user:secret@host/db exploded");
        return { ok: true };
      },
    );

    const report = await runIngest({ ports: p, now: () => 0 });
    // The good page still ran — one bad sheet does not abandon the rest.
    expect(report.done).toBe(1);
    expect(finished.map((t) => t.id)).toEqual(["good"]);
    expect(report.retryable).toBe(1);

    // The STORED sentence is generic, because a thrown error's own text can
    // carry a connection string and this string is rendered on a screen.
    expect(failed[0].error).toContain("This page could not be read");
    expect(failed[0].error).not.toContain("postgresql://");
    expect(failed[0].error).not.toContain("secret");
    // The detail goes to the log, with ids rather than content.
    expect(errors).toHaveBeenCalledWith("[plan-ingest] stage threw", expect.objectContaining({ taskId: "bad", pageNumber: 7 }));
    errors.mockRestore();
  });

  it("marks a page exhausted on its last attempt, with no retry time", async () => {
    const { p, failed } = ports([task({ attempts: MAX_ATTEMPTS })], async () => ({ ok: false, error: "unreadable" }));
    const report = await runIngest({ ports: p, now: () => 0 });

    expect(report).toEqual({ done: 0, retryable: 0, exhausted: 1, stopped: "drained" });
    expect(failed[0].exhausted).toBe(true);
    // NULL, not a date. A page with attempts spent must not be picked up again
    // by the next cron tick — that is the difference between a ceiling and a
    // suggestion.
    expect(failed[0].retryAt).toBeNull();
    expect(failed[0].error).toBe("unreadable");
  });

  it("gives a retryable page a time in the future, growing with attempts", async () => {
    const first = ports([task({ attempts: 1 })], async () => ({ ok: false, error: "flaky" }));
    await runIngest({ ports: first.p, now: () => 1_000 });
    expect(first.failed[0].retryAt?.getTime()).toBe(1_000 + BACKOFF_MS[0]);

    const second = ports([task({ attempts: 2 })], async () => ({ ok: false, error: "flaky" }));
    await runIngest({ ports: second.p, now: () => 1_000 });
    expect(second.failed[0].retryAt?.getTime()).toBe(1_000 + BACKOFF_MS[1]);
    // Growing, which is the whole point of a backoff rather than a delay.
    expect(BACKOFF_MS[1]).toBeGreaterThan(BACKOFF_MS[0]);
  });

  it("never claims again after the queue is empty", async () => {
    const { p, claimedWith } = ports([task()]);
    await runIngest({ ports: p, now: () => 0 });
    // Two: one that won a task, one that found nothing and ended the loop.
    expect(claimedWith).toHaveLength(2);
  });
});

describe("backoffFor", () => {
  it("clamps below and above, so no attempt number can index off the end", () => {
    // 0 and negative cannot happen (attempts increments on claim, so the first
    // is 1) but a clamp that only works for expected input is not a clamp.
    expect(backoffFor(0)).toBe(BACKOFF_MS[0]);
    expect(backoffFor(-5)).toBe(BACKOFF_MS[0]);
    expect(backoffFor(1)).toBe(BACKOFF_MS[0]);
    expect(backoffFor(99)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
    // An undefined here would become NaN in `new Date(now + NaN)`, i.e. an
    // Invalid Date written to a nullable column — a task that can never be
    // claimed again and never reports why.
    for (const n of [0, 1, 2, 3, 4, 50]) expect(Number.isFinite(backoffFor(n))).toBe(true);
  });
});

describe("the constants relate to each other correctly", () => {
  it("leases for longer than a run can last", () => {
    // THE SUBTLE ONE. A lease shorter than the budget would expire underneath a
    // worker that is still legitimately working, and a second worker would
    // start the same page — the exact double-spend the claim column exists to
    // prevent. Asserted rather than commented, because the two numbers live
    // apart and somebody will tune one of them.
    expect(CLAIM_LEASE_MS).toBeGreaterThan(DEFAULT_RUN_BUDGET_MS);
  });

  it("has a backoff entry for every attempt the ceiling allows", () => {
    expect(BACKOFF_MS.length).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
  });

  it("budgets under the platform's 60-second floor with room to finish a page", () => {
    expect(DEFAULT_RUN_BUDGET_MS).toBeLessThan(60_000);
    expect(60_000 - DEFAULT_RUN_BUDGET_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("ingestProgress", () => {
  it("counts exhausted pages as settled, so a job with failures can finish", () => {
    // A progress bar that can never reach its end is a support call. The
    // failures are visible per page for whoever wants them.
    expect(ingestProgress({ total: 10, finished: 8, exhausted: 2 })).toEqual({
      settled: 10,
      percent: 100,
      complete: true,
    });
  });

  it("floors the percentage rather than rounding up to 100 early", () => {
    expect(ingestProgress({ total: 3, finished: 2, exhausted: 0 })).toMatchObject({ percent: 66, complete: false });
    // 299 of 300 must not read as 100%.
    expect(ingestProgress({ total: 300, finished: 299, exhausted: 0 })).toMatchObject({ percent: 99, complete: false });
  });

  it("calls an empty job complete instead of dividing by zero", () => {
    // NaN% on a screen is the shape #526 paid for on a bid total, and a
    // zero-page upload is a reachable state.
    expect(ingestProgress({ total: 0, finished: 0, exhausted: 0 })).toEqual({
      settled: 0,
      percent: 100,
      complete: true,
    });
  });
});
