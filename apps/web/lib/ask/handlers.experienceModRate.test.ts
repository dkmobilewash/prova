import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * experience_mod_rate — the rate as RECORDED, never computed.
 *
 * Three things this tool must never do, each a case below:
 *   - answer from another company's rows (the fake HONOURS the where clause,
 *     so a handler that dropped `companyId` would read the other tenant's
 *     rate and this file would see it);
 *   - report next year's rate, typed in early, as this year's;
 *   - produce a figure when nothing is on file.
 */

const TODAY = "2026-09-17";
// Two separately controllable days, because the review finding this file now
// pins is precisely that they can differ: at 17:00 in California on 31
// December the UTC day is already 1 January.
let SERVER_TODAY = TODAY;
let VIEWER_TODAY = TODAY;

type Row = {
  id: string;
  companyId: string;
  effectiveDate: Date;
  rate: { toString(): string; toFixed(places: number): string };
  source: string;
  sourceUrl: string | null;
  note: string | null;
};

/** Stands in for Prisma.Decimal. toFixed pads with string arithmetic rather
 * than Number().toFixed so the fake never introduces the float error it
 * would otherwise be testing around. toString, like the real one, drops
 * trailing zeros -- which is the behaviour that produced "1" for 1.000. */
const decimal = (value: string) => ({
  toString: () => value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""),
  toFixed: (places: number) => {
    const [whole, frac = ""] = value.split(".");
    return `${whole}.${frac.padEnd(places, "0").slice(0, places)}`;
  },
});

let ROWS: Row[] = [];

const findMany = vi.fn(async (args: { where: { companyId?: string } }) => {
  // Honours the where clause: a row matches only if every field named in
  // `where` equals it. An empty or missing `where` would match EVERY row —
  // including the other company's — which is the failure being tested for.
  const where = args?.where ?? {};
  return ROWS.filter((row) =>
    Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value),
  );
});

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    experienceModRate: { findMany },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => SERVER_TODAY }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => VIEWER_TODAY }));

const row = (id: string, companyId: string, effective: string, rate: string, source = "NCCI"): Row => ({
  id,
  companyId,
  effectiveDate: new Date(`${effective}T00:00:00.000Z`),
  rate: decimal(rate),
  source,
  sourceUrl: null,
  note: null,
});

type Shaped = { rate: string; effectiveDate: string; issuedBy: string; note: string | null };
type Data = {
  current: Shaped | null;
  currentIsPastItsPolicyYear: boolean;
  upcoming: Shaped[];
  history: Shaped[];
};

async function ask(companyId = "company-1", principal = { role: "OWNER" as const, jobFunction: null }) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId, principal }, "experience_mod_rate", {});
}

beforeEach(() => {
  findMany.mockClear();
  ROWS = [];
  SERVER_TODAY = TODAY;
  VIEWER_TODAY = TODAY;
});

describe("experience_mod_rate", () => {
  it("answers with the current rate, verbatim, and cites /compliance", async () => {
    ROWS = [row("a", "company-1", "2025-01-01", "0.94"), row("b", "company-1", "2026-01-01", "0.87", "WCIRB")];
    const result = await ask();
    const data = result.data as Data;
    expect(data.current).toEqual({ rate: "0.87", effectiveDate: "2026-01-01", issuedBy: "WCIRB", note: null });
    expect(data.history.map((r) => r.rate)).toEqual(["0.87", "0.94"]);
    expect(result.summary).toEqual({ ratesOnFile: 2, upcomingRates: 0 });
    expect(result.citations).toEqual([{ label: "Compliance", href: "/compliance" }]);
    expect(result.unavailable).toBeUndefined();
  });

  it("reads only the asking company's rates", async () => {
    ROWS = [row("mine", "company-1", "2026-01-01", "0.87"), row("theirs", "company-2", "2026-03-01", "1.40")];
    const data = (await ask()).data as Data;
    expect(data.current?.rate).toBe("0.87");
    expect(data.history).toHaveLength(1);
    expect(findMany.mock.calls[0][0].where).toEqual({ companyId: "company-1" });
  });

  it("does not report a future-dated rate as current", async () => {
    ROWS = [row("now", "company-1", "2026-01-01", "0.87"), row("next", "company-1", "2027-01-01", "0.79")];
    const result = await ask();
    const data = result.data as Data;
    expect(data.current?.rate).toBe("0.87");
    expect(data.upcoming.map((r) => r.rate)).toEqual(["0.79"]);
    expect(result.summary?.upcomingRates).toBe(1);
  });

  it("says nothing has taken effect when every rate is in the future — and names no figure as current", async () => {
    ROWS = [row("next", "company-1", "2027-01-01", "0.79")];
    const result = await ask();
    expect((result.data as Data).current).toBeNull();
    expect(result.unavailable).toMatch(/earliest starts 2027-01-01/);
  });

  it("says it is not recorded, and that the app never computes one, when the history is empty", async () => {
    ROWS = [row("theirs", "company-2", "2026-01-01", "1.40")];
    const result = await ask();
    const data = result.data as Data;
    expect(data.current).toBeNull();
    expect(data.history).toEqual([]);
    expect(result.unavailable).toMatch(/No experience modification rate is recorded/);
    expect(result.unavailable).toMatch(/never computes one/);
  });

  it("flags a newest rate whose policy year has ended", async () => {
    ROWS = [row("old", "company-1", "2025-01-01", "0.94")];
    expect(((await ask()).data as Data).currentIsPastItsPolicyYear).toBe(true);
  });

  it("refuses a member without MANAGE_COMPLIANCE, before reading anything", async () => {
    ROWS = [row("mine", "company-1", "2026-01-01", "0.87")];
    const result = await ask("company-1", { role: "MEMBER", jobFunction: "FIELD" } as never);
    expect(result.data).toBeNull();
    expect(result.unavailable).toBeTruthy();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("review findings on #306, pinned", () => {
  it("decides the current rate on the VIEWER'S day, not UTC's", async () => {
    // 31 December, 17:00 in California: the UTC day has rolled to 1 January.
    // The 2026 policy year is still running on the person's own calendar.
    // On serverToday() this reported next year's 0.79 -- on the evening
    // somebody is most likely to be filling in a prequal for the new year.
    ROWS = [row("now", "company-1", "2026-01-01", "0.87"), row("next", "company-1", "2027-01-01", "0.79")];
    SERVER_TODAY = "2027-01-01";
    VIEWER_TODAY = "2026-12-31";
    const data = (await ask()).data as Data;
    expect(data.current?.rate).toBe("0.87");
    expect(data.upcoming.map((r) => r.rate)).toEqual(["0.79"]);
  });

  it("writes the rate the way an EMR is written, not the way Decimal.toString does", async () => {
    // The column holds three places. Decimal.toString() dropped trailing
    // zeros, so a bureau-issued 1.000 went to the model -- and onto a GC's
    // form -- as "1". Never fewer than two places; three only when real.
    ROWS = [
      row("one", "company-1", "2024-01-01", "1.000"),
      row("tenth", "company-1", "2025-01-01", "0.900"),
      row("three", "company-1", "2026-01-01", "0.875"),
    ];
    const data = (await ask()).data as Data;
    expect(data.history.map((r) => r.rate)).toEqual(["0.875", "0.90", "1.00"]);
  });
});
