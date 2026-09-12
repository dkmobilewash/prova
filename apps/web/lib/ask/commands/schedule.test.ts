import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * reschedule_job against a fake Prisma and a faked core.
 *
 * What is pinned is what a person would be hurt by if it drifted: that
 * both dates on the card were read off the row and the new ones parsed
 * from the person's words against THEIR today, that a date the row
 * already holds is said and not carded, that an end before a start is
 * refused in the action's own sentence before a card exists, that
 * ambiguity is a chip row and not a pick, and on execute the exact
 * arguments the core receives — including the dates the card was made
 * from, which are what make the tap safe against somebody else's edit.
 */
const fake = vi.hoisted(() => ({
  prisma: { job: { findMany: vi.fn(), findFirst: vi.fn() } },
  setJobScheduleDates: vi.fn(),
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/estimating/job-schedule", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/estimating/job-schedule")>()),
  setJobScheduleDates: fake.setJobScheduleDates,
}));

const { rescheduleJobCommand } = await import("./schedule");
const { schemaInput } = await import("../commands");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-11" };
const riverside = { id: "job-1", name: "Riverside Plaza", status: "IN_PROGRESS", contact: { name: "Turner" } };
const annex = { id: "job-2", name: "Riverside Annex", status: "IN_PROGRESS", contact: { name: "Turner" } };
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const row = (over: Partial<{ startDate: Date | null; endDate: Date | null }> = {}) => ({
  startDate: utc("2026-10-01"),
  endDate: utc("2026-11-13"),
  contact: { name: "Turner" },
  ...over,
});

beforeEach(() => {
  fake.prisma.job.findMany.mockReset();
  fake.prisma.job.findFirst.mockReset();
  fake.setJobScheduleDates.mockReset();
});

const line = (result: { kind: string; preview?: { label: string; value: string }[] }, label: string) =>
  result.preview?.find((l) => l.label === label)?.value;

describe("reschedule_job", () => {
  it("is the first T2 modify: DIRECT over the lifted core, offered on MANAGE_JOBS, standing in for updateJobSchedule", () => {
    expect(rescheduleJobCommand.tier).toBe("T2_MODIFY");
    expect(rescheduleJobCommand.mode).toBe("DIRECT");
    expect(rescheduleJobCommand.core).toBe("setJobScheduleDates");
    expect(rescheduleJobCommand.action).toBe("updateJobSchedule");
    expect(rescheduleJobCommand.capability).toBe("MANAGE_JOBS");
    expect(rescheduleJobCommand.continuationKeys).toEqual(["jobId"]);
    expect(Object.keys(rescheduleJobCommand.input_schema.properties)).toEqual(["jobName", "startDate", "endDate"]);
  });

  it("keeps the person's words as words, and drops anything else the model sends", () => {
    const input = schemaInput(
      rescheduleJobCommand,
      { jobName: "Riverside", startDate: "October 6", wasStartDate: "2020-01-01", jobId: "forged", companyId: "x" },
      "model",
    );
    expect(input).toEqual({ jobName: "Riverside", startDate: "October 6" });
  });

  it("asks which job before it reads anything", async () => {
    const result = await rescheduleJobCommand.resolve(ctx, { startDate: "October 6" });
    expect(result.kind).toBe("need");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
    expect(fake.prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it("asks for a date when neither was given, before reading the row", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside" });
    expect(result.kind).toBe("need");
    if (result.kind !== "need") throw new Error("unreachable");
    expect(result.missing).toMatch(/start or end date for Riverside Plaza/);
    expect(fake.prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it("asks which job when the name matches two", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside, annex]);
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", startDate: "October 6" });
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("jobId");
  });

  it("asks again, quoting the words, when the date is not one the parser knows — never a guess", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row());
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", startDate: "sometime next month" });
    expect(result.kind).toBe("need");
    if (result.kind !== "need") throw new Error("unreachable");
    expect(result.missing).toContain('"sometime next month"');
    expect(result.missing).toMatch(/^the new start date as a calendar day/);
  });

  it("offers both years as chips for a month-day that has already passed this year", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row());
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", startDate: "September 1" });
    expect(result).toEqual({
      kind: "clarify",
      field: "startDate",
      question: '"September 1" has already passed this year — which start date?',
      options: [
        { value: "2026-09-01", label: "Sep 1, 2026 (Tuesday)", detail: "10 days ago" },
        { value: "2027-09-01", label: "Sep 1, 2027 (Wednesday)", detail: "in 355 days" },
      ],
    });
  });

  it("offers earlier and later as chips for 'back a week', counted from the date on the row", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row());
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", startDate: "back a week" });
    expect(result).toEqual({
      kind: "clarify",
      field: "startDate",
      question: '"back a week" from Riverside Plaza\'s start of Oct 1, 2026 (Thursday) — which way?',
      options: [
        { value: "2026-09-24", label: "Earlier: Sep 24, 2026 (Thursday)" },
        { value: "2026-10-08", label: "Later: Oct 8, 2026 (Thursday)" },
      ],
    });
  });

  it("asks for the date itself when a relative phrase has no date on the row to move from", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row({ endDate: null }));
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", endDate: "a week later" });
    expect(result.kind).toBe("need");
    if (result.kind !== "need") throw new Error("unreachable");
    expect(result.missing).toBe('the end date itself — Riverside Plaza has no end date on record to move "a week later" from');
  });

  it("says so and offers no card when the date named is already the one on the row", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row());
    const one = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", startDate: "October 1" });
    expect(one).toEqual({
      kind: "refuse",
      reason: "Riverside Plaza's start date is already Oct 1, 2026 (Thursday). Nothing to change.",
      href: "/jobs/job-1",
    });
    const both = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", startDate: "10/1", endDate: "Nov 13" });
    expect(both).toEqual({
      kind: "refuse",
      reason: "Riverside Plaza already starts Oct 1, 2026 (Thursday) and ends Nov 13, 2026 (Friday). Nothing to change.",
      href: "/jobs/job-1",
    });
  });

  it("refuses an end before the start in the action's own words, before any card", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row());
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", endDate: "September 20" });
    expect(result).toEqual({
      kind: "refuse",
      reason: "End date can't be before the start date: Riverside Plaza would start Oct 1, 2026 (Thursday) and end Sep 20, 2026 (Sunday).",
      href: "/jobs/job-1",
    });
  });

  it("puts current and new side by side, both read from the row or parsed from the words, and carries the current dates for the tap", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row());
    const result = await rescheduleJobCommand.resolve(ctx, {
      jobName: "Riverside",
      startDate: "October 6",
      endDate: "November 20",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.preview).toEqual([
      { label: "Job", value: "Riverside Plaza · Turner" },
      { label: "Current start", value: "Oct 1, 2026 (Thursday)" },
      { label: "New start", value: "Oct 6, 2026 (Tuesday)" },
      { label: "Current end", value: "Nov 13, 2026 (Friday)" },
      { label: "New end", value: "Nov 20, 2026 (Friday)" },
    ]);
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Riverside Plaza",
      startDate: "2026-10-06",
      endDate: "2026-11-20",
      wasStartDate: "2026-10-01",
      wasEndDate: "2026-11-13",
    });
    expect(result.warnings).toEqual([]);
    expect(result.existing).toBeUndefined();
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", companyId: "co-1" },
      select: { startDate: true, endDate: true, contact: { select: { name: true } } },
    });
  });

  it("leaves a date the person did not mention unchanged, and says so on the card", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row());
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", endDate: "November 20" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(line(result, "New start")).toBe("unchanged");
    expect(line(result, "New end")).toBe("Nov 20, 2026 (Friday)");
    expect(result.resolved.startDate).toBe("2026-10-01");
    expect(result.resolved.wasStartDate).toBe("2026-10-01");
  });

  it("shows 'not set' for a date the row does not have", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row({ startDate: null, endDate: null }));
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", startDate: "next Monday" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(line(result, "Current start")).toBe("not set");
    expect(line(result, "New start")).toBe("Sep 14, 2026 (Monday)");
    expect(line(result, "Current end")).toBe("not set");
    expect(line(result, "New end")).toBe("unchanged");
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Riverside Plaza",
      startDate: "2026-09-14",
      endDate: null,
      wasStartDate: null,
      wasEndDate: null,
    });
  });

  it("warns when one of two named dates is already on the row, and changes only the other", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row());
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", startDate: "October 1", endDate: "Nov 20" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(line(result, "New start")).toBe("unchanged — already that date");
    expect(result.warnings).toEqual([
      "Riverside Plaza's start date is already Oct 1, 2026 (Thursday); only the end changes.",
    ]);
    expect(result.resolved.endDate).toBe("2026-11-20");
  });

  it("moves a relative phrase from the row's own date, not from today", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue(row());
    const result = await rescheduleJobCommand.resolve(ctx, { jobName: "Riverside", endDate: "a week later" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.endDate).toBe("2026-11-20");
  });

  it("takes a chip's ISO answer on the date field and its jobId, re-asserting the job in-company", async () => {
    fake.prisma.job.findFirst
      .mockResolvedValueOnce({ id: "job-1", name: "Riverside Plaza" })
      .mockResolvedValueOnce(row({ endDate: null }));
    const result = await rescheduleJobCommand.resolve(ctx, { jobId: "job-1", startDate: "2027-09-01" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.startDate).toBe("2027-09-01");
    expect(fake.prisma.job.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: "job-1", companyId: "co-1" },
      select: { id: true, name: true },
    });
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("refuses a chip jobId that is not this company's", async () => {
    fake.prisma.job.findFirst.mockResolvedValue(null);
    const result = await rescheduleJobCommand.resolve(ctx, { jobId: "someone-elses", startDate: "October 6" });
    expect(result).toEqual({ kind: "refuse", reason: "That job isn't on your account." });
  });

  describe("execute", () => {
    const payload = {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      startDate: "2026-10-06",
      endDate: "2026-11-20",
      wasStartDate: "2026-10-01",
      wasEndDate: null,
    };

    it("hands the core the new dates AND the dates the card was made from, at UTC midnight", async () => {
      fake.setJobScheduleDates.mockResolvedValue({ ok: true, value: { startDate: utc("2026-10-06"), endDate: utc("2026-11-20") } });
      const result = await rescheduleJobCommand.execute!(ctx, payload);
      expect(fake.setJobScheduleDates).toHaveBeenCalledWith("co-1", "job-1", {
        startDate: utc("2026-10-06"),
        endDate: utc("2026-11-20"),
        expected: { startDate: utc("2026-10-01"), endDate: null },
      });
      expect(result).toEqual({
        ok: true,
        message: "Riverside Plaza now starts Oct 6, 2026 (Tuesday) and ends Nov 20, 2026 (Friday).",
        created: { label: "Riverside Plaza", href: "/jobs/job-1", targetType: "Job", targetId: "job-1" },
        revalidate: ["/schedule"],
      });
    });

    it("passes the core's sentence through untouched when the row moved or the dates are backwards", async () => {
      fake.setJobScheduleDates.mockResolvedValue({ ok: false, error: "Riverside Plaza's dates have changed since you last saw them — it now runs Oct 2, 2026 to Nov 13, 2026. Ask again to see the current dates before moving them." });
      const result = await rescheduleJobCommand.execute!(ctx, payload);
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/^Riverside Plaza's dates have changed since you last saw them/) });
    });

    it("refuses a payload whose dates are not ISO days without calling the core", async () => {
      const result = await rescheduleJobCommand.execute!(ctx, { ...payload, startDate: "October 6" });
      expect(result).toEqual({ ok: false, error: "That card can't be executed. Ask again." });
      const missing = await rescheduleJobCommand.execute!(ctx, { jobId: "job-1", jobName: "R", startDate: "2026-10-06", endDate: null });
      expect(missing).toEqual({ ok: false, error: "That card can't be executed. Ask again." });
      expect(fake.setJobScheduleDates).not.toHaveBeenCalled();
    });
  });
});
