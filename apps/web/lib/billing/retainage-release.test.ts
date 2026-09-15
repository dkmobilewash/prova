import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateRetainageSummary } from "@/lib/retainage";
import type { RetainageReader } from "./retainage-release";

/**
 * The lifted core against a fake Prisma. What only a database can prove —
 * that the re-read inside the transaction actually refuses a card made
 * from a balance that has since moved — is in lib/actions/ask.dbtest.ts.
 * What is pinned here is what a person would be hurt by if it drifted:
 * that the cents come from the job page's own arithmetic over the same
 * rows, that both refusals arrive as sentences INSTEAD of a write and in
 * the shape logPayment's own guard uses, that neither guard runs unless
 * asked for (the form asks for neither, on purpose), that the transaction
 * is serializable and a serialization failure is a sentence rather than a
 * throw, and the exact `create` data.
 */
const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      $transaction: fn(),
      job: { findFirst: fn() },
      invoice: { findMany: fn() },
      retainageRelease: { findMany: fn(), create: fn() },
    },
  };
});

vi.mock("@prova/db", () => ({
  prisma: fake.prisma,
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}));

const {
  JOB_NOT_FOUND,
  RELEASE_COLLIDED,
  balanceChangedSentence,
  cents,
  createRetainageReleaseRecord,
  loadJobRetainage,
  overReleaseSentence,
} = await import("./retainage-release");

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
/** The fake as the reader the core takes: two delegates, from `prisma` or
 * from a transaction client. */
const db = fake.prisma as unknown as RetainageReader;
const withheld = (...amounts: (string | null)[]) => amounts.map((retainageWithheld) => ({ retainageWithheld }));
const released = (...amounts: string[]) => amounts.map((amount) => ({ amount }));

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) {
    if (typeof model === "function") model.mockReset();
    else for (const m of Object.values(model)) m.mockReset();
  }
  // The transaction runs its callback against the same fake, and records
  // the options it was given.
  fake.prisma.$transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(fake.prisma));
  fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", name: "Riverside Plaza" });
  fake.prisma.invoice.findMany.mockResolvedValue(withheld("4500.00", null, "3000.00"));
  fake.prisma.retainageRelease.findMany.mockResolvedValue(released("2500.00"));
  fake.prisma.retainageRelease.create.mockResolvedValue({ id: "rel-1" });
});

const input = { amount: "1000.00", releasedAt: utc("2026-09-08"), note: " check 5102 ", createdByUserId: "u-1" };

describe("loadJobRetainage", () => {
  it("reads both tables scoped to the job and nothing else, and sums them with the job page's own call", async () => {
    const held = await loadJobRetainage(db, "job-1");
    expect(fake.prisma.invoice.findMany).toHaveBeenCalledWith({ where: { jobId: "job-1" }, select: { retainageWithheld: true } });
    expect(fake.prisma.retainageRelease.findMany).toHaveBeenCalledWith({ where: { jobId: "job-1" }, select: { amount: true } });
    // The same object the page builds from the same rows — not a second
    // implementation of withheld minus released.
    expect(held.summary).toEqual(
      calculateRetainageSummary({ invoiceRetainageWithheld: [4500, null, 3000], releaseAmounts: [2500], substantialCompletionDate: null }),
    );
    expect(held).toMatchObject({ withheldCents: 750_000, releasedCents: 250_000, balanceCents: 500_000, invoicesWithRetainage: 2, releases: 1 });
  });

  it("counts a job with nothing withheld and nothing released as zero, not as missing", async () => {
    fake.prisma.invoice.findMany.mockResolvedValue([]);
    fake.prisma.retainageRelease.findMany.mockResolvedValue([]);
    const held = await loadJobRetainage(db, "job-1");
    expect(held).toMatchObject({ withheldCents: 0, releasedCents: 0, balanceCents: 0, invoicesWithRetainage: 0, releases: 0 });
  });

  it("rounds to cents the way every comparison does — a float sum never reaches a comparison", () => {
    expect(cents("0.1")).toBe(10);
    expect(cents(0.1 + 0.2)).toBe(30);
    expect(cents("12500.00")).toBe(1_250_000);
  });
});

describe("createRetainageReleaseRecord", () => {
  it("writes exactly what the form's action wrote, inside a serializable transaction, and hands back the id and the balance after", async () => {
    const result = await createRetainageReleaseRecord("co-1", "job-1", input);
    expect(fake.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(fake.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({ where: { id: "job-1", companyId: "co-1" }, select: { id: true, name: true } });
    expect(fake.prisma.retainageRelease.create).toHaveBeenCalledWith({
      data: { jobId: "job-1", amount: "1000.00", releasedAt: utc("2026-09-08"), note: "check 5102", createdByUserId: "u-1" },
      select: { id: true },
    });
    expect(result).toEqual({ ok: true, value: { releaseId: "rel-1", jobName: "Riverside Plaza", balanceAfterCents: 400_000 } });
  });

  it("stores an empty note as null, as the action did", async () => {
    await createRetainageReleaseRecord("co-1", "job-1", { ...input, note: "   " });
    expect(fake.prisma.retainageRelease.create.mock.calls[0][0].data.note).toBeNull();
    await createRetainageReleaseRecord("co-1", "job-1", { ...input, note: undefined });
    expect(fake.prisma.retainageRelease.create.mock.calls[1][0].data.note).toBeNull();
  });

  it("says 'Job not found' for another company's job, before reading a single row", async () => {
    fake.prisma.job.findFirst.mockResolvedValue(null);
    const result = await createRetainageReleaseRecord("co-1", "someone-elses", input);
    expect(result).toEqual({ ok: false, error: JOB_NOT_FOUND });
    expect(JOB_NOT_FOUND).toBe("Job not found");
    expect(fake.prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(fake.prisma.retainageRelease.create).not.toHaveBeenCalled();
  });

  it("lets the form release more than is held — neither guard runs unless asked for", async () => {
    // $7,500 withheld, $2,500 released, $5,000 held: a $6,000 release goes
    // through from the form, and the balance goes negative, which
    // lib/retainage.ts pins as a legitimate state. The card never takes
    // this path; see the file comment for why the form keeps it.
    const result = await createRetainageReleaseRecord("co-1", "job-1", { ...input, amount: "6000.00" });
    expect(result).toEqual({ ok: true, value: { releaseId: "rel-1", jobName: "Riverside Plaza", balanceAfterCents: -100_000 } });
    expect(fake.prisma.retainageRelease.create).toHaveBeenCalledTimes(1);
  });

  it("refuses more than the balance held when asked to, in logPayment's sentence shape, and writes nothing", async () => {
    const result = await createRetainageReleaseRecord("co-1", "job-1", { ...input, amount: "6000.00" }, { refuseOverRelease: true });
    expect(result).toEqual({
      ok: false,
      error: "That would bring total released to $8,500.00, more than the $7,500.00 withheld on Riverside Plaza. Only $5,000.00 is still held.",
    });
    expect(fake.prisma.retainageRelease.create).not.toHaveBeenCalled();
  });

  it("lets exactly the balance through under the ceiling — the full-balance card clears it to zero", async () => {
    const result = await createRetainageReleaseRecord("co-1", "job-1", { ...input, amount: "5000.00" }, { refuseOverRelease: true, expectedBalance: "5000.00" });
    expect(result).toEqual({ ok: true, value: { releaseId: "rel-1", jobName: "Riverside Plaza", balanceAfterCents: 0 } });
  });

  it("refuses a card made from a balance the job no longer holds, naming what it holds now, and writes nothing", async () => {
    // The card was made when $7,500 was held; a $2,500 release has landed
    // since. The re-read is what the transaction is for.
    const result = await createRetainageReleaseRecord("co-1", "job-1", input, { expectedBalance: "7500.00", refuseOverRelease: true });
    expect(result).toEqual({
      ok: false,
      error:
        "Riverside Plaza's retainage has changed since you last saw it — $7,500.00 withheld, $2,500.00 released, $5,000.00 still held. Ask again to see the balance before releasing against it.",
    });
    expect(fake.prisma.retainageRelease.create).not.toHaveBeenCalled();
  });

  it("compares the expected balance in cents, so '5000' and '5000.00' are one balance", async () => {
    const result = await createRetainageReleaseRecord("co-1", "job-1", input, { expectedBalance: "5000" });
    expect(result.ok).toBe(true);
  });

  it("turns a serialization failure into a sentence rather than a throw, and lets any other error through", async () => {
    fake.prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error("could not serialize"), { code: "P2034" }));
    const collided = await createRetainageReleaseRecord("co-1", "job-1", input, { expectedBalance: "5000.00" });
    expect(collided).toEqual({ ok: false, error: RELEASE_COLLIDED });

    fake.prisma.$transaction.mockRejectedValueOnce(new Error("connection reset"));
    await expect(createRetainageReleaseRecord("co-1", "job-1", input)).rejects.toThrow("connection reset");
  });
});

describe("the two sentences", () => {
  const held = { summary: { totalWithheld: 7500, totalReleased: 2500, balance: 5000, substantialCompletionDate: null }, withheldCents: 750_000, releasedCents: 250_000, balanceCents: 500_000, invoicesWithRetainage: 2, releases: 1 };

  it("say 'nothing is still held' rather than a zero or a negative figure", () => {
    expect(overReleaseSentence("Riverside Plaza", 100, { ...held, releasedCents: 750_000, balanceCents: 0 })).toBe(
      "That would bring total released to $7,501.00, more than the $7,500.00 withheld on Riverside Plaza. Nothing is still held.",
    );
    expect(overReleaseSentence("Riverside Plaza", 100, { ...held, releasedCents: 800_000, balanceCents: -50_000 })).toMatch(/Nothing is still held\.$/);
  });

  it("name all three figures on a stale card, so the next card is made from the truth", () => {
    expect(balanceChangedSentence("Riverside Plaza", held)).toContain("$7,500.00 withheld, $2,500.00 released, $5,000.00 still held");
  });
});
