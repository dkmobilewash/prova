import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * wall_schedule — a wall run × its wall type → the estimate's quantities.
 *
 * WHY THE NUMBERS BELOW ARE WORKED OUT BY HAND IN THE COMMENTS. This handler
 * must not compute a quantity and the model must not either, so the only way
 * to prove the right arithmetic reached the answer is to state what it should
 * be independently of the code that produces it. Every figure here was
 * derived from `lib/takeoff.ts`'s own rules on paper:
 *
 *   boarded area = length × height × boarded sides, openings deducted
 *   studs        = ceil(length ÷ spacing) + 1   — the closing stud
 *   quantity     = basis × factor × (1 + waste), SUMMED then rounded
 *   labor hours  = quantity ÷ production rate, or nothing at all
 *
 * FOUR THINGS IT HOLDS STILL:
 *
 *  1. SUMMED BEFORE ROUNDING. Two runs of the same type are one line. Rounding
 *     each run then summing compounds the round-up, and on forty short runs
 *     that is forty extra sheets — so the stud line is checked against the sum
 *     of the two runs' bays rather than the sum of two rounded figures.
 *  2. A RUN WITH NO HEIGHT PRODUCES NOTHING AND IS NAMED. Not zero: a guessed
 *     ten feet is a number that looks right and gets bid.
 *  3. A COMPONENT WITH NO PRODUCTION RATE CARRIES NO LABOR, which is not the
 *     same as carrying zero hours — `laborHours` is null and the count of such
 *     lines goes back beside the total.
 *  4. ESTIMATE STAGE ONLY, matching the Estimate tab. After award the runs are
 *     the record the contract was priced from, and the tab shows no schedule —
 *     so a figure for a contracted job would cite a page that does not show it.
 */

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-26" }));
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: async () => "2026-09-26",
  viewerTimeZone: async () => "UTC",
}));

const TYPES = [
  {
    id: "type-w2",
    code: "W2",
    defaultHeightFt: "10.00",
    sides: 2,
    studSpacingIn: "16.00",
    components: [
      {
        id: "c-board",
        description: '5/8" Type X board',
        unit: "SF",
        basis: "BOARDED_SQFT",
        factor: "1.0000",
        wastePercent: "10.00",
        roundUp: false,
        productionRate: "50.0000",
      },
      {
        id: "c-stud",
        description: '3-5/8" stud',
        unit: "EA",
        basis: "STUDS",
        factor: "1.0000",
        wastePercent: "0.00",
        roundUp: true,
        // No rate: this component carries no labor at all.
        productionRate: null,
      },
    ],
  },
  {
    // No default height. A run on this type with no height of its own can
    // produce nothing, which is the point of having it here.
    id: "type-w3",
    code: "W3",
    defaultHeightFt: null,
    sides: 1,
    studSpacingIn: "16.00",
    components: [
      {
        id: "c-insul",
        description: "Batt insulation",
        unit: "SF",
        basis: "FACE_SQFT",
        factor: "1.0000",
        wastePercent: "0.00",
        roundUp: false,
        productionRate: null,
      },
    ],
  },
];

type RunRow = {
  id: string;
  companyId: string;
  label: string;
  wallTypeId: string;
  lengthFt: string;
  heightFt: string | null;
  openings: unknown;
  job: { id: string; name: string; status: string };
};

const RIVERSIDE = { id: "job-riverside", name: "Riverside Medical", status: "ESTIMATE" };
const MAPLE = { id: "job-maple", name: "Maple Street Lofts", status: "ESTIMATE" };
const CEDAR = { id: "job-cedar", name: "Cedar Park", status: "CONTRACTED" };

const RUNS: RunRow[] = [
  // 100 LF × the type's default 10 ft, boarded both sides: 2,000 SF of board
  // before waste, and ceil(100 ÷ 16") + 1 = 76 studs.
  { id: "r1", companyId: "company-1", label: "Level 2 corridor", wallTypeId: "type-w2", lengthFt: "100.00", heightFt: null, openings: [], job: RIVERSIDE },
  // 50 LF × its OWN 12 ft: 1,200 SF, and ceil(50 ÷ 16") + 1 = 39 studs.
  { id: "r2", companyId: "company-1", label: "Level 2 demising", wallTypeId: "type-w2", lengthFt: "50.00", heightFt: "12.00", openings: [], job: RIVERSIDE },
  // No height of its own, on a type with no default. Produces nothing.
  { id: "r3", companyId: "company-1", label: "Level 3 soffit", wallTypeId: "type-w3", lengthFt: "30.00", heightFt: null, openings: [], job: RIVERSIDE },
  // Its wall type is not in the company's list — deleted, or another
  // company's. Reported, never silently priced at something.
  { id: "r4", companyId: "company-1", label: "Ghost run", wallTypeId: "type-gone", lengthFt: "20.00", heightFt: "9.00", openings: [], job: RIVERSIDE },
  // 10 LF × 10 ft: 200 SF, ceil(10 ÷ 16") + 1 = 9 studs.
  { id: "m1", companyId: "company-1", label: "Unit 4 partition", wallTypeId: "type-w2", lengthFt: "10.00", heightFt: "10.00", openings: [], job: MAPLE },
  // CONTRACTED: the Estimate tab shows no schedule, so neither does this.
  { id: "c1", companyId: "company-1", label: "Already awarded", wallTypeId: "type-w2", lengthFt: "999.00", heightFt: "10.00", openings: [], job: CEDAR },
  // ANOTHER COMPANY'S run.
  { id: "x1", companyId: "company-2", label: "SOMEONE ELSE'S WALL", wallTypeId: "type-w2", lengthFt: "5000.00", heightFt: "10.00", openings: [], job: { id: "job-other", name: "Not ours", status: "ESTIMATE" } },
];

const wallTypeFindMany = vi.fn(async ({ where }: { where: { companyId: string } }) =>
  where.companyId === "company-1" ? TYPES : [],
);

const wallRunFindMany = vi.fn(
  async ({ where }: { where: { companyId: string; job: { status: string; name?: { contains: string } } } }) =>
    RUNS.filter(
      (run) =>
        run.companyId === where.companyId &&
        run.job.status === where.job.status &&
        (!where.job.name || run.job.name.toLowerCase().includes(where.job.name.contains.toLowerCase())),
    ),
);

const jobFindFirst = vi.fn(async ({ where }: { where: { companyId: string; name?: { contains: string } } }) => {
  const names = [RIVERSIDE, MAPLE, CEDAR];
  if (where.companyId !== "company-1") return null;
  const match = names.find(
    (job) => !where.name || job.name.toLowerCase().includes(where.name.contains.toLowerCase()),
  );
  return match ? { id: match.id } : null;
});

vi.mock("@prova/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/db")>();
  const models: Record<string, unknown> = {
    wallType: { findMany: wallTypeFindMany },
    wallRun: { findMany: wallRunFindMany },
    job: { findFirst: jobFindFirst },
  };
  return {
    Prisma: real.Prisma,
    prisma: new Proxy(models, {
      get(_target, key: string) {
        return (
          models[key] ?? {
            findMany: async () => [],
            findFirst: async () => null,
            findUnique: async () => null,
            count: async () => 0,
          }
        );
      },
    }),
  };
});

const OWNER = { role: "OWNER" as const, jobFunction: null };

async function ask(jobName?: string, principal: { role: "OWNER" | "MEMBER"; jobFunction: string | null } = OWNER) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: principal as never }, "wall_schedule", { jobName });
}

type Row = {
  job: string;
  runsMeasured: number;
  lines: { item: string; quantity: number; unit: string | null; laborHours: number | null }[];
  laborHours: number;
  linesWithNoProductionRate: number;
  runsWithNoHeight: string[];
  runsWhoseWallTypeIsGone: string[];
};

const rowsOf = (data: unknown) => (data as { rows: Row[] }).rows;

beforeEach(() => {
  wallTypeFindMany.mockClear();
  wallRunFindMany.mockClear();
  jobFindFirst.mockClear();
});

describe("wall_schedule", () => {
  it("answers only this company's estimate-stage jobs", async () => {
    const rows = rowsOf((await ask()).data);
    expect(rows.map((row) => row.job)).toEqual(["Maple Street Lofts", "Riverside Medical"]);
    expect(rows.map((row) => row.job)).not.toContain("Cedar Park");
    expect(rows.map((row) => row.job)).not.toContain("Not ours");
    expect(wallRunFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "company-1", job: expect.objectContaining({ status: "ESTIMATE" }) }),
      }),
    );
  });

  it("sums two runs of one type into ONE line, before rounding", async () => {
    const riverside = rowsOf((await ask("Riverside")).data).find((row) => row.job === "Riverside Medical")!;
    const board = riverside.lines.find((line) => line.item.includes("Type X"))!;
    // 2,000 SF + 1,200 SF, each at 10% waste = 2,200 + 1,320 = 3,520.
    expect(board.item).toBe('W2 — 5/8" Type X board');
    expect(board.quantity).toBe(3520);
    expect(board.unit).toBe("SF");

    const studs = riverside.lines.find((line) => line.item.includes("stud"))!;
    // 76 + 39 = 115, and the round-up is applied to the SUM, not per run.
    expect(studs.quantity).toBe(115);
  });

  it("gives a component with a production rate its hours, and one without none at all", async () => {
    const riverside = rowsOf((await ask("Riverside")).data).find((row) => row.job === "Riverside Medical")!;
    // 3,520 SF ÷ 50 SF an hour.
    expect(riverside.lines.find((line) => line.item.includes("Type X"))!.laborHours).toBe(70.4);
    // Null, NOT zero: the stud line carries no labor rate.
    expect(riverside.lines.find((line) => line.item.includes("stud"))!.laborHours).toBeNull();
    expect(riverside.laborHours).toBe(70.4);
    expect(riverside.linesWithNoProductionRate).toBe(1);
  });

  it("names a run with no height instead of pricing it at a guessed height", async () => {
    const riverside = rowsOf((await ask("Riverside")).data).find((row) => row.job === "Riverside Medical")!;
    expect(riverside.runsWithNoHeight).toEqual(["Level 3 soffit"]);
    // And W3 contributes no line at all, rather than a line of zero.
    expect(riverside.lines.map((line) => line.item)).not.toContain("W3 — Batt insulation");
    expect(riverside.lines).toHaveLength(2);
  });

  it("names a run whose wall type is gone rather than dropping it", async () => {
    const riverside = rowsOf((await ask("Riverside")).data).find((row) => row.job === "Riverside Medical")!;
    expect(riverside.runsWhoseWallTypeIsGone).toEqual(["Ghost run"]);
    // Every run on the job is still counted as measured, including the two
    // that produced nothing — otherwise the row looks smaller than it is.
    expect(riverside.runsMeasured).toBe(4);
  });

  it("carries the counts and the hours in the summary, over every job it read", async () => {
    const { summary } = await ask();
    expect(summary).toMatchObject({
      jobsWithWallRuns: 2,
      wallRuns: 5,
      scheduleLines: 4,
      runsWithNoHeight: 1,
      runsWhoseWallTypeIsGone: 1,
      // 70.4 on Riverside + 4.4 on Maple (220 SF ÷ 50).
      laborHours: 74.8,
    });
  });

  it("keeps each job's quantities to that job", async () => {
    const maple = rowsOf((await ask()).data).find((row) => row.job === "Maple Street Lofts")!;
    // 10 LF × 10 ft × 2 sides = 200 SF, +10% = 220. Nothing from Riverside.
    expect(maple.lines.find((line) => line.item.includes("Type X"))!.quantity).toBe(220);
    expect(maple.lines.find((line) => line.item.includes("stud"))!.quantity).toBe(9);
  });

  it("says a contracted job's schedule is not what this answers, rather than answering empty", async () => {
    wallRunFindMany.mockResolvedValueOnce([]);
    const result = await ask("Cedar");
    expect(result.unavailable).toMatch(/only carried while a job is still being estimated/i);
  });

  it("tells a typo from a job with no runs", async () => {
    const result = await ask("Rivrside");
    expect(result.unavailable).toBe('No job matches "Rivrside".');
    expect(wallRunFindMany).not.toHaveBeenCalled();
  });

  it("is refused to somebody without job-cost access, before any read", async () => {
    const result = await ask(undefined, { role: "MEMBER", jobFunction: "FIELD" });
    expect(result.data).toBeNull();
    expect(wallRunFindMany).not.toHaveBeenCalled();
    expect(wallTypeFindMany).not.toHaveBeenCalled();
  });
});
