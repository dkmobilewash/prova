import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The lifted core against a fake Prisma. What only a database can prove —
 * that the compare-and-set is atomic and actually refuses a row that moved
 * — is in lib/actions/ask.dbtest.ts. What is pinned here is the shape of
 * the one statement: the WHERE names the dates the caller last saw, nulls
 * included, the SET touches only the two date columns, and the two
 * refusals arrive as sentences before or instead of a write.
 */
const fake = vi.hoisted(() => ({ prisma: { job: { updateMany: vi.fn(), findFirst: vi.fn() } } }));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { END_BEFORE_START, describeScheduleDates, setJobScheduleDates } = await import("./job-schedule");

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

beforeEach(() => {
  fake.prisma.job.updateMany.mockReset();
  fake.prisma.job.findFirst.mockReset();
});

describe("setJobScheduleDates", () => {
  it("refuses an end before the start in the action's own words, without writing", async () => {
    const result = await setJobScheduleDates("co-1", "job-1", {
      startDate: utc("2026-12-01"),
      endDate: utc("2026-11-20"),
      expected: { startDate: null, endDate: null },
    });
    expect(result).toEqual({ ok: false, error: END_BEFORE_START });
    expect(END_BEFORE_START).toBe("End date can't be before the start date");
    expect(fake.prisma.job.updateMany).not.toHaveBeenCalled();
  });

  it("writes only the two date columns, and only while the row still holds the dates the caller saw — nulls included", async () => {
    fake.prisma.job.updateMany.mockResolvedValue({ count: 1 });
    const result = await setJobScheduleDates("co-1", "job-1", {
      startDate: utc("2026-10-06"),
      endDate: utc("2026-11-20"),
      expected: { startDate: utc("2026-10-01"), endDate: null },
    });
    expect(fake.prisma.job.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", companyId: "co-1", startDate: utc("2026-10-01"), endDate: null },
      data: { startDate: utc("2026-10-06"), endDate: utc("2026-11-20") },
    });
    expect(result).toEqual({ ok: true, value: { startDate: utc("2026-10-06"), endDate: utc("2026-11-20") } });
    expect(fake.prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it("names what the row holds now when nothing matched because the dates moved", async () => {
    fake.prisma.job.updateMany.mockResolvedValue({ count: 0 });
    fake.prisma.job.findFirst.mockResolvedValue({ name: "Riverside Plaza", startDate: utc("2026-10-02"), endDate: utc("2026-11-13") });
    const result = await setJobScheduleDates("co-1", "job-1", {
      startDate: utc("2026-10-06"),
      endDate: null,
      expected: { startDate: utc("2026-10-01"), endDate: null },
    });
    expect(result).toEqual({
      ok: false,
      error:
        "Riverside Plaza's dates have changed since you last saw them — it now runs Oct 2, 2026 to Nov 13, 2026. Ask again to see the current dates before moving them.",
    });
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", companyId: "co-1" },
      select: { name: true, startDate: true, endDate: true },
    });
  });

  it("says 'Job not found' when nothing matched because the job is not this company's", async () => {
    fake.prisma.job.updateMany.mockResolvedValue({ count: 0 });
    fake.prisma.job.findFirst.mockResolvedValue(null);
    const result = await setJobScheduleDates("co-1", "someone-elses", {
      startDate: utc("2026-10-06"),
      endDate: null,
      expected: { startDate: null, endDate: null },
    });
    expect(result).toEqual({ ok: false, error: "Job not found" });
  });
});

describe("describeScheduleDates", () => {
  it("covers all four shapes a row can be in", () => {
    expect(describeScheduleDates({ startDate: utc("2026-10-01"), endDate: utc("2026-11-13") })).toBe("runs Oct 1, 2026 to Nov 13, 2026");
    expect(describeScheduleDates({ startDate: utc("2026-10-01"), endDate: null })).toBe("starts Oct 1, 2026 with no end date set");
    expect(describeScheduleDates({ startDate: null, endDate: utc("2026-11-13") })).toBe("has no start date set and ends Nov 13, 2026");
    expect(describeScheduleDates({ startDate: null, endDate: null })).toBe("has no dates set");
  });
});
