import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lien deadlines reach the alert list — the bell, /alerts, and the digest
 * that reads the same un-silenced set.
 *
 * Review found the feature said it reminded ("Nothing will remind anyone
 * about it again" on the Remove confirm; "tracks, sorts and reminds" in the
 * schema and changelog) while no alert, tile or digest read `LienDeadline`
 * at all. A deadline typed in and then not looked at was exactly as lost as
 * one never typed in.
 *
 * Driven through `loadAlerts` rather than the pure function alone, because
 * the two halves of the claim live in different places: the company scope
 * and the unserved filter are in the QUERY, the capability gate in
 * `visibleToPrincipal`. The fake honours `companyId` and `servedOn: null`,
 * so a query that forgot either would put the wrong row in the answer.
 */

const TODAY = "2026-09-18";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type LienRow = {
  id: string;
  companyId: string;
  jobId: string;
  kind: string;
  otherLabel: string | null;
  dueOn: Date;
  servedOn: Date | null;
  recipient: string | null;
  job: { name: string };
};

let liens: LienRow[] = [];
const lienWheres: Record<string, unknown>[] = [];

function lienMatches(row: LienRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "companyId") return row.companyId === value;
    if (key === "servedOn" && value === null) return row.servedOn === null;
    throw new Error(`fake: unsupported lienDeadline where ${key}: ${JSON.stringify(value)}`);
  });
}

const empty = async () => [];

vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: {
    backcharge: { findMany: empty },
    job: { findMany: empty },
    alertAcknowledgement: { findMany: empty },
    contactInteraction: { findMany: empty },
    documentIntake: { findMany: empty },
    rfi: { findMany: empty },
    submittal: { findMany: empty },
    drawingSet: { findMany: empty },
    lienDeadline: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        lienWheres.push(where);
        return liens.filter((row) => lienMatches(row, where));
      },
    },
  },
}));
vi.mock("@/lib/renewals", () => ({ renewalSourcesForCompany: empty }));
vi.mock("@/lib/union-compliance-query", () => ({ loadRatioReviews: empty }));
vi.mock("@/lib/fringe-schedules-query", () => ({
  loadFringeSchedulesByCraft: async () => new Map(),
  TIME_ENTRY_COST_SELECT: {},
}));

const { loadAlerts } = await import("./alerts-query");

type Who = { role: string; jobFunction: string | null };
const OWNER: Who = { role: "OWNER", jobFunction: null };

async function lienAlerts(principal: Who = OWNER, companyId = "co_1") {
  const { visible } = await loadAlerts(companyId, "user_1", TODAY, principal);
  return visible.filter((alert) => alert.href === "/lien-deadlines");
}

function row(overrides: Partial<LienRow> & { id: string }): LienRow {
  return {
    companyId: "co_1",
    jobId: "job_1",
    kind: "PRELIMINARY_NOTICE",
    otherLabel: null,
    dueOn: d("2026-09-15"),
    servedOn: null,
    recipient: "Owner",
    job: { name: "Riverside" },
    ...overrides,
  };
}

beforeEach(() => {
  liens = [];
  lienWheres.length = 0;
});

describe("lien deadlines in the alert engine", () => {
  it("raises an OVERDUE alert for an unserved deadline that has passed", async () => {
    liens = [row({ id: "overdue" })];
    const alerts = await lienAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("OVERDUE");
    expect(alerts[0].dueOn).toBe("2026-09-15");
    expect(alerts[0].daysUntil).toBe(-3);
    expect(alerts[0].title).toContain("Preliminary notice");
    expect(alerts[0].title).toContain("Riverside");
  });

  it("raises DUE_SOON within 14 days, and nothing further out", async () => {
    liens = [row({ id: "soon", dueOn: d("2026-10-02") }), row({ id: "far", dueOn: d("2026-10-03") })];
    const alerts = await lienAlerts();
    expect(alerts.map((a) => a.severity)).toEqual(["DUE_SOON"]);
    expect(alerts[0].daysUntil).toBe(14);
  });

  it("raises nothing for a SERVED deadline, even one served late", async () => {
    liens = [row({ id: "served-late", servedOn: d("2026-09-17") })];
    expect(await lienAlerts()).toEqual([]);
  });

  it("never raises another company's deadline", async () => {
    liens = [row({ id: "theirs", companyId: "co_2", job: { name: "Theirs" } })];
    expect(await lienAlerts()).toEqual([]);
    // And the scope is in the query, not an accident of the fixture.
    expect(lienWheres.length).toBeGreaterThan(0);
    expect(lienWheres.every((where) => where.companyId === "co_1")).toBe(true);
  });

  it("reaches only someone who holds MANAGE_BILLING", async () => {
    liens = [row({ id: "overdue" })];
    expect(await lienAlerts({ role: "MEMBER", jobFunction: "ACCOUNTING" })).toHaveLength(1);
    expect(await lienAlerts({ role: "MEMBER", jobFunction: "PROJECT_MANAGER" })).toHaveLength(1);
    // A foreman and an estimator hold no billing, and are not told.
    expect(await lienAlerts({ role: "MEMBER", jobFunction: "FIELD" })).toEqual([]);
    expect(await lienAlerts({ role: "MEMBER", jobFunction: "ESTIMATOR" })).toEqual([]);
  });

  it("keys on the entered due date, so a corrected date is a new alert", async () => {
    liens = [row({ id: "overdue" })];
    const [before] = await lienAlerts();
    liens = [row({ id: "overdue", dueOn: d("2026-09-16") })];
    const [after] = await lienAlerts();
    expect(before.key).not.toBe(after.key);
  });
});
