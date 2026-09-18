import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * bid_pursuits — the company's OWN pre-bid pipeline.
 *
 * Three things this file exists to hold still:
 *
 *  1. The fake HONOURS the where clause (company and stage), so a handler
 *     that forgot to scope by company, or ignored the stage filter, returns
 *     the other company's row or the wrong stage and goes red. A fake that
 *     returned its fixture regardless would pass either mistake.
 *  2. The handler NEVER touches a sales model. SalesLead / SalesOpportunity /
 *     SalesActivity are Prova's own CRM for selling this product, and a tool
 *     that read them would hand every tenant the vendor's sales pipeline.
 *     The client below is a Proxy that records every model name asked for.
 *  3. The "we don't model a pre-bid pipeline" line is GONE from KNOWN_GAPS.
 *     That list is injected into the system prompt; left in, it would tell
 *     the model to refuse the question this tool now answers.
 */

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-18" }));

type Row = {
  id: string;
  companyId: string;
  projectName: string;
  owner: string | null;
  architect: string | null;
  expectedGcs: string | null;
  expectedBidDate: Date | null;
  estimatedValue: string | null;
  stage: string;
  note: string | null;
  updatedAt: Date;
  bidInvitation: null | {
    id: string;
    projectName: string;
    status: string;
    contactId: string;
    contact: { name: string };
  };
};

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const ROWS: Row[] = [
  {
    id: "p1",
    companyId: "company-1",
    projectName: "St. Mary's east wing",
    owner: "St. Mary's Health",
    architect: "HKS",
    expectedGcs: "Turner, McCarthy",
    expectedBidDate: day("2026-10-01"),
    estimatedValue: "400000.00",
    stage: "EXPECTING_INVITE",
    note: null,
    updatedAt: day("2026-09-10"),
    bidInvitation: null,
  },
  {
    id: "p2",
    companyId: "company-1",
    projectName: "Riverside library",
    owner: null,
    architect: null,
    expectedGcs: null,
    expectedBidDate: day("2026-09-01"),
    estimatedValue: null,
    stage: "WATCHING",
    note: "Heard about it at the AGC dinner",
    updatedAt: day("2026-07-01"),
    bidInvitation: null,
  },
  {
    id: "p3",
    companyId: "company-1",
    projectName: "Harbor lofts",
    owner: null,
    architect: null,
    expectedGcs: "Beacon GC",
    expectedBidDate: null,
    estimatedValue: "90000.00",
    stage: "INVITED",
    note: null,
    updatedAt: day("2026-09-15"),
    bidInvitation: {
      id: "inv-1",
      projectName: "Harbor Lofts",
      status: "SUBMITTED",
      contactId: "c-1",
      contact: { name: "Beacon GC" },
    },
  },
  // ANOTHER COMPANY'S pursuit. Must never appear in company-1's answer.
  {
    id: "other",
    companyId: "company-2",
    projectName: "SOMEONE ELSE'S CHASE",
    owner: null,
    architect: null,
    expectedGcs: null,
    expectedBidDate: day("2026-09-20"),
    estimatedValue: "5000000.00",
    stage: "WATCHING",
    note: null,
    updatedAt: day("2026-09-17"),
    bidInvitation: null,
  },
];

const touched = new Set<string>();

const findMany = vi.fn(async ({ where }: { where: { companyId: string; stage?: { in: string[] } } }) =>
  ROWS.filter((row) => row.companyId === where.companyId && (!where.stage || where.stage.in.includes(row.stage))),
);

vi.mock("@prova/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/db")>();
  const models: Record<string, unknown> = { bidPursuit: { findMany } };
  return {
    Prisma: real.Prisma,
    // Records every model name asked for, so a handler reaching for
    // salesLead is caught even if it would have got an empty array back.
    prisma: new Proxy(models, {
      get(target, key: string) {
        touched.add(key);
        return target[key] ?? { findMany: async () => [], findFirst: async () => null, count: async () => 0 };
      },
    }),
  };
});

async function ask(stage?: string, principal = { role: "OWNER" as const, jobFunction: null }) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal }, "bid_pursuits", { stage });
}

type Out = {
  project: string;
  stage: string;
  bidDateComingUp: boolean;
  bidDatePassedWithNoInvite: boolean;
  goneQuiet: boolean;
  estimatedValue: number | null;
  becameInvitation: { project: string; gc: string; status: string } | null;
};

beforeEach(() => {
  touched.clear();
  findMany.mockClear();
});

describe("bid_pursuits", () => {
  it("answers only this company's pursuits", async () => {
    const result = await ask();
    const projects = (result.data as Out[]).map((row) => row.project);
    expect(projects).toHaveLength(3);
    expect(projects).not.toContain("SOMEONE ELSE'S CHASE");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: "company-1" }) }));
  });

  it("OPEN means the three pre-invite stages and nothing else", async () => {
    const result = await ask("OPEN");
    const rows = result.data as Out[];
    expect(rows.map((r) => r.project).sort()).toEqual(["Riverside library", "St. Mary's east wing"]);
    expect(result.summary?.totalPursuits).toBe(2);
  });

  it("flags a passed bid date, a coming-up one and a quiet chase on the ROW", async () => {
    const rows = (await ask()).data as Out[];
    const stMarys = rows.find((r) => r.project === "St. Mary's east wing")!;
    const riverside = rows.find((r) => r.project === "Riverside library")!;
    expect(stMarys.bidDateComingUp).toBe(true);
    expect(stMarys.bidDatePassedWithNoInvite).toBe(false);
    expect(riverside.bidDatePassedWithNoInvite).toBe(true);
    expect(riverside.goneQuiet).toBe(true);
    expect(stMarys.goneQuiet).toBe(false);
  });

  it("puts the pursuit whose bid date already passed first — it is the call to make today", async () => {
    const rows = (await ask()).data as Out[];
    expect(rows[0].project).toBe("Riverside library");
    // Invited sorts after every open pursuit.
    expect(rows[rows.length - 1].project).toBe("Harbor lofts");
  });

  it("carries the summary counts, with the open value a floor when a row has none", async () => {
    const { summary } = await ask();
    expect(summary).toMatchObject({
      totalPursuits: 3,
      openPursuits: 2,
      watching: 1,
      expectingInvite: 1,
      invited: 1,
      bidDatesInNext30Days: 1,
      bidDatesPassedWithNoInvite: 1,
      goneQuiet30Days: 1,
      openEstimatedValue: 400_000,
      openPursuitsWithNoValue: 1,
    });
  });

  it("names the invitation a pursuit became", async () => {
    const rows = (await ask()).data as Out[];
    expect(rows.find((r) => r.project === "Harbor lofts")?.becameInvitation).toEqual({
      project: "Harbor Lofts",
      gc: "Beacon GC",
      status: "SUBMITTED",
    });
  });

  it("says an empty list means nobody has entered anything — not that nothing is out there", async () => {
    findMany.mockResolvedValueOnce([]);
    const result = await ask();
    expect(result.unavailable).toMatch(/only knows about work somebody here has typed in/);
  });

  it("NEVER touches a sales model — those are Prova's own CRM, not the tenant's", async () => {
    await ask();
    await ask("OPEN");
    // Anti-vacuity: the proxy did see the handler's reads.
    expect(touched.has("bidPursuit")).toBe(true);
    expect([...touched].filter((key) => /^sales/i.test(key))).toEqual([]);
  });

  it("is refused to somebody without estimating access, before any read", async () => {
    const result = await ask(undefined, { role: "MEMBER", jobFunction: "FIELD" } as never);
    expect(result.data).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("the system prompt no longer refuses this question", () => {
  it("has no KNOWN_GAPS entry claiming the pre-bid pipeline is not modelled", async () => {
    const { KNOWN_GAPS } = await import("./tools");
    const stale = KNOWN_GAPS.filter((gap) => /pipeline|being chased|pre-bid/i.test(`${gap.topic} ${gap.why}`));
    expect(stale).toEqual([]);
    // Anti-vacuity: the list is still there to be searched.
    expect(KNOWN_GAPS.length).toBeGreaterThan(3);
  });
});

describe("the write side and the shared query do not name a sales model either", () => {
  it("has no prisma.sales* call in the actions, the query module or the component", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const files = ["../actions/bidPursuits.ts", "../bid-pursuits-query.ts", "../../components/BidPursuitList.tsx"];
    for (const file of files) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      // Code only: the comments in these files NAME SalesLead on purpose,
      // to say why it is not used.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      // Anti-vacuity: each file really does read or write BidPursuit.
      expect(code, file).toMatch(/[Bb]idPursuit/);
      expect(code.match(/\bsales(Lead|Opportunit|Activit|StageChange)\w*/gi) ?? [], file).toEqual([]);
    }
  });
});
