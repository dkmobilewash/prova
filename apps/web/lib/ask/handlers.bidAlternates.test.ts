import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * bid_alternates — the alternates, unit prices and allowances on a bid, and
 * what it comes to with them.
 *
 * THE FAILURE THIS GUARDS IS SILENT, which is why the arithmetic is asserted
 * against figures worked out here rather than read back off the code. A bid
 * that double-counts a $15,000 allowance goes out $15,000 high and nothing
 * anywhere looks wrong: the allowance is genuinely part of the job, the
 * arithmetic is genuinely addition, and only somebody reconciling against the
 * GC's own form would catch it.
 *
 * The fixture is built so that every wrong way of adding it up produces a
 * DIFFERENT, recognisable number:
 *
 *   base                                      250,000
 *   + alternates accepted (Alternate 1 only)  + 12,400  → 262,400  ← correct
 *   + every alternate offered (incl. a deduct) +  9,400 → 259,400  ← wrong
 *   + the allowance, already inside the base  + 15,000  → 277,400  ← wrong
 *   + the unit price, a rate with no quantity +   3.10  → 262,403.10 ← wrong
 *
 * So `awardedTotal` being 262,400 is not one assertion passing; it is three
 * specific mistakes failing to have been made.
 *
 * Also held still: a DEDUCT keeps its direction in a word as well as a sign,
 * because a minus sign in a table is the easiest thing on a bid document to
 * miss; and an alternate the GC has not answered is `null`, not rejected, with
 * `undecidedCount` above zero making the award total provisional.
 */

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-26" }));
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: async () => "2026-09-26",
  viewerTimeZone: async () => "UTC",
}));

type Bid = {
  companyId: string;
  projectName: string;
  status: string;
  bidAmount: string | null;
  contact: { name: string };
  lines: { kind: string; label: string; description: string | null; amount: string | null; unit: string | null; unitPrice: string | null; accepted: boolean | null }[];
};

const HARBOR: Bid = {
  companyId: "company-1",
  projectName: "Harbor lofts",
  status: "SUBMITTED",
  bidAmount: "250000.00",
  contact: { name: "Beacon GC" },
  lines: [
    { kind: "ALTERNATE", label: "Alternate 1", description: "Upgrade lobby ceiling", amount: "12400.00", unit: null, unitPrice: null, accepted: true },
    // A DEDUCT. Negative, and the direction has to survive as a word.
    { kind: "ALTERNATE", label: "Alternate 2", description: "Omit level 3 soffits", amount: "-8000.00", unit: null, unitPrice: null, accepted: null },
    { kind: "ALTERNATE", label: "Alternate 3", description: "Add acoustic batt", amount: "5000.00", unit: null, unitPrice: null, accepted: false },
    // Already INSIDE the base. Adding it is the silent failure.
    { kind: "ALLOWANCE", label: "Hardware allowance", description: null, amount: "15000.00", unit: null, unitPrice: null, accepted: null },
    // A rate, with no quantity. It belongs to no total.
    { kind: "UNIT_PRICE", label: "Unit Price A", description: "Additional 5/8 board", amount: null, unit: "SF", unitPrice: "3.10", accepted: null },
  ],
};

/** A bid with no base entered: "the alternates come to $4,000" is not an
 * award, so `awardedTotal` must be null rather than 4,000. */
const NO_BASE: Bid = {
  companyId: "company-1",
  projectName: "Northgate Medical",
  status: "INVITED",
  bidAmount: null,
  contact: { name: "Skanska" },
  lines: [
    { kind: "ALTERNATE", label: "Alternate 1", description: null, amount: "4000.00", unit: null, unitPrice: null, accepted: true },
  ],
};

/** Base number only — no lines at all, so not a row here. */
const PLAIN: Bid = {
  companyId: "company-1",
  projectName: "Riverside Medical",
  status: "INVITED",
  bidAmount: "90000.00",
  contact: { name: "Turner" },
  lines: [],
};

const OTHERS: Bid = {
  companyId: "company-2",
  projectName: "SOMEONE ELSE'S BID",
  status: "SUBMITTED",
  bidAmount: "1000000.00",
  contact: { name: "Not our GC" },
  lines: [
    { kind: "ALTERNATE", label: "THEIR ALTERNATE", description: null, amount: "777.00", unit: null, unitPrice: null, accepted: true },
  ],
};

const BIDS = [HARBOR, NO_BASE, PLAIN, OTHERS];

const matches = (bid: Bid, where: { companyId: string; projectName?: { contains: string } }) =>
  bid.companyId === where.companyId &&
  (!where.projectName || bid.projectName.toLowerCase().includes(where.projectName.contains.toLowerCase()));

const bidFindMany = vi.fn(async ({ where }: { where: { companyId: string; projectName?: { contains: string } } }) =>
  BIDS.filter((bid) => matches(bid, where)),
);

const bidFindFirst = vi.fn(async ({ where }: { where: { companyId: string; projectName?: { contains: string } } }) => {
  const match = BIDS.find((bid) => matches(bid, where));
  return match ? { id: match.projectName } : null;
});

vi.mock("@prova/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/db")>();
  const models: Record<string, unknown> = {
    bidInvitation: { findMany: bidFindMany, findFirst: bidFindFirst },
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

async function ask(projectName?: string, principal: { role: "OWNER" | "MEMBER"; jobFunction: string | null } = OWNER) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: principal as never }, "bid_alternates", { projectName });
}

type Row = {
  project: string;
  gc: string;
  baseBid: number | null;
  awardedTotal: number | null;
  alternatesOfferedTotal: number;
  alternatesAcceptedTotal: number;
  alternatesTheGcHasNotAnswered: number;
  allowancesCarriedInsideTheBase: number;
  alternates: { label: string; direction: string | null; amount: number | null; accepted: boolean | null }[];
  unitPrices: { label: string; per: string | null; rate: number | null }[];
  allowances: { label: string; amount: number | null }[];
};

const rowsOf = (data: unknown) => (data as { rows: Row[] }).rows;
const rowFor = (rows: Row[], project: string) => rows.find((row) => row.project === project)!;

beforeEach(() => {
  bidFindMany.mockClear();
  bidFindFirst.mockClear();
});

describe("bid_alternates", () => {
  it("answers only this company's bids, and only ones carrying a line", async () => {
    const rows = rowsOf((await ask()).data);
    expect(rows.map((row) => row.project).sort()).toEqual(["Harbor lofts", "Northgate Medical"]);
    // A base number with no alternates, unit prices or allowances is not a row.
    expect(rows.map((row) => row.project)).not.toContain("Riverside Medical");
    expect(rows.map((row) => row.project)).not.toContain("SOMEONE ELSE'S BID");
    expect(bidFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-1" }) }),
    );
  });

  it("adds the ACCEPTED alternates to the base and nothing else", async () => {
    // THE ASSERTION THIS FILE IS FOR. Every other way of adding this bid up
    // produces a different number — see the header.
    const harbor = rowFor(rowsOf((await ask("Harbor")).data), "Harbor lofts");
    expect(harbor.baseBid).toBe(250000);
    expect(harbor.awardedTotal).toBe(262400);
    // Not the allowance…
    expect(harbor.awardedTotal).not.toBe(277400);
    // …not every alternate offered…
    expect(harbor.awardedTotal).not.toBe(259400);
    // …and not the unit price.
    expect(harbor.awardedTotal).not.toBe(262403.1);
  });

  it("reports the allowance as carried inside the base, added to nothing", async () => {
    const harbor = rowFor(rowsOf((await ask("Harbor")).data), "Harbor lofts");
    expect(harbor.allowancesCarriedInsideTheBase).toBe(15000);
    expect(harbor.allowances).toEqual([{ label: "Hardware allowance", amount: 15000 }]);
    // The base is untouched by it, which is the whole point of reporting it.
    expect(harbor.baseBid).toBe(250000);
  });

  it("holds a unit price as a rate with no total", async () => {
    const harbor = rowFor(rowsOf((await ask("Harbor")).data), "Harbor lofts");
    expect(harbor.unitPrices).toEqual([{ label: "Unit Price A", per: "SF", rate: 3.1 }]);
    // And it is in no sum: offered, accepted and the award are all unchanged.
    expect(harbor.alternatesOfferedTotal).toBe(9400);
    expect(harbor.alternatesAcceptedTotal).toBe(12400);
  });

  it("says ADD or DEDUCT in a word, not only in the sign", async () => {
    const harbor = rowFor(rowsOf((await ask("Harbor")).data), "Harbor lofts");
    expect(harbor.alternates).toEqual([
      { label: "Alternate 1", direction: "ADD", amount: 12400, accepted: true },
      { label: "Alternate 2", direction: "DEDUCT", amount: -8000, accepted: null },
      { label: "Alternate 3", direction: "ADD", amount: 5000, accepted: false },
    ]);
  });

  it("leaves an unanswered alternate null and counts it as undecided", async () => {
    const harbor = rowFor(rowsOf((await ask("Harbor")).data), "Harbor lofts");
    // Null means the GC has not said, which is not rejected — Alternate 3 is.
    expect(harbor.alternates[1].accepted).toBeNull();
    expect(harbor.alternates[2].accepted).toBe(false);
    expect(harbor.alternatesTheGcHasNotAnswered).toBe(1);
  });

  it("refuses an award total on a bid with no base", async () => {
    const northgate = rowFor(rowsOf((await ask()).data), "Northgate Medical");
    expect(northgate.baseBid).toBeNull();
    // NOT 4,000: the alternates coming to four thousand is not an award.
    expect(northgate.awardedTotal).toBeNull();
    expect(northgate.alternatesAcceptedTotal).toBe(4000);
  });

  it("carries the counts over every bid it read", async () => {
    const { summary } = await ask();
    expect(summary).toMatchObject({
      bidsWithLines: 2,
      alternates: 4,
      alternatesAccepted: 2,
      alternatesUndecided: 1,
      unitPrices: 1,
      allowances: 1,
    });
  });

  it("says a plain bid carries none of these rather than answering empty", async () => {
    bidFindMany.mockResolvedValueOnce([]);
    const result = await ask();
    expect(result.unavailable).toMatch(/lines somebody enters from the GC's own bid form/i);
  });

  it("tells a typo from a bid with just a base number", async () => {
    const result = await ask("Harbour lofts");
    expect(result.unavailable).toBe('No bid invitation matches "Harbour lofts".');
    expect(bidFindMany).not.toHaveBeenCalled();
  });

  it("is refused to somebody without estimating access, before any read", async () => {
    const result = await ask(undefined, { role: "MEMBER", jobFunction: "FIELD" });
    expect(result.data).toBeNull();
    expect(bidFindMany).not.toHaveBeenCalled();
  });
});
