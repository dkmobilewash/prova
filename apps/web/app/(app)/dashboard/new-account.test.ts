import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /dashboard for a company with NO jobs, against one WITH jobs.
 *
 * A brand-new account used to open on about ten empty boxes — four tiles
 * reading $0.00 / 0 / 0 / $0.00, two "nothing" field cards, two money cards,
 * "No active jobs" — with "New job" on screen two. Now it leads with the jobs
 * empty state and the checklist, and every other section waits for the first
 * job. That gate is presentation only, so the half of this file that matters
 * as much as the first is the second: a company with jobs must get every
 * section, every figure and the same order it always had.
 *
 * Rendered from the real page against a fake database and a fixed dashboard
 * payload, so a condition that does not render cannot pass for one that does.
 */

const state = vi.hoisted(() => ({
  jobs: [] as unknown[],
  renewals: [] as unknown[],
  today: {} as Record<string, unknown>,
  context: {
    company: { id: "co-1", name: "Ithy Drywall & Acoustics", businessScopeAskedAt: new Date("2026-09-01") },
    id: "user-1",
    name: "Dana Smith",
    email: null,
    role: "OWNER",
    jobFunction: null as string | null,
  },
}));

vi.mock("@prova/db", () => {
  const prisma = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_t, method: string) => {
              if (model === "job" && method === "findMany") return vi.fn(async () => state.jobs);
              if (method === "count") return vi.fn(async () => 0);
              if (method === "findUnique" || method === "findFirst") return vi.fn(async () => null);
              return vi.fn(async () => []);
            },
          },
        ),
    },
  );
  return {
    prisma,
    Prisma: {},
    JobStatus: { ESTIMATE: "ESTIMATE", CONTRACTED: "CONTRACTED", IN_PROGRESS: "IN_PROGRESS", COMPLETE: "COMPLETE" },
  };
});

vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => state.context) }));
vi.mock("@/lib/today-dashboard", () => ({ loadTodayDashboard: vi.fn(async () => state.today) }));
vi.mock("@/lib/renewals", () => ({ renewalSourcesForCompany: vi.fn(async () => []) }));
vi.mock("@/lib/compliance-expiry", () => ({
  renewalAlerts: vi.fn(() => state.renewals),
  renewalTiming: vi.fn(() => "Expires in 9 days"),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
vi.mock("@/components/AskPanel", () => ({ AskPanel: () => null }));
vi.mock("@/lib/actions", () => ({ hideGettingStarted: vi.fn() }));

const { default: TodayPage } = await import("@/app/(app)/dashboard/page");

async function render() {
  return renderToStaticMarkup(await TodayPage({ searchParams: Promise.resolve({}) }));
}

const EMPTY_TODAY = {
  receivables: [],
  invoicesRaised: 0,
  overdue: [],
  overdueTotal: 0,
  jobHealth: [],
  jobsOverBudget: 0,
  retainageHeld: 0,
  crews: [],
  gcReliability: [],
};

/** A company in use: numbers chosen to be unmistakable in the markup. */
const BUSY_TODAY = {
  ...EMPTY_TODAY,
  invoicesRaised: 3,
  overdue: [{}, {}],
  overdueTotal: 18_250,
  jobsOverBudget: 1,
  retainageHeld: 7_430,
  crews: [{ jobId: "job-1", name: "Northgate Clinic TI — level 2 drywall", gcName: "Example GC", crew: ["Luis Ortega"] }],
  gcReliability: [
    {
      contactId: "c-1",
      name: "Example GC",
      reliability: { averageDaysToPay: 41, onTimeRate: 0.5, invoiceCount: 3 },
    },
  ],
  jobHealth: [
    { jobId: "job-1", name: "Northgate Clinic TI — level 2 drywall", gcName: "Example GC", tone: "over", sentence: "Forecast 8% past contract value." },
  ],
};

const JOB = {
  id: "job-1",
  name: "Northgate Clinic TI — level 2 drywall",
  status: "IN_PROGRESS",
  contact: { name: "Example GC" },
  lineItems: [{ quantity: 10, unitPrice: 1000 }],
  signatureRequests: [],
};

/** Every section the page has for a company in use, in page order. */
const POPULATED_ORDER = [
  'data-tour="dashboard-ask"',
  'data-tour="dashboard-needs-attention"',
  'data-tour="dashboard-field"',
  'data-tour="dashboard-money"',
  'data-tour="dashboard-job-health"',
  "Browse all jobs",
  'data-tour="dashboard-job-list"',
];

/** The four Needs-attention tiles' grid, for counting what renders in it. */
function needsAttention(html: string): string {
  const match = html.match(/data-tour="dashboard-needs-attention"[\s\S]*?<\/section>/);
  return match ? match[0] : "";
}

beforeEach(() => {
  state.jobs = [];
  state.renewals = [];
  state.today = EMPTY_TODAY;
  state.context.role = "OWNER";
  state.context.jobFunction = null;
});

describe("/dashboard on a company with no jobs", () => {
  it("leads with the jobs empty state, then the checklist, and nothing with nothing to say", async () => {
    const html = await render();
    expect(html, "the real page rendered").toContain("What needs a decision");

    const emptyAt = html.indexOf('data-tour="dashboard-jobs-empty"');
    expect(emptyAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeLessThan(html.indexOf("getting-started-heading"));

    for (const gone of [
      'data-tour="dashboard-needs-attention"',
      'data-tour="dashboard-field"',
      'data-tour="dashboard-money"',
      'data-tour="dashboard-job-health"',
      "Browse all jobs",
      "$0.00",
      "No active jobs",
      "No jobs are in progress right now",
    ]) {
      expect(html, `a new account should not see ${gone}`).not.toContain(gone);
    }
  });

  it("offers the first job as the primary action, with an example that says it is one", async () => {
    const html = await render();
    const empty = html.match(/data-tour="dashboard-jobs-empty"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(empty).toContain("No jobs yet");
    expect(empty).toMatch(/href="\/jobs\/new"[^>]*>Start your first job</);
    // The example is labelled and inert — EmptyState's contract.
    expect(empty).toContain("data-empty-example");
    expect(empty).toContain(">Example<");
    expect(empty).toContain("Not your data");
    expect(empty).toContain("Oak Ave Medical");
  });

  it("keeps a document that is running out, the one thing that can exist before a job", async () => {
    state.renewals = [
      { kind: "license", id: "l-1", title: "Contractor licence", detail: "C-9", urgency: "DUE_SOON" },
    ];
    const html = await render();
    expect(html).toContain("Contractor licence");
    expect(html).toContain("Expires in 9 days");
    // ...and still none of the zero tiles around it.
    expect(html).not.toContain('data-tour="dashboard-needs-attention"');
    expect(html).not.toContain("$0.00");
  });

  it("leaves money out of the example for a viewer who cannot see job money", async () => {
    state.context.role = "MEMBER";
    state.context.jobFunction = "FIELD";
    const html = await render();
    expect(html).toContain("Oak Ave Medical");
    expect(html).not.toContain("$412,000");
  });
});

describe("/dashboard on a company with jobs — unchanged", () => {
  beforeEach(() => {
    state.jobs = [JOB];
    state.today = BUSY_TODAY;
  });

  it("renders every section, in the order it always had", async () => {
    const html = await render();
    const positions = POPULATED_ORDER.map((needle) => html.indexOf(needle));
    positions.forEach((at, i) => expect(at, `${POPULATED_ORDER[i]} is missing`).toBeGreaterThan(-1));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).not.toContain('data-tour="dashboard-jobs-empty"');
  });

  it("shows every figure it was handed", async () => {
    const html = await render();
    for (const figure of [
      "$18,250.00", // overdue
      "2 invoices past due",
      "$7,430.00", // retainage held
      "Luis Ortega", // crews today
      "Pays in 41 days on average", // GC reliability
      "Forecast 8% past contract value.", // job health
      "Northgate Clinic TI — level 2 drywall", // the job list
      "$10,000.00", // its value
    ]) {
      expect(html, `lost ${figure}`).toContain(figure);
    }
  });

  it("keeps the owner's four tiles in their four-wide row", async () => {
    const section = needsAttention(await render());
    expect(section).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4");
    expect(section.match(/text-\[10px\]/g)?.length).toBe(4);
  });

  it("gives a field role one row sized to its one tile, not a lone tile in a four-wide row", async () => {
    state.context.role = "MEMBER";
    state.context.jobFunction = "FIELD";
    const section = needsAttention(await render());
    expect(section.match(/text-\[10px\]/g)?.length, "exactly one tile for this viewer").toBe(1);
    expect(section).toContain('class="grid grid-cols-1 gap-3"');
    expect(section).not.toContain("grid-cols-4");
  });

  it("is a working-width page", async () => {
    const html = await render();
    expect(html).toContain("max-w-7xl");
    expect(html).not.toContain("max-w-5xl");
  });
});
