import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * bid_levelling — "are these three quotes actually the same bid?"
 *
 * THE FAILURE THIS TOOL EXISTS TO PREVENT IS AN ANSWER, NOT AN ERROR. A sub
 * who left the soffits out is cheaper and is not comparable, and an assistant
 * that replied "Acme, $82,000, lowest" would be actively helping somebody buy
 * a hole in their own scope. So the assertions here are mostly about what the
 * result makes impossible to say:
 *
 *  1. `comparable: false` and a `caution` NAMING the excluded work travel with
 *     the cheapest figure, in the same object, so there is no shape of this
 *     result in which the low number arrives without the warning.
 *  2. AN UNANSWERED REQUEST IS NOT A QUOTE OF NOTHING. A null amount sorts to
 *     the front of an ascending sort, so a supplier who never replied would
 *     otherwise be the low bid. It must be out of the comparison and in
 *     `outstanding`, with its state.
 *  3. ONE QUOTE IS `comparable: null`, never true. "Comparable" said of a
 *     single quote is a sentence with nothing behind it.
 *  4. A PACKAGE IS GROUPED BY ITS LABEL EXACTLY AS TYPED, so a typo shows as
 *     two headings rather than merging two scopes into one comparison.
 *
 * The fake honours the where clause, so a handler that forgot to scope by
 * company returns the other company's quotes and goes red.
 */

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-26" }));
// The READER'S day, which is what decides whether a request is overdue.
let viewerDay = "2026-09-26";
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: async () => viewerDay,
  viewerTimeZone: async () => "UTC",
}));

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type Quote = {
  id: string;
  packageLabel: string;
  vendorName: string;
  amount: string | null;
  quotedOn: Date | null;
  requestedOn: Date | null;
  dueBy: Date | null;
  declinedAt: Date | null;
  exclusions: string | null;
};

type Bid = {
  companyId: string;
  projectName: string;
  status: string;
  dueDate: Date | null;
  contact: { name: string };
  quotes: Quote[];
};

const HARBOR: Bid = {
  companyId: "company-1",
  projectName: "Harbor lofts",
  status: "SUBMITTED",
  dueDate: day("2026-09-30"),
  contact: { name: "Beacon GC" },
  quotes: [
    // Lowest, and excludes something Beta covers. This pair is the whole point.
    {
      id: "q-acme",
      packageLabel: "Metal stud framing",
      vendorName: "Acme Framing",
      amount: "82000.00",
      quotedOn: day("2026-09-20"),
      requestedOn: day("2026-09-14"),
      dueBy: day("2026-09-22"),
      declinedAt: null,
      exclusions: "Soffits\nFirestopping",
    },
    {
      id: "q-beta",
      packageLabel: "Metal stud framing",
      vendorName: "Beta Interiors",
      amount: "91000.00",
      quotedOn: day("2026-09-21"),
      requestedOn: day("2026-09-14"),
      dueBy: day("2026-09-22"),
      declinedAt: null,
      exclusions: "Firestopping",
    },
    // Asked, never answered, and PAST the date we asked for.
    {
      id: "q-gamma",
      packageLabel: "Metal stud framing",
      vendorName: "Gamma Drywall",
      amount: null,
      quotedOn: null,
      requestedOn: day("2026-09-14"),
      dueBy: day("2026-09-22"),
      declinedAt: null,
      exclusions: null,
    },
    // Said no. Kept, because "Delta declined" is the answer to "why only two
    // prices" and next time it says who not to wait on.
    {
      id: "q-delta",
      packageLabel: "Metal stud framing",
      vendorName: "Delta Walls",
      amount: null,
      quotedOn: null,
      requestedOn: day("2026-09-14"),
      dueBy: day("2026-09-22"),
      declinedAt: day("2026-09-19"),
      exclusions: null,
    },
    // A package with exactly one price: comparable to nothing.
    {
      id: "q-zeta",
      packageLabel: "EIFS",
      vendorName: "Zeta Exteriors",
      amount: "40000.00",
      quotedOn: day("2026-09-19"),
      requestedOn: null,
      dueBy: null,
      declinedAt: null,
      exclusions: null,
    },
  ],
};

/** A bid nobody has collected a quote against. */
const RIVERSIDE: Bid = {
  companyId: "company-1",
  projectName: "Riverside Medical",
  status: "INVITED",
  dueDate: day("2026-10-15"),
  contact: { name: "Turner" },
  quotes: [],
};

const OTHERS: Bid = {
  companyId: "company-2",
  projectName: "SOMEONE ELSE'S BID",
  status: "SUBMITTED",
  dueDate: null,
  contact: { name: "Not our GC" },
  quotes: [
    {
      id: "q-not-ours",
      packageLabel: "Metal stud framing",
      vendorName: "NOT OUR VENDOR",
      amount: "1.00",
      quotedOn: day("2026-09-01"),
      requestedOn: null,
      dueBy: null,
      declinedAt: null,
      exclusions: null,
    },
  ],
};

const BIDS = [HARBOR, RIVERSIDE, OTHERS];

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
  return runTool({ companyId: "company-1", principal: principal as never }, "bid_levelling", { projectName });
}

type Group = {
  package: string;
  quotes: { vendor: string; amount: number; quotedOn: string | null; excludes: string | null }[];
  cheapest: { vendor: string; amount: number } | null;
  dearest: { vendor: string; amount: number } | null;
  spread: number | null;
  comparable: boolean | null;
  caution: string | null;
  outstanding: { vendor: string; state: string; askedOn: string | null; wantedBy: string | null }[];
  declined: string[];
  stillWaiting: string | null;
};

type Row = { project: string; gc: string; bidStatus: string; bidDueDate: string | null; packages: Group[] };

const rowsOf = (data: unknown) => (data as { rows: Row[] }).rows;
const packageOf = (rows: Row[], label: string) =>
  rows.flatMap((row) => row.packages).find((group) => group.package === label)!;

beforeEach(() => {
  viewerDay = "2026-09-26";
  bidFindMany.mockClear();
  bidFindFirst.mockClear();
});

describe("bid_levelling", () => {
  it("answers only this company's bids, and only ones with a quote on them", async () => {
    const rows = rowsOf((await ask()).data);
    expect(rows.map((row) => row.project)).toEqual(["Harbor lofts"]);
    // No quotes logged: nothing to compare, so it is not a row.
    expect(rows.map((row) => row.project)).not.toContain("Riverside Medical");
    expect(rows.map((row) => row.project)).not.toContain("SOMEONE ELSE'S BID");
    expect(bidFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-1" }) }),
    );
  });

  it("never hands over a cheapest figure without the caution that qualifies it", async () => {
    // THE ASSERTION THIS FILE IS FOR.
    const framing = packageOf(rowsOf((await ask()).data), "Metal stud framing");
    expect(framing.cheapest).toEqual({ vendor: "Acme Framing", amount: 82000 });
    expect(framing.comparable).toBe(false);
    expect(framing.caution).toBe(
      "Acme Framing is lowest but excludes Soffits — Beta Interiors does not. These are not the same bid.",
    );
    // The spread is computed, not left for anyone to subtract.
    expect(framing.spread).toBe(9000);
    expect(framing.dearest).toEqual({ vendor: "Beta Interiors", amount: 91000 });
  });

  it("keeps a supplier who never answered out of the comparison and names their state", async () => {
    const framing = packageOf(rowsOf((await ask()).data), "Metal stud framing");
    // Gamma has no amount. If it reached the sort it would be the low bid.
    expect(framing.quotes.map((quote) => quote.vendor)).toEqual(["Acme Framing", "Beta Interiors"]);
    expect(framing.cheapest?.vendor).not.toBe("Gamma Drywall");
    expect(framing.outstanding).toEqual([
      { vendor: "Gamma Drywall", state: "OVERDUE", askedOn: "2026-09-14", wantedBy: "2026-09-22" },
    ]);
    expect(framing.declined).toEqual(["Delta Walls"]);
    expect(framing.stillWaiting).toMatch(/Still waiting on Gamma Drywall/);
    expect(framing.stillWaiting).toMatch(/comparison here is incomplete/);
  });

  it("reads overdue off the reader's own day, not the server's", async () => {
    // Before the date asked for, the same row is simply awaited.
    viewerDay = "2026-09-20";
    const framing = packageOf(rowsOf((await ask()).data), "Metal stud framing");
    expect(framing.outstanding[0].state).toBe("AWAITED");
    expect(framing.stillWaiting).not.toMatch(/past the date/);
  });

  it("calls one quote comparable to NOTHING, never comparable", async () => {
    const eifs = packageOf(rowsOf((await ask()).data), "EIFS");
    expect(eifs.comparable).toBeNull();
    expect(eifs.comparable).not.toBe(true);
    expect(eifs.caution).toBe("Only one quote on this package — there is nothing to compare it against yet.");
    expect(eifs.spread).toBeNull();
  });

  it("groups by the package label as typed, so two scopes never merge", async () => {
    const groups = rowsOf((await ask()).data)[0].packages.map((group) => group.package);
    // Sorted by label, and the two packages stay two.
    expect(groups).toEqual(["EIFS", "Metal stud framing"]);
  });

  it("carries the figure that decides whether a low number may be quoted at all", async () => {
    const { summary } = await ask();
    expect(summary).toMatchObject({
      bidsWithQuotes: 1,
      packages: 2,
      packagesNotComparable: 1,
      packagesWithOnlyOneQuote: 1,
      quotesWithAPrice: 3,
      quotesOutstanding: 1,
      quotesDeclined: 1,
    });
  });

  it("says an empty answer means nobody recorded a quote, not that there is nothing to compare", async () => {
    bidFindMany.mockResolvedValueOnce([]);
    const result = await ask();
    expect(result.unavailable).toMatch(/nobody has recorded one/i);
  });

  it("tells a typo from a bid with no quotes", async () => {
    const result = await ask("Harbour lofts");
    expect(result.unavailable).toBe('No bid invitation matches "Harbour lofts".');
    expect(bidFindMany).not.toHaveBeenCalled();
  });

  it("is refused to somebody without estimating access, before any read", async () => {
    const result = await ask(undefined, { role: "MEMBER", jobFunction: "FIELD" });
    expect(result.data).toBeNull();
    expect(bidFindMany).not.toHaveBeenCalled();
    expect(bidFindFirst).not.toHaveBeenCalled();
  });
});
