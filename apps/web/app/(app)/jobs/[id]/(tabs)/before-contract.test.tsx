import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Crew & time and Compliance on a job still at ESTIMATE (density audit #39):
 * one line, the way Billing already does it, instead of the whole tab with
 * its open forms. Only while the tab is EMPTY — nothing already recorded is
 * ever hidden — and `?open=1` opens the full tab for any job.
 *
 * Past the gate each page goes on to load far more than is mocked here, so
 * a sentinel thrown at the first call after the gate is how "the full tab
 * rendered" is told apart from "the short state rendered".
 */

const PAST_GATE = "PAST_GATE";
const state = {
  status: "ESTIMATE",
  publicWorks: false as boolean,
  timeEntries: [] as unknown[],
  determinations: [] as unknown[],
};

vi.mock("@/lib/jobs/job-access", () => ({
  requireJob: vi.fn(async () => ({
    job: { id: "job-1", companyId: "co-1", status: state.status },
    company: { id: "co-1" },
    currentUser: { id: "u-1", role: "OWNER", jobFunction: null },
    principal: { role: "OWNER", jobFunction: null },
  })),
  jobCapabilities: () => ({ showsField: true }),
}));
vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findUnique: vi.fn(async () => ({ id: "job-1", lineItems: [], timeEntries: state.timeEntries, timesheetSignoffs: [], dispatchSlips: [] })),
      findUniqueOrThrow: vi.fn(async () => ({ status: state.status, publicWorks: state.publicWorks })),
    },
    user: { findMany: vi.fn(async () => []) },
    crewMember: { findMany: vi.fn(async () => []) },
    craftClassification: { findMany: vi.fn(async () => []) },
    tmTicket: { findMany: vi.fn(async () => []) },
    prevailingWageDetermination: { findMany: vi.fn(async () => state.determinations) },
  },
}));
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: vi.fn(async () => "2026-10-14"),
  viewerTimeZone: vi.fn(async () => {
    throw new Error(PAST_GATE);
  }),
}));
vi.mock("@/lib/das-query", () => ({
  loadApprenticeshipCommittees: vi.fn(async () => []),
  loadDas140Notices: vi.fn(async () => []),
  loadDas142Requests: vi.fn(async () => []),
  loadFirstWorkerDay: vi.fn(async () => null),
  loadJobCraftHours: vi.fn(async () => []),
}));
vi.mock("@/lib/das-forms", () => ({
  das140Standing: vi.fn(),
  das142Standing: vi.fn(),
  dasProposals: vi.fn(() => {
    throw new Error(PAST_GATE);
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/jobs/job-1/crew", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : vi.fn()) }));

const { default: CrewPage } = await import("@/app/(app)/jobs/[id]/(tabs)/crew/page");
const { default: CompliancePage } = await import("@/app/(app)/jobs/[id]/(tabs)/compliance/page");

const params = Promise.resolve({ id: "job-1" });
const crew = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await CrewPage({ params, searchParams: Promise.resolve(sp) }));
const compliance = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await CompliancePage({ params, searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  Object.assign(state, { status: "ESTIMATE", publicWorks: false, timeEntries: [], determinations: [] });
});

describe("Crew & time before contract", () => {
  it("is one line with a way in, on an empty estimate", async () => {
    const html = await crew();
    expect(html).toContain("still an estimate");
    expect(html).toContain('href="/jobs/job-1/crew?open=1#log-time"');
    expect(html).not.toContain("<form");
  });

  it("is the full tab on ?open=1, on a contracted job, and once anything is logged", async () => {
    await expect(crew({ open: "1" })).rejects.toThrow(PAST_GATE);
    state.status = "CONTRACTED";
    await expect(crew()).rejects.toThrow(PAST_GATE);
    state.status = "ESTIMATE";
    state.timeEntries = [{ id: "t-1" }];
    await expect(crew()).rejects.toThrow(PAST_GATE);
  });
});

describe("Compliance before contract", () => {
  it("is one line with a way in, on an empty estimate that is not public works", async () => {
    const html = await compliance();
    expect(html).toContain("still an estimate");
    expect(html).toContain('href="/jobs/job-1/compliance?open=1"');
  });

  it("is the full tab on ?open=1, for a public-works bid, once a determination exists, and once contracted", async () => {
    await expect(compliance({ open: "1" })).rejects.toThrow(PAST_GATE);
    state.publicWorks = true;
    await expect(compliance()).rejects.toThrow(PAST_GATE);
    state.publicWorks = false;
    state.determinations = [{ id: "d-1", wageRates: [] }];
    await expect(compliance()).rejects.toThrow(PAST_GATE);
    state.determinations = [];
    state.status = "IN_PROGRESS";
    await expect(compliance()).rejects.toThrow(PAST_GATE);
  });
});
