import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sending ceiling, and the reason it is tested by its QUERY and not
 * only by its answer.
 *
 * `emailAllowance` returns `{ ok: true }` when the count is under the
 * limit — which is also what it returns when the `where` clause is wrong,
 * when the window is a year instead of an hour, and when the filter
 * matches nothing at all. A test that only reads the verdict would pass
 * against every one of those, exactly the way this repo's census passed
 * while parsing 180 foreign keys instead of 181. So the cases below assert
 * the arguments the count was actually asked for.
 */

const count = vi.fn();

vi.mock("@prova/db", () => ({
  prisma: {
    outboundMessage: {
      count: (...args: unknown[]) => count(...args),
    },
  },
}));

const { emailAllowance, EMAIL_LIMITS, HELP_RELATED_TYPE } = await import("./outbound-email");

const NOW = new Date("2026-09-19T12:00:00.000Z");
const HOUR_AGO = new Date("2026-09-19T11:00:00.000Z");
const DAY_AGO = new Date("2026-09-18T12:00:00.000Z");

/** [person-in-the-last-hour, company-in-the-last-day] */
const counts = (person: number, company: number) => {
  count.mockReset();
  count.mockImplementationOnce(async () => person).mockImplementationOnce(async () => company);
};

beforeEach(() => count.mockReset());

describe("emailAllowance counts the right rows", () => {
  it("scopes the hourly count to this person, this company, email, and one hour", async () => {
    counts(0, 0);
    await emailAllowance("co_1", "user_1", NOW);

    expect(count).toHaveBeenNthCalledWith(1, {
      where: {
        companyId: "co_1",
        channel: "EMAIL",
        relatedType: { not: HELP_RELATED_TYPE },
        sentByUserId: "user_1",
        createdAt: { gte: HOUR_AGO },
      },
    });
  });

  it("scopes the daily count to the company and one day, and not to one person", async () => {
    counts(0, 0);
    await emailAllowance("co_1", "user_1", NOW);

    const where = count.mock.calls[1][0].where;
    expect(where).toEqual({
      companyId: "co_1",
      channel: "EMAIL",
      relatedType: { not: HELP_RELATED_TYPE },
      createdAt: { gte: DAY_AGO },
    });
    // The domain does not care who pressed the button. A per-person filter
    // here would let ten members send ten times the company ceiling.
    expect(where).not.toHaveProperty("sentByUserId");
  });

  it("excludes help requests from both counts", async () => {
    counts(0, 0);
    await emailAllowance("co_1", "user_1", NOW);

    for (const call of count.mock.calls) {
      expect(call[0].where.relatedType).toEqual({ not: HELP_RELATED_TYPE });
    }
  });

  it("does not spend anybody's hourly allowance on a message the notifier sent", async () => {
    counts(0, 0);
    await emailAllowance("co_1", null, NOW);

    // One query, not two: with no person there is no per-person ceiling to
    // check, and counting the company's mail against a null user would be
    // counting it against everybody.
    expect(count).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0][0].where.createdAt).toEqual({ gte: DAY_AGO });
  });
});

describe("emailAllowance refuses at the ceiling", () => {
  it("allows a send below both limits", async () => {
    counts(EMAIL_LIMITS.perPersonPerHour - 1, EMAIL_LIMITS.perCompanyPerDay - 1);
    expect(await emailAllowance("co_1", "user_1", NOW)).toEqual({ ok: true });
  });

  it("refuses at the per-person hourly limit, naming the number", async () => {
    counts(EMAIL_LIMITS.perPersonPerHour, 0);
    const result = await emailAllowance("co_1", "user_1", NOW);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(String(EMAIL_LIMITS.perPersonPerHour));
    expect(result.ok === false && result.error).toContain("hour");
  });

  it("refuses at the per-company daily limit even when this person has sent nothing", async () => {
    counts(0, EMAIL_LIMITS.perCompanyPerDay);
    const result = await emailAllowance("co_1", "user_1", NOW);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(String(EMAIL_LIMITS.perCompanyPerDay));
    expect(result.ok === false && result.error).toContain("day");
  });
});

describe("emailAllowance fails closed", () => {
  it("refuses the send when the count cannot be read", async () => {
    // The deliberate divergence from askAllowance, which fails OPEN. The
    // argument is in the module's own comment: an unbounded Ask costs
    // model spend, unbounded mail from a shared domain costs every
    // customer their deliverability. If this ever flips to `{ ok: true }`,
    // that decision is being reversed and this test is where it is caught.
    vi.spyOn(console, "error").mockImplementation(() => {});
    count.mockReset();
    // Only the FIRST of the two counts rejects. That is the realistic
    // shape — one query fails — and it avoids an artifact worth naming so
    // the next person does not re-diagnose it: when BOTH reject, vitest's
    // spy tracks the second settled result itself, and reports that
    // tracking promise as an unhandled rejection attributed to this test.
    // `Promise.all` handles both (verified directly in plain node), and
    // `emailAllowance` returns the refusal correctly either way — the
    // noise was the test harness, not the code.
    count.mockImplementationOnce(async () => {
      throw new Error('relation "OutboundMessage" does not exist');
    });
    count.mockImplementation(async () => 0);

    const result = await emailAllowance("co_1", "user_1", NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("wasn't sent");
  });
});
