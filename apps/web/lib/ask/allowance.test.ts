import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The PAID cap, against a fake Prisma: it stops exactly at the number, it
 * stops on pages as well as questions, it fails CLOSED, it rolls over on
 * the first of the month, and a failed call is MARKED rather than handed
 * back.
 *
 * WHAT THIS FILE CANNOT PROVE AND DOES NOT CLAIM TO. Two concurrent claims
 * for the last unit are a database question, not a JavaScript one, and a
 * fake that returns whatever it was told cannot answer it. What is asserted
 * here instead is the SHAPE of the statement — that the ceiling is a
 * condition inside the same `updateMany` that increments, so there is no
 * window between reading and claiming for a second request to fit through.
 * `allowance.dbtest.ts` runs the real race against real Postgres.
 */
const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      askAllowancePeriod: { upsert: fn(), updateMany: fn(), findUnique: fn() },
      // usage.ts's courtesy limit reads this one. Present so the contrast
      // between the two ceilings can be asserted in one place, on the same
      // failure, rather than inferred from two files.
      askUsage: { count: fn() },
    },
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { askAllowance } = await import("./usage");
const {
  ASK_MONTHLY_ALLOWANCE,
  allowanceSummary,
  claimAskAllowance,
  markAskAllowanceFailure,
  periodResetsAt,
  periodStartFor,
  resetSentence,
} = await import("./allowance");

const now = new Date("2026-09-22T12:00:00.000Z");
const SEPT = new Date("2026-09-01T00:00:00.000Z");

/** The ledger's answer after a claim: what the row now holds. */
function rowIs(row: {
  questionsUsed: number;
  pagesUsed: number;
  failedQuestions?: number;
  failedPages?: number;
}) {
  fake.prisma.askAllowancePeriod.findUnique.mockResolvedValue({
    failedQuestions: 0,
    failedPages: 0,
    ...row,
  });
}

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) for (const m of Object.values(model)) m.mockReset();
  fake.prisma.askAllowancePeriod.upsert.mockResolvedValue({});
});

describe("the month a claim lands in", () => {
  it("is the UTC calendar month, and resets on the first of the next one", () => {
    expect(periodStartFor(now)).toEqual(SEPT);
    expect(periodStartFor(new Date("2026-09-01T00:00:00.000Z"))).toEqual(SEPT);
    expect(periodStartFor(new Date("2026-09-30T23:59:59.999Z"))).toEqual(SEPT);
    // One millisecond later is a different row, which is what "rollover is
    // a new row, never a reset" means in practice.
    expect(periodStartFor(new Date("2026-10-01T00:00:00.000Z"))).toEqual(
      new Date("2026-10-01T00:00:00.000Z"),
    );
    expect(periodResetsAt(now)).toEqual(new Date("2026-10-01T00:00:00.000Z"));
  });

  it("rolls December into January of the next year, and says the year when it does", () => {
    const dec = new Date("2026-12-14T09:00:00.000Z");
    expect(periodResetsAt(dec)).toEqual(new Date("2027-01-01T00:00:00.000Z"));
    expect(resetSentence(dec)).toBe("1 January 2027");
    // Within the same year the year is noise, so it is left off.
    expect(resetSentence(now)).toBe("1 October");
  });

  it("claims against the row for THIS month, so last month's use cannot bleed through", async () => {
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 1 });
    rowIs({ questionsUsed: 1, pagesUsed: 0 });
    await claimAskAllowance("co-1", { questions: 1, pages: 0 }, new Date("2026-10-01T00:00:01.000Z"));
    expect(fake.prisma.askAllowancePeriod.updateMany.mock.calls[0][0].where).toMatchObject({
      companyId: "co-1",
      periodStart: new Date("2026-10-01T00:00:00.000Z"),
    });
  });
});

describe("claiming a question", () => {
  it("claims and increments in ONE conditional statement — the ceiling is in the WHERE", async () => {
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 1 });
    rowIs({ questionsUsed: 1, pagesUsed: 3 });

    const result = await claimAskAllowance("co-1", { questions: 1, pages: 3 }, now);
    expect(result.ok).toBe(true);

    // THIS is the concurrency claim, asserted as a shape because a fake
    // cannot race. If the ceiling ever moves out of the WHERE and into a
    // read-then-decide in JavaScript, two questions can both claim the
    // last unit — the #224 collision — and this goes red.
    const args = fake.prisma.askAllowancePeriod.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({
      companyId: "co-1",
      periodStart: SEPT,
      questionsUsed: { lte: ASK_MONTHLY_ALLOWANCE.questions - 1 },
      pagesUsed: { lte: ASK_MONTHLY_ALLOWANCE.pages - 3 },
    });
    expect(args.data).toEqual({
      questionsUsed: { increment: 1 },
      pagesUsed: { increment: 3 },
    });
  });

  it("reports what is left, counting the claim just made", async () => {
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 1 });
    rowIs({ questionsUsed: 300, pagesUsed: 300 });
    const result = await claimAskAllowance("co-1", { questions: 1, pages: 0 }, now);
    expect(result.ok && result.left).toEqual({ questions: 0, pages: 0 });
  });

  it("allows the question ONE BEFORE the cap and stops AT it", async () => {
    // One before: 299 used, the 300th is claimed, and it goes through.
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 1 });
    rowIs({ questionsUsed: ASK_MONTHLY_ALLOWANCE.questions, pagesUsed: 0 });
    const last = await claimAskAllowance("co-1", { questions: 1, pages: 0 }, now);
    expect(last.ok).toBe(true);

    // At it: the database matched no row, which is the only way this
    // function ever learns it is over — never by arithmetic of its own.
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 0 });
    rowIs({ questionsUsed: ASK_MONTHLY_ALLOWANCE.questions, pagesUsed: 0 });
    const over = await claimAskAllowance("co-1", { questions: 1, pages: 0 }, now);
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.error).toContain(`${ASK_MONTHLY_ALLOWANCE.questions} assistant questions`);
      // What ran out, when it comes back, who to ask — and that nothing is
      // billed, said out loud. All four, because the missing one is the
      // support call.
      expect(over.error).toContain("1 October");
      expect(over.error).toContain("contact C Stream");
      expect(over.error).toMatch(/[Nn]othing extra has been charged and nothing will be/);
    }
  });

  it("stops on PAGES with the file's own numbers, not a generic sentence", async () => {
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 0 });
    rowIs({ questionsUsed: 10, pagesUsed: ASK_MONTHLY_ALLOWANCE.pages - 4 });
    const result = await claimAskAllowance("co-1", { questions: 1, pages: 12 }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("this file needs 12 document pages");
      expect(result.error).toContain("only 4 of this month's 300 are left");
      // The questions are fine, so they are not mentioned — a stop that
      // names the wrong ceiling sends somebody to the wrong fix.
      expect(result.error).not.toContain("assistant questions");
    }
  });

  it("says so plainly when one file is bigger than the whole monthly allowance", async () => {
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 0 });
    rowIs({ questionsUsed: 0, pagesUsed: 0 });
    const result = await claimAskAllowance("co-1", { questions: 1, pages: 400 }, now);
    expect(result.ok).toBe(false);
    // "only -100 are left" would be the arithmetic answer and it is
    // nonsense to read on a phone.
    if (!result.ok) expect(result.error).toContain("that file is 400 pages and the whole monthly allowance is 300");
  });

  it("names BOTH ceilings when both are gone", async () => {
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 0 });
    rowIs({ questionsUsed: ASK_MONTHLY_ALLOWANCE.questions, pagesUsed: ASK_MONTHLY_ALLOWANCE.pages });
    const result = await claimAskAllowance("co-1", { questions: 1, pages: 2 }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("assistant questions");
      expect(result.error).toContain("document pages");
    }
  });
});

describe("when the ledger itself cannot be read", () => {
  it("REFUSES the question — this cap fails closed, unlike the hourly and daily ones", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.prisma.askAllowancePeriod.upsert.mockRejectedValue(
      Object.assign(new Error("relation does not exist"), { code: "P2021" }),
    );
    const result = await claimAskAllowance("co-1", { questions: 1, pages: 0 }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/couldn't check your company's monthly AI allowance/);
      expect(result.error).toMatch(/[Nn]othing has been charged/);
    }
    // Loud, and naming the fix — #257's complaint was a refusal that named
    // nothing, not the refusal itself.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("migrate:deploy");
    expect(String(error.mock.calls[0][0])).toContain("fails closed");
    error.mockRestore();
  });

  it("refuses when the increment itself fails, not just the read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.prisma.askAllowancePeriod.updateMany.mockRejectedValue(new Error("connection lost"));
    const result = await claimAskAllowance("co-1", { questions: 1, pages: 0 }, now);
    expect(result.ok).toBe(false);
    error.mockRestore();
  });

  it("treats a lost race to create the period row as a success, not a failure", async () => {
    // Two questions arriving together both try to create September. The
    // unique index refuses one; the row exists either way, which is all
    // this step wanted. Refusing here would turn a normal concurrent
    // moment into a dead assistant.
    fake.prisma.askAllowancePeriod.upsert.mockRejectedValue(
      Object.assign(new Error("unique constraint"), { code: "P2002" }),
    );
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 1 });
    rowIs({ questionsUsed: 2, pagesUsed: 0 });
    expect((await claimAskAllowance("co-1", { questions: 1, pages: 0 }, now)).ok).toBe(true);
  });
});

describe("a call that failed after its unit was claimed", () => {
  it("MARKS the claim and never gives it back", async () => {
    fake.prisma.askAllowancePeriod.updateMany.mockResolvedValue({ count: 1 });
    await markAskAllowanceFailure({ companyId: "co-1", periodStart: SEPT, questions: 1, pages: 6 });
    const args = fake.prisma.askAllowancePeriod.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ companyId: "co-1", periodStart: SEPT });
    // Increments of the FAILED columns only. A decrement of questionsUsed
    // anywhere in this file would mean the cap can be defeated by making
    // calls fail, which is the whole reason the unit is claimed up front.
    expect(args.data).toEqual({
      failedQuestions: { increment: 1 },
      failedPages: { increment: 6 },
    });
    expect(JSON.stringify(args.data)).not.toContain("decrement");
    expect(JSON.stringify(args.data)).not.toContain("questionsUsed");
  });

  it("never throws: the claim already stands, which is the conservative direction", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.prisma.askAllowancePeriod.updateMany.mockRejectedValue(new Error("gone"));
    await expect(
      markAskAllowanceFailure({ companyId: "co-1", periodStart: SEPT, questions: 1, pages: 0 }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("what the settings page is told", () => {
  it("reports a month nobody has asked anything in as readable and untouched", async () => {
    fake.prisma.askAllowancePeriod.findUnique.mockResolvedValue(null);
    const summary = await allowanceSummary("co-1", now);
    expect(summary).toMatchObject({
      readable: true,
      questionsUsed: 0,
      pagesUsed: 0,
      questionsLeft: ASK_MONTHLY_ALLOWANCE.questions,
      pagesLeft: ASK_MONTHLY_ALLOWANCE.pages,
      resetsOn: "1 October",
      low: false,
    });
  });

  it("warns while there is still something left to do about it", async () => {
    // A fifth left is the warning, not a tenth: 60 questions is about a
    // week, which is enough notice to act on.
    rowIs({ questionsUsed: 239, pagesUsed: 0 });
    expect((await allowanceSummary("co-1", now)).low).toBe(false);
    rowIs({ questionsUsed: 240, pagesUsed: 0 });
    expect((await allowanceSummary("co-1", now)).low).toBe(true);
    // Either ceiling on its own is enough to warn.
    rowIs({ questionsUsed: 0, pagesUsed: 240 });
    expect((await allowanceSummary("co-1", now)).low).toBe(true);
  });

  it("carries the failed figures so an owner can ask a person for a credit", async () => {
    rowIs({ questionsUsed: 20, pagesUsed: 40, failedQuestions: 3, failedPages: 11 });
    expect(await allowanceSummary("co-1", now)).toMatchObject({
      failedQuestions: 3,
      failedPages: 11,
    });
  });

  it("says it could not read rather than printing a reassuring zero", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.prisma.askAllowancePeriod.findUnique.mockRejectedValue(new Error("no table"));
    const summary = await allowanceSummary("co-1", now);
    // Zero used is exactly what an untouched month looks like, which is why
    // the flag has to exist — the page reads it and says which of the two
    // it is looking at, and that this cap is refusing everything meanwhile.
    expect(summary.readable).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

/**
 * THE SPLIT, ASSERTED RATHER THAN DESCRIBED.
 *
 * Both files say in their headers that one fails open and the other fails
 * closed. A header is a claim; this is the check. One failure, injected
 * into both at once, and the two must disagree about it — because if they
 * ever start agreeing, one of them is wrong and the money one is the
 * expensive half to get wrong.
 */
describe("the courtesy limit and the paid cap on the SAME database failure", () => {
  it("answers the question and refuses it, respectively", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = Object.assign(new Error("relation does not exist"), { code: "P2021" });
    fake.prisma.askUsage.count.mockRejectedValue(missing);
    fake.prisma.askAllowancePeriod.upsert.mockRejectedValue(missing);

    // The rolling hourly/daily bound: still open, deliberately, #257.
    expect(await askAllowance("co-1", "u-1", now)).toEqual({ ok: true });
    // The paid monthly cap: closed.
    const claim = await claimAskAllowance("co-1", { questions: 1, pages: 0 }, now);
    expect(claim.ok).toBe(false);

    error.mockRestore();
  });
});
