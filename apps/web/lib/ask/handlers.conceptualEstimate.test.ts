import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * conceptual_estimate — what similar work has run at, before there is
 * anything to measure.
 *
 * `lib/conceptual-estimate.ts` calls this "the most dangerous kind of number
 * this product could produce": a dollars-per-square-foot figure looks exactly
 * like a measured one, is arithmetically trivial, and is wrong in ways nobody
 * can see. Print "$62,400" beside three real line-item totals and within a
 * week somebody has sent it to a GC. So the four rules it states are what this
 * file asserts, from the ASSISTANT's side of the boundary rather than the
 * screen's:
 *
 *   1. A RANGE, never a point — and the sentence the model narrates has to
 *      carry both ends of it.
 *   2. THE SAMPLE SIZE IS ALWAYS RETURNED, including when it is too small.
 *   3. BELOW THREE FINISHED JOBS THERE IS NO RANGE AT ALL, only the reason —
 *      and the reason has to reach `unavailable`, which is what tells the
 *      model to refuse rather than reach for something adjacent.
 *   4. NOTHING IS WRITTEN.
 *
 * WHAT IS MOCKED, AND WHY IT IS THE QUERY RATHER THAN PRISMA. The benchmark's
 * own query is covered against a REAL Postgres in
 * `lib/conceptual-estimate-query.dbtest.ts`, including that it counts only
 * COMPLETE jobs and only this company's. Re-faking `calculateJobWip`'s inputs
 * here would test that arithmetic a third time and test this handler's actual
 * job — parsing the area, scaling by the range, choosing what `unavailable`
 * says — less clearly. The one thing that mock could hide is tenant scoping,
 * so the company the loader is CALLED with is asserted directly.
 */

const loadConceptualBenchmark = vi.fn();
const countFinishedJobsWithoutArea = vi.fn();

vi.mock("@/lib/conceptual-estimate-query", () => ({
  loadConceptualBenchmark: (companyId: string) => loadConceptualBenchmark(companyId),
  countFinishedJobsWithoutArea: (companyId: string) => countFinishedJobsWithoutArea(companyId),
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-26" }));
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: async () => "2026-09-26",
  viewerTimeZone: async () => "UTC",
}));

vi.mock("@prova/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/db")>();
  return {
    Prisma: real.Prisma,
    prisma: new Proxy(
      {},
      {
        get: () => ({
          findMany: async () => [],
          findFirst: async () => null,
          findUnique: async () => null,
          count: async () => 0,
        }),
      },
    ),
  };
});

/** Five finished jobs behind it — enough to show a spread. */
const WITH_RANGE = {
  sampleSize: 5,
  sellPerSqFt: { low: 38, median: 54, high: 71 },
  costPerSqFt: { low: 28, median: 40, high: 55 },
  because: null,
};

/** Two. One job wearing a disguise. */
const TOO_FEW = {
  sampleSize: 2,
  sellPerSqFt: null,
  costPerSqFt: null,
  because:
    "Only 2 finished jobs carry a gross area. 3 is the fewest that can show a spread rather than one job wearing a disguise.",
};

const OWNER = { role: "OWNER" as const, jobFunction: null };

async function ask(
  areaSqFt?: string,
  principal: { role: "OWNER" | "MEMBER"; jobFunction: string | null } = OWNER,
) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: principal as never }, "conceptual_estimate", { areaSqFt });
}

type Spread = { low: number; median: number; high: number };
type Data = {
  areaSqFt: number | null;
  finishedJobsBehindThis: number;
  fewestThatCanShowASpread: number;
  finishedJobsWithNoAreaRecorded: number;
  soldPerSqFt: Spread | null;
  costPerSqFt: Spread | null;
  forThisArea: { sold: Spread; cost: Spread } | null;
  because: string | null;
  sentence: string;
  writesNothing: boolean;
};

beforeEach(() => {
  loadConceptualBenchmark.mockReset();
  countFinishedJobsWithoutArea.mockReset();
  loadConceptualBenchmark.mockResolvedValue(WITH_RANGE);
  countFinishedJobsWithoutArea.mockResolvedValue(3);
});

describe("conceptual_estimate", () => {
  it("reads only the asking company's finished work", async () => {
    await ask("40000");
    expect(loadConceptualBenchmark).toHaveBeenCalledWith("company-1");
    expect(countFinishedJobsWithoutArea).toHaveBeenCalledWith("company-1");
  });

  it("multiplies the area the person said out into a RANGE, never a figure", async () => {
    // The comma is the person's; stripping it is the app's job, because a
    // model asked to strip it is a model doing arithmetic on a bid number.
    const data = (await ask("40,000")).data as Data;
    expect(data.areaSqFt).toBe(40000);
    expect(data.forThisArea).toEqual({
      sold: { low: 1_520_000, median: 2_160_000, high: 2_840_000 },
      cost: { low: 1_120_000, median: 1_600_000, high: 2_200_000 },
    });
    // Per square foot too, so the model can quote the rate as a range.
    expect(data.soldPerSqFt).toEqual({ low: 38, median: 54, high: 71 });
    expect(data.costPerSqFt).toEqual({ low: 28, median: 40, high: 55 });
  });

  it("gives the model a sentence that carries both ends of the range and the sample size", async () => {
    const data = (await ask("40000")).data as Data;
    expect(data.sentence).toContain("From 5 finished jobs");
    expect(data.sentence).toContain("$1,520,000.00");
    expect(data.sentence).toContain("$2,840,000.00");
    expect(data.sentence).toContain("middle $2,160,000.00");
    // The hedge is the feature, and it is in the sentence rather than left to
    // the model to remember.
    expect(data.sentence).toMatch(/not an estimate, and not a price to send anybody/);
  });

  it("always returns the sample size, and what the floor is", async () => {
    const data = (await ask("40000")).data as Data;
    expect(data.finishedJobsBehindThis).toBe(5);
    expect(data.fewestThatCanShowASpread).toBe(3);
    const { summary } = await ask("40000");
    expect(summary).toMatchObject({ finishedJobsBehindThis: 5, fewestThatCanShowASpread: 3 });
  });

  it("returns NO range below the floor, and puts the reason where a refusal is read from", async () => {
    // THE ASSERTION THIS FILE IS FOR. `unavailable` is what tells the model to
    // say plainly that the data is not there rather than reach for something
    // adjacent — a median, a single job, a guess.
    loadConceptualBenchmark.mockResolvedValue(TOO_FEW);
    const result = await ask("40000");
    const data = result.data as Data;
    expect(data.soldPerSqFt).toBeNull();
    expect(data.costPerSqFt).toBeNull();
    expect(data.forThisArea).toBeNull();
    expect(data.finishedJobsBehindThis).toBe(2);
    expect(result.unavailable).toBe(TOO_FEW.because);
    expect(result.unavailable).toMatch(/one job wearing a disguise/);
  });

  it("asks for the area rather than refusing when there IS a range and no area", async () => {
    const result = await ask();
    const data = result.data as Data;
    expect(data.areaSqFt).toBeNull();
    expect(data.forThisArea).toBeNull();
    // A prompt for one more word is not the data being absent, so this must
    // NOT come back as unavailable — the per-square-foot range is a real
    // answer on its own.
    expect(result.unavailable).toBeUndefined();
    expect(data.because).toBe("Enter the building's gross area to see what similar work has run at.");
    expect(data.soldPerSqFt).toEqual({ low: 38, median: 54, high: 71 });
  });

  it("treats nonsense in the area field as no area rather than as zero dollars", async () => {
    for (const typed of ["about forty thousand", "-500", "0"]) {
      const data = (await ask(typed)).data as Data;
      expect(data.areaSqFt, typed).toBeNull();
      expect(data.forThisArea, typed).toBeNull();
      expect(data.because, typed).toMatch(/Enter the building's gross area/);
    }
  });

  it("says how many finished jobs have no area recorded, so the answer can be acted on", async () => {
    // Distinguishes "you have not finished anything" from "you have finished
    // plenty and recorded no areas" — the second is a prompt to go and fill
    // some in.
    countFinishedJobsWithoutArea.mockResolvedValue(11);
    const data = (await ask("40000")).data as Data;
    expect(data.finishedJobsWithNoAreaRecorded).toBe(11);
  });

  it("states that it writes nothing, and cites the page the figure is typed on", async () => {
    const result = await ask("40000");
    expect((result.data as Data).writesNothing).toBe(true);
    expect(result.citations).toEqual([{ label: "Bid pipeline", href: "/pipeline" }]);
    // No item link: there is no ROW this answer is about. A button here would
    // be inventing a destination.
    expect(result.links).toBeUndefined();
  });

  it("is refused to somebody without estimating access, before any read", async () => {
    const result = await ask("40000", { role: "MEMBER", jobFunction: "FIELD" });
    expect(result.data).toBeNull();
    expect(loadConceptualBenchmark).not.toHaveBeenCalled();
    expect(countFinishedJobsWithoutArea).not.toHaveBeenCalled();
  });
});
