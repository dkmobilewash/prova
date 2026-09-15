import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * release_retainage against a fake Prisma and a faked core.
 *
 * The rows are faked, not the read: the card's three figures run through
 * the real `loadJobRetainage` and the real `calculateRetainageSummary`,
 * so what is pinned is that they are the job page's own arithmetic over
 * the same rows. Also pinned: that the amount is the person's digits or
 * the full balance in their words and nothing else, that an over-release
 * is refused BEFORE a card exists in the core's own sentence, that the
 * date is the person's words against THEIR today or today said out loud,
 * that ambiguity is a chip row, and on execute the exact arguments the
 * core receives — including the balance the card was made from and the
 * ceiling, which are what make the tap safe.
 */
const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      job: { findMany: fn(), findFirst: fn() },
      invoice: { findMany: fn() },
      retainageRelease: { findMany: fn() },
    },
    createRetainageReleaseRecord: vi.fn(),
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/billing/retainage-release", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/retainage-release")>()),
  createRetainageReleaseRecord: fake.createRetainageReleaseRecord,
}));

const { asksForAllOfIt, releaseRetainageCommand } = await import("./retainage");
const { schemaInput } = await import("../commands");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-11" };
const riverside = { id: "job-1", name: "Riverside Plaza", status: "IN_PROGRESS", contact: { name: "Turner" } };
const detail = (status = "IN_PROGRESS") => ({ status, contact: { name: "Turner" } });
const withheld = (...amounts: (string | null)[]) => amounts.map((retainageWithheld) => ({ retainageWithheld }));
const released = (...amounts: string[]) => amounts.map((amount) => ({ amount }));

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) for (const m of Object.values(model)) m.mockReset();
  fake.createRetainageReleaseRecord.mockReset();
  fake.prisma.job.findMany.mockResolvedValue([riverside]);
  fake.prisma.job.findFirst.mockResolvedValue(detail());
  // $4,500 + $3,000 withheld, one invoice with no retainage, $2,500
  // released: $5,000.00 still held.
  fake.prisma.invoice.findMany.mockResolvedValue(withheld("4500.00", null, "3000.00"));
  fake.prisma.retainageRelease.findMany.mockResolvedValue(released("2500.00"));
});

const line = (result: { kind: string; preview?: { label: string; value: string }[] }, label: string) =>
  result.preview?.find((l) => l.label === label)?.value;

describe("release_retainage", () => {
  it("is T3 and DIRECT over the lifted core, on MANAGE_BILLING, standing in for createRetainageRelease", () => {
    expect(releaseRetainageCommand.tier).toBe("T3_MONEY_EVIDENCE");
    expect(releaseRetainageCommand.mode).toBe("DIRECT");
    expect(releaseRetainageCommand.core).toBe("createRetainageReleaseRecord");
    expect(releaseRetainageCommand.action).toBe("createRetainageRelease");
    expect(releaseRetainageCommand.capability).toBe("MANAGE_BILLING");
    expect(releaseRetainageCommand.continuationKeys).toEqual(["jobId"]);
    expect(Object.keys(releaseRetainageCommand.input_schema.properties)).toEqual(["jobName", "amount", "releasedAt", "note"]);
    expect(releaseRetainageCommand.button).toBe("Log release");
  });

  it("keeps the person's words as words, and drops anything else the model sends", () => {
    const input = schemaInput(
      releaseRetainageCommand,
      { jobName: "Riverside", amount: "12,500", expectedBalance: "1", jobId: "forged", companyId: "x" },
      "model",
    );
    expect(input).toEqual({ jobName: "Riverside", amount: "12,500" });
  });

  it("asks which job before it reads anything", async () => {
    const result = await releaseRetainageCommand.resolve(ctx, { amount: "12500" });
    expect(result.kind).toBe("need");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
    expect(fake.prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("refuses an estimate with a link to the job, before reading any retainage row", async () => {
    fake.prisma.job.findFirst.mockResolvedValue(detail("ESTIMATE"));
    const result = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "100" });
    expect(result).toEqual({
      kind: "refuse",
      reason: "Riverside Plaza is still an estimate — nothing has been invoiced on it, so no retainage is held.",
      href: "/jobs/job-1",
    });
    expect(fake.prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("refuses when nothing is held, saying which of the three ways that happened", async () => {
    fake.prisma.invoice.findMany.mockResolvedValue(withheld(null));
    fake.prisma.retainageRelease.findMany.mockResolvedValue([]);
    const none = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside" });
    expect(none).toEqual({ kind: "refuse", reason: "No retainage has been withheld on Riverside Plaza — nothing to release.", href: "/jobs/job-1" });

    fake.prisma.invoice.findMany.mockResolvedValue(withheld("4500.00"));
    fake.prisma.retainageRelease.findMany.mockResolvedValue(released("4500.00"));
    const cleared = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside" });
    expect(cleared).toMatchObject({ kind: "refuse", reason: "All $4,500.00 of retainage withheld on Riverside Plaza has already been released — nothing is held." });

    fake.prisma.retainageRelease.findMany.mockResolvedValue(released("5000.00"));
    const over = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside" });
    expect(over).toMatchObject({
      kind: "refuse",
      reason: "Riverside Plaza's releases ($5,000.00) already exceed what was withheld ($4,500.00) — nothing is held.",
    });
  });

  it("asks for the amount when what was said is not a plain number, naming the balance it could release instead", async () => {
    const vague = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "12.5k" });
    expect(vague).toEqual({
      kind: "need",
      missing: 'the amount released as a plain number — "12.5k" isn\'t one. Say the figure, or "all of it" for the $5,000.00 still held',
    });
    const half = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "half" });
    expect(half.kind).toBe("need");
  });

  it("refuses more than the balance held before any card exists, in the core's own sentence", async () => {
    const result = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "$6,000" });
    expect(result).toEqual({
      kind: "refuse",
      reason: "That would bring total released to $8,500.00, more than the $7,500.00 withheld on Riverside Plaza. Only $5,000.00 is still held.",
      href: "/jobs/job-1",
    });
  });

  it("shows the job page's three figures from the same rows, the person's digits, the balance after, and today said out loud", async () => {
    const result = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "$1,000.00", note: "check 5102" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.preview).toEqual([
      { label: "Job", value: "Riverside Plaza · Turner" },
      { label: "Withheld to date", value: "$7,500.00 across 2 invoices" },
      { label: "Released to date", value: "$2,500.00 across 1 release" },
      { label: "Still held", value: "$5,000.00" },
      { label: "This release", value: "$1,000.00" },
      { label: "Held after", value: "$4,000.00" },
      { label: "Released on", value: "Sep 11, 2026 (Friday) — today; say a date if the GC released it on another day" },
      { label: "Note", value: "check 5102" },
    ]);
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Riverside Plaza",
      amount: "1000.00",
      fullBalance: false,
      releasedAt: "2026-09-11",
      note: "check 5102",
      expectedBalance: "5000.00",
    });
    expect(result.warnings).toEqual([]);
  });

  it("uses the full balance when no figure was given, or when the person asked for all of it in words, and says so", async () => {
    const omitted = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside" });
    if (omitted.kind !== "ready") throw new Error("unreachable");
    expect(line(omitted, "This release")).toBe("$5,000.00 — the full balance held");
    expect(line(omitted, "Held after")).toBe("nothing — this clears it");
    expect(line(omitted, "Released to date")).toBe("$2,500.00 across 1 release");
    expect(omitted.resolved).toMatchObject({ amount: "5000.00", fullBalance: true, expectedBalance: "5000.00" });

    const words = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "the retainage held" });
    if (words.kind !== "ready") throw new Error("unreachable");
    expect(words.resolved).toMatchObject({ amount: "5000.00", fullBalance: true });
  });

  it("says 'nothing yet' on the released line for a job with no release on record", async () => {
    fake.prisma.retainageRelease.findMany.mockResolvedValue([]);
    const result = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "100" });
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(line(result, "Released to date")).toBe("nothing yet");
    expect(line(result, "Still held")).toBe("$7,500.00");
    expect(result.resolved).toMatchObject({ expectedBalance: "7500.00" });
  });

  it("reads the release date from the person's words against their own today, and warns when it is ahead", async () => {
    const said = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "100", releasedAt: "9/8/2026" });
    if (said.kind !== "ready") throw new Error("unreachable");
    expect(line(said, "Released on")).toBe("Sep 8, 2026 (Tuesday)");
    expect(said.resolved).toMatchObject({ releasedAt: "2026-09-08" });
    expect(said.warnings).toEqual([]);

    const yesterday = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "100", releasedAt: "9/8" });
    if (yesterday.kind !== "ready") throw new Error("unreachable");
    expect(yesterday.resolved).toMatchObject({ releasedAt: "2026-09-08" });

    const ahead = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "100", releasedAt: "next Monday" });
    if (ahead.kind !== "ready") throw new Error("unreachable");
    expect(ahead.resolved).toMatchObject({ releasedAt: "2026-09-14" });
    expect(ahead.warnings).toEqual(["That release date, Sep 14, 2026 (Monday), is in the future."]);
  });

  it("takes a month-day already past this year as this year — a release has happened, so never a which-year chip — and asks for a relative phrase or words it cannot read", async () => {
    // The parser's which-year answer, which the bid and schedule commands
    // turn into chips. Sep 1 said on Sep 11 is ten days ago on a card
    // about money already received; the year is on the card regardless.
    const past = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "100", releasedAt: "September 1" });
    if (past.kind !== "ready") throw new Error("unreachable");
    expect(line(past, "Released on")).toBe("Sep 1, 2026 (Tuesday)");
    expect(past.resolved).toMatchObject({ releasedAt: "2026-09-01" });
    expect(past.warnings).toEqual([]);

    const relative = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "100", releasedAt: "a week ago" });
    expect(relative.kind).toBe("need");
    if (relative.kind !== "need") throw new Error("unreachable");
    expect(relative.missing).toContain('"a week ago"');

    const unreadable = await releaseRetainageCommand.resolve(ctx, { jobName: "Riverside", amount: "100", releasedAt: "sometime last month" });
    expect(unreadable.kind).toBe("need");
    if (unreadable.kind !== "need") throw new Error("unreachable");
    expect(unreadable.missing).toContain('"sometime last month"');
  });

  it("re-reads a chip's job in this company and never the list", async () => {
    fake.prisma.job.findFirst
      .mockResolvedValueOnce({ id: "job-1", name: "Riverside Plaza" })
      .mockResolvedValueOnce(detail());
    const result = await releaseRetainageCommand.resolve(ctx, { jobId: "job-1", amount: "100" });
    expect(result.kind).toBe("ready");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
    expect(fake.prisma.job.findFirst.mock.calls[0][0]).toMatchObject({ where: { id: "job-1", companyId: "co-1" } });
  });

  it("calls the core with the balance the card was made from and the ceiling on, and hands back the id", async () => {
    fake.createRetainageReleaseRecord.mockResolvedValue({ ok: true, value: { releaseId: "rel-1", jobName: "Riverside Plaza", balanceAfterCents: 400_000 } });
    const result = await releaseRetainageCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      amount: "1000.00",
      fullBalance: false,
      releasedAt: "2026-09-08",
      note: "check 5102",
      expectedBalance: "5000.00",
    });
    expect(fake.createRetainageReleaseRecord).toHaveBeenCalledWith(
      "co-1",
      "job-1",
      { amount: "1000.00", releasedAt: new Date("2026-09-08T00:00:00.000Z"), note: "check 5102", createdByUserId: "u-1" },
      { expectedBalance: "5000.00", refuseOverRelease: true },
    );
    expect(result).toEqual({
      ok: true,
      message: "Released $1,000.00 of retainage on Riverside Plaza; $4,000.00 is still held.",
      created: { label: "Retainage release, Riverside Plaza", href: "/jobs/job-1", targetType: "RetainageRelease", targetId: "rel-1" },
    });
  });

  it("says nothing is still held when the release clears the balance", async () => {
    fake.createRetainageReleaseRecord.mockResolvedValue({ ok: true, value: { releaseId: "rel-2", jobName: "Riverside Plaza", balanceAfterCents: 0 } });
    const result = await releaseRetainageCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      amount: "5000.00",
      fullBalance: true,
      releasedAt: "2026-09-11",
      note: null,
      expectedBalance: "5000.00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.message).toBe("Released $5,000.00 of retainage on Riverside Plaza; nothing is still held.");
  });

  it("puts the core's own refusal on the card, and refuses a payload with no balance or a malformed day", async () => {
    fake.createRetainageReleaseRecord.mockResolvedValue({ ok: false, error: "Riverside Plaza's retainage has changed since you last saw it — …" });
    const stale = await releaseRetainageCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      amount: "1000.00",
      releasedAt: "2026-09-08",
      expectedBalance: "7500.00",
    });
    expect(stale).toEqual({ ok: false, error: "Riverside Plaza's retainage has changed since you last saw it — …" });

    const noBalance = await releaseRetainageCommand.execute(ctx, { jobId: "job-1", jobName: "Riverside Plaza", amount: "1000.00", releasedAt: "2026-09-08" });
    expect(noBalance.ok).toBe(false);
    const badDay = await releaseRetainageCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      amount: "1000.00",
      releasedAt: "Sept 8",
      expectedBalance: "5000.00",
    });
    expect(badDay.ok).toBe(false);
    expect(fake.createRetainageReleaseRecord).toHaveBeenCalledTimes(1);
  });
});

describe("asksForAllOfIt", () => {
  it.each([
    "all of it",
    "all",
    "everything",
    "in full",
    "the balance",
    "the full balance",
    "the remaining balance",
    "the retainage held",
    "the retainage",
    "the whole amount",
    "what's held",
    "what is left",
    "The Retainage Held.",
  ])("reads %j as the full balance", (text) => {
    expect(asksForAllOfIt(text)).toBe(true);
  });

  it.each(["12500", "12,500.00", "half", "half of it", "most of it", "some", "12.5k", "the rest of the invoice", ""])(
    "does not read %j as the full balance",
    (text) => {
      expect(asksForAllOfIt(text)).toBe(false);
    },
  );
});
