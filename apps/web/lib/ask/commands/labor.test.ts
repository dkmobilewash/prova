import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The hours command against a fake Prisma and a faked action. Pinned: that
 * the date on the card is ctx.today and nothing the model supplied, that
 * hours are the person's digits or a question, that a pay type is only
 * what the person said (and straight time with a warning otherwise), that
 * a chip's person is re-asserted in-company, and the FormData the action
 * receives field by field.
 */
const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      job: { findMany: fn(), findFirst: fn() },
      user: { findMany: fn(), findFirst: fn() },
      timeEntry: { findFirst: fn() },
    },
    logTimeEntry: vi.fn(),
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/actions/labor", () => ({ logTimeEntry: fake.logTimeEntry }));

const { logTimeEntryCommand, payTypeFrom } = await import("./labor");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-08" };
const riverside = { id: "job-1", name: "Riverside Plaza", status: "IN_PROGRESS", contact: { name: "Turner" } };
const mike = { id: "u-7", name: "Mike Rowe", email: "mike@example.test", jobFunction: "FIELD" };

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) for (const m of Object.values(model)) m.mockReset();
  fake.logTimeEntry.mockReset();
});

describe("payTypeFrom", () => {
  it("is what the person said, or straight time flagged as a guess", () => {
    expect(payTypeFrom(undefined)).toEqual({ payType: "STRAIGHT", recognised: true });
    expect(payTypeFrom("overtime")).toEqual({ payType: "OVERTIME", recognised: true });
    expect(payTypeFrom("OT")).toEqual({ payType: "OVERTIME", recognised: true });
    expect(payTypeFrom("time and a half")).toEqual({ payType: "OVERTIME", recognised: true });
    expect(payTypeFrom("double time")).toEqual({ payType: "DOUBLE_TIME", recognised: true });
    expect(payTypeFrom("swing shift")).toEqual({ payType: "SHIFT_DIFFERENTIAL", recognised: true });
    expect(payTypeFrom("regular")).toEqual({ payType: "STRAIGHT", recognised: true });
    expect(payTypeFrom("banana")).toEqual({ payType: "STRAIGHT", recognised: false });
  });
});

describe("log_time_entry", () => {
  it("asks for the job before it reads, then the person, then the hours", async () => {
    expect((await logTimeEntryCommand.resolve(ctx, { hours: "8" })).kind).toBe("need");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();

    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    const who = await logTimeEntryCommand.resolve(ctx, { jobName: "Riverside", hours: "8" });
    expect(who).toEqual({ kind: "need", missing: "who the hours are for" });
    expect(fake.prisma.user.findMany).not.toHaveBeenCalled();

    fake.prisma.user.findMany.mockResolvedValue([mike]);
    const howMany = await logTimeEntryCommand.resolve(ctx, { jobName: "Riverside", employeeName: "Mike" });
    expect(howMany).toEqual({ kind: "need", missing: "how many hours" });
  });

  it("refuses with the Team page when nobody matches, and offers chips when two do", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.user.findMany.mockResolvedValue([]);
    const nobody = await logTimeEntryCommand.resolve(ctx, { jobName: "Riverside", employeeName: "Zed", hours: "8" });
    expect(nobody.kind).toBe("refuse");
    if (nobody.kind !== "refuse") throw new Error("unreachable");
    expect(nobody.href).toBe("/team");
    expect(fake.prisma.user.findMany.mock.calls[0][0]).toMatchObject({ where: { companyId: "co-1" } });

    fake.prisma.user.findMany.mockResolvedValue([mike, { ...mike, id: "u-8", name: "Mike Tran", email: "mtran@example.test" }]);
    const which = await logTimeEntryCommand.resolve(ctx, { jobName: "Riverside", employeeName: "Mike", hours: "8" });
    expect(which.kind).toBe("clarify");
    if (which.kind !== "clarify") throw new Error("unreachable");
    expect(which.field).toBe("employeeUserId");
    expect(which.options.map((o) => o.label)).toEqual(["Mike Rowe", "Mike Tran"]);
  });

  it("asks again when the hours are not a plain number or more than a day", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.user.findMany.mockResolvedValue([mike]);
    const words = await logTimeEntryCommand.resolve(ctx, { jobName: "Riverside", employeeName: "Mike", hours: "eight" });
    expect(words.kind).toBe("need");
    if (words.kind !== "need") throw new Error("unreachable");
    expect(words.missing).toContain('"eight"');
    const tooMany = await logTimeEntryCommand.resolve(ctx, { jobName: "Riverside", employeeName: "Mike", hours: "30" });
    expect(tooMany.kind).toBe("need");
    if (tooMany.kind !== "need") throw new Error("unreachable");
    expect(tooMany.missing).toContain("up to 24");
  });

  it("puts today on the person's calendar on the card, straight time unless said otherwise", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.user.findMany.mockResolvedValue([mike]);
    const result = await logTimeEntryCommand.resolve(ctx, { jobName: "Riverside", employeeName: "Mike", hours: "8 hrs" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Riverside Plaza",
      employeeUserId: "u-7",
      employeeName: "Mike Rowe",
      date: "2026-09-08",
      hours: "8",
      payType: "STRAIGHT",
      note: null,
    });
    const line = (label: string) => result.preview.find((l) => l.label === label)?.value;
    expect(line("Date")).toContain("2026-09-08");
    expect(line("Hours")).toBe("8 hours");
    expect(line("Pay type")).toBe("straight time");
    expect(result.warnings).toEqual([]);
  });

  it("warns about a pay type it does not know and about more than 12 hours, and keeps what was said", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.user.findMany.mockResolvedValue([mike]);
    const result = await logTimeEntryCommand.resolve(ctx, {
      jobName: "Riverside",
      employeeName: "Mike",
      hours: "14",
      payType: "banana",
      note: "night pour",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toMatchObject({ hours: "14", payType: "STRAIGHT", note: "night pour" });
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('"banana"');
    expect(result.warnings[1]).toContain("12 hours");

    const overtime = await logTimeEntryCommand.resolve(ctx, { jobName: "Riverside", employeeName: "Mike", hours: "2", payType: "OT" });
    if (overtime.kind !== "ready") throw new Error("unreachable");
    expect(overtime.resolved).toMatchObject({ payType: "OVERTIME" });
    expect(overtime.warnings).toEqual([]);
  });

  it("re-asserts a chip's person in this company", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", name: "Riverside Plaza" });
    fake.prisma.user.findFirst.mockResolvedValue(null);
    const result = await logTimeEntryCommand.resolve(ctx, { jobId: "job-1", employeeUserId: "u-99", hours: "8" });
    expect(result).toEqual({ kind: "refuse", reason: "That person isn't on your team." });
    expect(fake.prisma.user.findFirst.mock.calls[0][0]).toMatchObject({ where: { id: "u-99", companyId: "co-1" } });
    expect(fake.prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("calls the action with exactly the fields the form would have posted", async () => {
    fake.logTimeEntry.mockResolvedValue({ ok: true });
    fake.prisma.timeEntry.findFirst.mockResolvedValue({ id: "t-1" });
    const result = await logTimeEntryCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      employeeUserId: "u-7",
      employeeName: "Mike Rowe",
      date: "2026-09-08",
      hours: "8",
      payType: "OVERTIME",
      note: null,
    });
    expect(fake.logTimeEntry).toHaveBeenCalledTimes(1);
    const [jobId, fd] = fake.logTimeEntry.mock.calls[0] as [string, FormData];
    expect(jobId).toBe("job-1");
    expect(fd.get("employeeUserId")).toBe("u-7");
    expect(fd.get("date")).toBe("2026-09-08");
    expect(fd.get("hours")).toBe("8");
    expect(fd.get("payType")).toBe("OVERTIME");
    expect(fd.has("note")).toBe(false);
    expect(fd.has("lineItemId")).toBe(false);
    expect(fd.has("craftClassificationId")).toBe(false);
    expect(fake.prisma.timeEntry.findFirst.mock.calls[0][0]).toMatchObject({
      where: { jobId: "job-1", employeeUserId: "u-7", date: new Date("2026-09-08T00:00:00.000Z") },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.message).toBe("Logged 8 hours for Mike Rowe on Riverside Plaza, 2026-09-08.");
    expect(result.created).toMatchObject({ href: "/jobs/job-1", targetType: "TimeEntry", targetId: "t-1" });
  });

  it("puts the action's own refusal on the card", async () => {
    fake.logTimeEntry.mockResolvedValue({
      ok: false,
      error: "That looks like the same time entry submitted moments ago — check the list below before logging it again.",
    });
    const result = await logTimeEntryCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      employeeUserId: "u-7",
      employeeName: "Mike Rowe",
      date: "2026-09-08",
      hours: "8",
      payType: "STRAIGHT",
    });
    expect(result).toEqual({
      ok: false,
      error: "That looks like the same time entry submitted moments ago — check the list below before logging it again.",
    });
  });
});
