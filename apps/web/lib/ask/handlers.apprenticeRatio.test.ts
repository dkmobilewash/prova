import { describe, expect, it, vi } from "vitest";

/**
 * apprentice_ratio — and the verdict that must refuse to be optimistic.
 *
 * This is the one tool in the registry whose answer could be quoted into a
 * certified-payroll conversation, so the only interesting question about it
 * is what it says when it does not know.
 *
 * A month containing days nobody could classify is NOT a compliant month.
 * It is a month nobody can certify. `daysOver === 0` is true of such a
 * month and means nothing, so a verdict computed from that alone is
 * confidently wrong in the one direction that costs money.
 *
 * Every figure comes from `loadRatioReviews`, which is what
 * /union-compliance renders. Faked here so the verdict is what is under
 * test rather than the ratio arithmetic, which `apprentice-ratio.test.ts`
 * already owns.
 */

const TODAY = "2026-09-17";

const RULE = { apprenticeCount: 1, journeymenCount: 3, programStandardReference: null };

const REVIEWS = [
  {
    jobId: "job-1",
    jobName: "Riverside Medical",
    unionLocalId: "local-1",
    unionLocalLabel: "Carpenters Local 213",
    rule: RULE,
    days: [],
    summary: { daysChecked: 18, daysWithin: 18, daysOver: 0, daysIncomplete: 0, worstExcessHours: 0, offendingDates: [] },
  },
  {
    // Over on two days. The obvious failure, and the easy one.
    jobId: "job-2",
    jobName: "Northgate Apartments",
    unionLocalId: "local-1",
    unionLocalLabel: "Carpenters Local 213",
    rule: RULE,
    days: [],
    summary: {
      daysChecked: 20,
      daysWithin: 18,
      daysOver: 2,
      daysIncomplete: 0,
      worstExcessHours: 6.5,
      offendingDates: ["2026-09-03", "2026-09-11"],
    },
  },
  {
    // NEVER over — and three days nobody could classify. The row this file
    // exists for: `daysOver === 0` is true and says nothing.
    jobId: "job-3",
    jobName: "Cedar Park Elementary",
    unionLocalId: "local-2",
    unionLocalLabel: "Plasterers Local 200",
    rule: RULE,
    days: [],
    summary: { daysChecked: 15, daysWithin: 12, daysOver: 0, daysIncomplete: 3, worstExcessHours: 0, offendingDates: [] },
  },
  {
    // Hours worked against a local with NO rule on file. There is no
    // verdict to give, and "in ratio" would be one from a rule that does
    // not exist.
    jobId: "job-4",
    jobName: "Lakeshore Retail",
    unionLocalId: "local-3",
    unionLocalLabel: "Laborers Local 300",
    rule: null,
    days: [],
    summary: { daysChecked: 9, daysWithin: 9, daysOver: 0, daysIncomplete: 0, worstExcessHours: 0, offendingDates: [] },
  },
];

const seenMonths: string[] = [];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: { job: { findFirst: async () => null } },
}));

vi.mock("@/lib/union-compliance-query", () => ({
  loadRatioReviews: async (_companyId: string, month: string) => {
    seenMonths.push(month);
    return REVIEWS;
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

type Row = {
  job: string;
  unionLocal: string;
  rule: string | null;
  daysOver: number;
  daysIncomplete: number;
  worstExcessHours: number;
  inRatio: boolean | null;
};

async function ask(input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, "apprentice_ratio", input);
}

describe("apprentice_ratio", () => {
  it("says in ratio only when a month is clean AND complete", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    expect(rows.find((row) => row.job === "Riverside Medical")!.inRatio).toBe(true);
  });

  it("says NOT in ratio when days went over", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    const over = rows.find((row) => row.job === "Northgate Apartments")!;
    expect(over.inRatio).toBe(false);
    expect(over.daysOver).toBe(2);
    expect(over.worstExcessHours).toBe(6.5);
  });

  it("REFUSES to call a month with unclassified hours compliant", async () => {
    // The finding. daysOver is 0 on this job and that is not evidence of
    // anything — three days could not be judged. A verdict read off
    // daysOver alone reports this as in ratio.
    const { rows } = (await ask()).data as { rows: Row[] };
    const incomplete = rows.find((row) => row.job === "Cedar Park Elementary")!;
    expect(incomplete.daysOver).toBe(0);
    expect(incomplete.daysIncomplete).toBe(3);
    expect(incomplete.inRatio, "unclassified hours are not compliance").toBe(false);
  });

  it("gives NO verdict where no rule is on file, rather than a favourable one", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    const noRule = rows.find((row) => row.job === "Lakeshore Retail")!;
    expect(noRule.rule).toBeNull();
    expect(noRule.inRatio).toBeNull();
  });

  it("renders the rule as the page's own phrase, so it cannot be read upside down", async () => {
    const { rows } = (await ask()).data as { rows: Row[] };
    expect(rows[0].rule).toBe("1 apprentice per 3 journeymen");
  });

  it("counts the jobs worth acting on", async () => {
    const result = await ask();
    expect(result.summary).toEqual({
      jobsReviewed: 4,
      jobsOverRatio: 1,
      jobsWithUnclassifiedHours: 1,
    });
  });

  it("uses the month the person named", async () => {
    seenMonths.length = 0;
    await ask({ month: "2026-08" });
    expect(seenMonths).toEqual(["2026-08"]);
  });

  it("falls back to this month on one it cannot read, never to nothing", async () => {
    // An empty review reads as "you were in ratio", which is the wrong
    // answer about a month nobody checked.
    seenMonths.length = 0;
    await ask({ month: "last August" });
    expect(seenMonths).toEqual(["2026-09"]);
  });

  it("rejects an impossible month rather than passing it through", async () => {
    seenMonths.length = 0;
    await ask({ month: "2026-13" });
    expect(seenMonths).toEqual(["2026-09"]);
  });
});
