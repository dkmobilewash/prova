import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * bid_compliance — "is there anything left that would get this bid thrown
 * out?"
 *
 * THERE IS NO COMPLIANT VERDICT, AND THAT IS WHAT THIS FILE GUARDS. Every
 * other estimating tool makes the number better; this one is about the bid
 * being READ at all, and it is the single screen in the app where being wrong
 * costs the whole bid. `lib/bid-responsiveness.ts` deliberately returns
 * `outstanding` and never `ready`, because this app has never read the GC's
 * Invitation to Bid — it has read what somebody typed in from it.
 *
 * So the assertions are:
 *
 *  1. The best sentence available says nothing outstanding THAT THIS APP CAN
 *     SEE, and names the ITB it has not read. "Compliant", "complete" and
 *     "ready to submit" must appear nowhere in any result.
 *  2. AN UNACKNOWLEDGED ADDENDUM LEADS, because it is the most common reason
 *     a complying low bid is rejected.
 *  3. DERIVED and RECORDED are distinguished on every item. An unpriced
 *     alternate goes away when it is priced; a bond either was obtained or
 *     was not, and only a person can say. "Go and price it" and "go and
 *     confirm you did it" are different jobs.
 *  4. AN OPTIONAL ITEM OUTSTANDING IS NOT NON-RESPONSIVENESS. It is shown and
 *     it is not counted as blocking.
 *  5. A REPRICE WARNING IS NOT A PAPERWORK FAILURE. An addendum that changed
 *     work already priced means a NUMBER may now be wrong, and it is reported
 *     apart from the outstanding list so the two cannot be read as one.
 */

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-26" }));
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: async () => "2026-09-26",
  viewerTimeZone: async () => "UTC",
}));

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type Bid = {
  companyId: string;
  projectName: string;
  status: string;
  dueDate: Date | null;
  contact: { name: string };
  lines: { id: string; kind: string; label: string; amount: string | null; unit: string | null; unitPrice: string | null; accepted: boolean | null }[];
  addenda: { id: string; reference: string; issuedOn: Date | null; acknowledgedOn: Date | null; affectsPricedScope: boolean; impactNote: string | null }[];
  requirements: { id: string; kind: string; label: string; required: boolean; satisfiedOn: Date | null }[];
};

const HARBOR: Bid = {
  companyId: "company-1",
  projectName: "Harbor lofts",
  status: "INVITED",
  dueDate: day("2026-09-30"),
  contact: { name: "Beacon GC" },
  lines: [
    { id: "l-alt1", kind: "ALTERNATE", label: "Alternate 1", amount: "12400.00", unit: null, unitPrice: null, accepted: true },
    // Blank: derived, blocking, and it goes away the moment it is priced.
    { id: "l-alt2", kind: "ALTERNATE", label: "Alternate 2", amount: null, unit: null, unitPrice: null, accepted: null },
    { id: "l-up", kind: "UNIT_PRICE", label: "Unit Price A", amount: null, unit: "SF", unitPrice: null, accepted: null },
    { id: "l-allow", kind: "ALLOWANCE", label: "Hardware allowance", amount: null, unit: null, unitPrice: null, accepted: null },
  ],
  addenda: [
    { id: "ad1", reference: "Addendum 1", issuedOn: day("2026-09-10"), acknowledgedOn: day("2026-09-11"), affectsPricedScope: false, impactNote: null },
    // Not acknowledged AND it changed priced work: two different problems on
    // one row, and they must come back apart.
    { id: "ad2", reference: "Addendum 2", issuedOn: day("2026-09-18"), acknowledgedOn: null, affectsPricedScope: true, impactNote: "Soffit detail at the lobby" },
  ],
  requirements: [
    { id: "rq-bond", kind: "BID_BOND", label: "Bid bond, 10% of base bid, AIA A310", required: true, satisfiedOn: null },
    // Optional and outstanding: worth showing, not a reason to call the bid
    // non-responsive.
    { id: "rq-dbe", kind: "PARTICIPATION_FORMS", label: "DBE participation forms", required: false, satisfiedOn: null },
    { id: "rq-form", kind: "SIGNED_BID_FORM", label: "GC bid form, signed", required: true, satisfiedOn: day("2026-09-20") },
  ],
};

/** Nothing outstanding — which is the case where the wording matters most. */
const CLEAN: Bid = {
  companyId: "company-1",
  projectName: "Clean Street School",
  status: "SUBMITTED",
  dueDate: day("2026-09-28"),
  contact: { name: "Turner" },
  lines: [{ id: "c-alt", kind: "ALTERNATE", label: "Alternate 1", amount: "4000.00", unit: null, unitPrice: null, accepted: null }],
  addenda: [{ id: "c-ad", reference: "Addendum 1", issuedOn: day("2026-09-12"), acknowledgedOn: day("2026-09-12"), affectsPricedScope: false, impactNote: null }],
  requirements: [{ id: "c-rq", kind: "INSURANCE_CERTIFICATE", label: "COI at $2M", required: true, satisfiedOn: day("2026-09-13") }],
};

const OTHERS: Bid = {
  companyId: "company-2",
  projectName: "SOMEONE ELSE'S BID",
  status: "INVITED",
  dueDate: null,
  contact: { name: "Not our GC" },
  lines: [],
  addenda: [{ id: "x-ad", reference: "THEIR ADDENDUM", issuedOn: null, acknowledgedOn: null, affectsPricedScope: true, impactNote: null }],
  requirements: [],
};

const BIDS = [HARBOR, CLEAN, OTHERS];

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
  return runTool({ companyId: "company-1", principal: principal as never }, "bid_compliance", { projectName });
}

type Row = {
  project: string;
  gc: string;
  sentence: string;
  wouldMakeTheBidNonResponsive: number;
  outstanding: { what: string; source: string; wouldSinkTheBid: boolean }[];
  repriceWarnings: string[];
  addenda: number;
  addendaNotAcknowledged: number;
};

const rowsOf = (data: unknown) => (data as { rows: Row[] }).rows;
const rowFor = (rows: Row[], project: string) => rows.find((row) => row.project === project)!;

beforeEach(() => {
  bidFindMany.mockClear();
  bidFindFirst.mockClear();
});

describe("bid_compliance", () => {
  it("answers only this company's bids", async () => {
    const rows = rowsOf((await ask()).data);
    expect(rows.map((row) => row.project).sort()).toEqual(["Clean Street School", "Harbor lofts"]);
    expect(rows.map((row) => row.project)).not.toContain("SOMEONE ELSE'S BID");
    expect(bidFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-1" }) }),
    );
  });

  it("never calls a bid compliant, complete or ready — on ANY row", async () => {
    // THE ASSERTION THIS FILE IS FOR, and it is asserted over every sentence
    // in the result rather than over the one row that happens to be clean.
    const rows = rowsOf((await ask()).data);
    for (const row of rows) {
      expect(row.sentence, row.project).not.toMatch(/compliant|responsive bid|ready to (submit|send)|good to go/i);
    }
    const clean = rowFor(rows, "Clean Street School");
    expect(clean.wouldMakeTheBidNonResponsive).toBe(0);
    expect(clean.outstanding).toEqual([]);
    // The strongest sentence available, and it names the document nobody here
    // has read.
    expect(clean.sentence).toMatch(/Nothing outstanding that this app can see/);
    expect(clean.sentence).toMatch(/has not read the ITB itself/);
  });

  it("counts only the blocking items as what would sink the bid", async () => {
    const harbor = rowFor(rowsOf((await ask()).data), "Harbor lofts");
    // One unacknowledged addendum, one blank alternate, one rateless unit
    // price, one sumless allowance, one unobtained bond.
    expect(harbor.wouldMakeTheBidNonResponsive).toBe(5);
    // Six items outstanding: the five above plus the optional DBE forms.
    expect(harbor.outstanding).toHaveLength(6);
    expect(harbor.sentence).toMatch(/^5 things would make this bid non-responsive/);
    expect(harbor.sentence).toMatch(/rejected unread, whatever the price/);
  });

  it("leads with the unacknowledged addendum", async () => {
    const harbor = rowFor(rowsOf((await ask()).data), "Harbor lofts");
    expect(harbor.outstanding[0].what).toMatch(/^Addendum 2 has not been acknowledged/);
    expect(harbor.outstanding[0].what).toMatch(/most common reason a low bid is thrown out/);
    expect(harbor.outstanding[0].wouldSinkTheBid).toBe(true);
    expect(harbor.addenda).toBe(2);
    expect(harbor.addendaNotAcknowledged).toBe(1);
  });

  it("distinguishes what the data derives from what a person has to attest", async () => {
    const harbor = rowFor(rowsOf((await ask()).data), "Harbor lofts");
    const derived = harbor.outstanding.filter((item) => item.source === "DERIVED").map((item) => item.what);
    const recorded = harbor.outstanding.filter((item) => item.source === "RECORDED").map((item) => item.what);
    expect(derived).toHaveLength(4);
    expect(derived.some((what) => /Alternate "Alternate 2" has no price/.test(what))).toBe(true);
    expect(derived.some((what) => /Unit price "Unit Price A" has no rate/.test(what))).toBe(true);
    // The allowance line says WHY a blank one matters: it is inside the base.
    expect(derived.some((what) => /carried INSIDE the base bid/.test(what))).toBe(true);
    expect(recorded).toHaveLength(2);
    expect(recorded.some((what) => /Bid bond, 10% of base bid/.test(what))).toBe(true);
  });

  it("shows an optional requirement without counting it as non-responsiveness", async () => {
    const harbor = rowFor(rowsOf((await ask()).data), "Harbor lofts");
    const dbe = harbor.outstanding.find((item) => item.what.includes("DBE participation forms"))!;
    expect(dbe.wouldSinkTheBid).toBe(false);
    expect(dbe.what).toMatch(/Marked optional on this bid/);
  });

  it("reports a reprice warning apart from the outstanding list", async () => {
    const harbor = rowFor(rowsOf((await ask()).data), "Harbor lofts");
    expect(harbor.repriceWarnings).toEqual([
      "Addendum 2 changed work you had already priced — Soffit detail at the lobby",
    ]);
    // It is a number that may now be wrong, not a missing piece of paperwork,
    // so it is not one of the outstanding items.
    expect(harbor.outstanding.map((item) => item.what)).not.toContain(harbor.repriceWarnings[0]);
  });

  it("carries the counts over every bid it read", async () => {
    const { summary } = await ask();
    expect(summary).toMatchObject({
      bids: 2,
      bidsWithSomethingBlocking: 1,
      blockingItems: 5,
      itemsOutstanding: 6,
      addendaNotAcknowledged: 1,
      repriceWarnings: 1,
    });
  });

  it("says there is no bid form to check rather than answering empty", async () => {
    bidFindMany.mockResolvedValueOnce([]);
    const result = await ask();
    expect(result.unavailable).toMatch(/nothing to check for responsiveness/i);
  });

  it("tells a typo from a bid with nothing outstanding", async () => {
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
