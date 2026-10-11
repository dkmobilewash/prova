import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /dashboard for a company with NO jobs, against one WITH jobs.
 *
 * A brand-new account used to open on about ten empty boxes — four tiles
 * reading $0.00 / 0 / 0 / $0.00, two "nothing" field cards, two money cards,
 * "No active jobs" — with "New job" on screen two. Now it leads with the jobs
 * empty state and the checklist, and every other section waits for the first
 * job.
 *
 * The second half pins the home as rebuilt for Concept G (2026-10-10): the
 * greeting, the search box and shortcuts, the three blocks (Needs you today,
 * Money, Crews today), the job cards, and the full jobs list still at the
 * bottom. It replaced "the order it always had" deliberately — the old
 * four-tile row and job-health list are gone, and their figures moved into
 * the blocks and cards, which is what the figures test below holds onto.
 *
 * Rendered from the real page against a fake database and a fixed dashboard
 * payload, so a condition that does not render cannot pass for one that does.
 */

const state = vi.hoisted(() => ({
  jobs: [] as unknown[],
  renewals: [] as unknown[],
  /** findMany results for the home page's own reads, by model. */
  rows: {} as Record<string, unknown[]>,
  /** aggregate()._sum.amount, by model (invoice = billed, payment = collected). */
  sums: {} as Record<string, number>,
  today: {} as Record<string, unknown>,
  /** The getting-started hide cookie's value; "co-1" hides the checklist. */
  cookie: undefined as string | undefined,
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
              if (method === "findMany" && state.rows[model]) return vi.fn(async () => state.rows[model]);
              if (method === "aggregate") return vi.fn(async () => ({ _sum: { amount: state.sums[model] ?? null } }));
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
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "prova_getting_started_hidden" && state.cookie !== undefined ? { name, value: state.cookie } : undefined,
  })),
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
// Pin the reader's calendar so "today" is not the test machine's.
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: vi.fn(async () => "UTC") }));
vi.mock("@/lib/viewer-timezone", () => ({ todayInZone: vi.fn(() => "2026-10-14") }));

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

const JOB_NAME = "Northgate Clinic TI — level 2 drywall";

/** A company in use: numbers chosen to be unmistakable in the markup. */
const BUSY_TODAY = {
  ...EMPTY_TODAY,
  invoicesRaised: 3,
  receivables: [{ outstanding: 18_250 }, { outstanding: 1_750 }],
  overdue: [
    { id: "inv-3", jobId: "job-1", jobName: JOB_NAME, gcName: "Example GC", number: 3, outstanding: 12_000, daysOverdue: 40 },
    { id: "inv-2", jobId: "job-1", jobName: JOB_NAME, gcName: "Example GC", number: 2, outstanding: 6_250, daysOverdue: 12 },
  ],
  overdueTotal: 18_250,
  jobsOverBudget: 1,
  retainageHeld: 7_430,
  gcReliability: [
    {
      contactId: "c-1",
      name: "Example GC",
      reliability: { averageDaysToPay: 41, onTimeRate: 0.5, invoiceCount: 3 },
    },
  ],
  jobHealth: [
    { jobId: "job-1", name: JOB_NAME, gcName: "Example GC", tone: "over", sentence: "Forecast 8% past contract value." },
  ],
};

const JOB = {
  id: "job-1",
  name: JOB_NAME,
  status: "IN_PROGRESS",
  contact: { name: "Example GC" },
  lineItems: [{ quantity: 10, unitPrice: 1000, tradeScope: "METAL_FRAMING_DRYWALL" }],
  signatureRequests: [],
  invoices: [{ amount: 5_700 }],
};

/** The home page's own reads for a busy day. */
const BUSY_ROWS = {
  rfi: [{ id: "rfi-1", number: 12, subject: "Head of wall", dueBy: new Date("2026-10-10T00:00:00Z"), jobId: "job-1", job: { name: JOB_NAME } }],
  timesheetSignoff: [{ id: "so-1", date: new Date("2026-10-13T00:00:00Z"), jobId: "job-1", job: { name: JOB_NAME } }],
  crewScheduleDay: [
    { jobId: "job-1", job: { name: JOB_NAME }, scheduledUser: { name: "Luis Ortega", email: "l@example.com" }, crewMember: null },
    { jobId: "job-1", job: { name: JOB_NAME }, scheduledUser: null, crewMember: { legalFirstName: "Ana", legalMiddleName: null, legalLastName: "Ruiz" } },
  ],
};

/** Every section the page has for a company in use, in page order. */
const POPULATED_ORDER = [
  'data-home="greeting"',
  'data-tour="dashboard-ask"',
  'data-tour="dashboard-new-job"',
  // Concept H: the six area boxes under the greeting.
  'data-home="areas"',
  'data-home="phone-tiles"',
  'data-tour="dashboard-needs-attention"',
  'data-tour="dashboard-money"',
  'data-tour="dashboard-field"',
  // The top bar's Jobs link and the phone's Jobs tab land on #jobs.
  'id="jobs"',
  'data-tour="dashboard-job-health"',
  "Accounts receivable",
  'id="all-jobs"',
  "Browse all jobs",
  'placeholder="Search job or client"',
  'data-tour="dashboard-job-filters"',
  'data-tour="dashboard-job-list"',
];

/** One block's markup, by its tour anchor. */
function block(html: string, anchor: string): string {
  const match = html.match(new RegExp(`data-tour="${anchor}"[\\s\\S]*?</section>`));
  return match ? match[0] : "";
}

beforeEach(() => {
  state.jobs = [];
  state.renewals = [];
  state.rows = {};
  state.sums = {};
  state.today = EMPTY_TODAY;
  state.cookie = undefined;
  state.context.role = "OWNER";
  state.context.jobFunction = null;
});

describe("/dashboard on a company with no jobs", () => {
  it("shows the getting-started checklist as the ONE start — no empty state, no search box", async () => {
    const html = await render();
    expect(html, "the real page rendered").toContain('data-home="greeting"');
    expect(html).toContain("getting-started-heading");
    for (const competing of [
      'data-tour="dashboard-jobs-empty"',
      'data-tour="dashboard-ask"',
      'data-tour="dashboard-new-job"',
      'data-tour="dashboard-needs-attention"',
      "$0.00",
    ]) {
      expect(html, `a new account should not also see ${competing}`).not.toContain(competing);
    }
  });

  it("once the checklist is hidden, leads with the jobs empty state and nothing with nothing to say", async () => {
    state.cookie = "co-1";
    const html = await render();
    expect(html, "the real page rendered").toContain('data-home="greeting"');

    expect(html).toContain('data-tour="dashboard-jobs-empty"');
    expect(html).not.toContain("getting-started-heading");

    for (const gone of [
      'data-tour="dashboard-needs-attention"',
      'data-tour="dashboard-field"',
      'data-tour="dashboard-money"',
      'data-tour="dashboard-job-health"',
      'data-home="phone-tiles"',
      'data-home="areas"',
      "Browse all jobs",
      "$0.00",
      "Nobody is on the schedule",
      "in progress",
    ]) {
      expect(html, `a new account should not see ${gone}`).not.toContain(gone);
    }
  });

  it("offers the first job as the primary action, with an example that says it is one", async () => {
    state.cookie = "co-1";
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
    // ...and still none of the zero blocks around it.
    expect(html).not.toContain('data-tour="dashboard-needs-attention"');
    expect(html).not.toContain("$0.00");
  });

  it("leaves money out of the example for a viewer who cannot see job money", async () => {
    state.context.role = "MEMBER";
    state.context.jobFunction = "FIELD";
    state.cookie = "co-1";
    const html = await render();
    expect(html).toContain("Oak Ave Medical");
    expect(html).not.toContain("$412,000");
  });
});

describe("/dashboard on a company with jobs", () => {
  beforeEach(() => {
    state.jobs = [JOB];
    state.today = BUSY_TODAY;
    state.rows = BUSY_ROWS;
    state.sums = { invoice: 41_000, payment: 9_500 };
    state.renewals = [{ kind: "license", id: "l-1", title: "Contractor licence", detail: "C-9", urgency: "EXPIRED" }];
  });

  it("renders every block, in page order", async () => {
    const html = await render();
    const positions = POPULATED_ORDER.map((needle) => html.indexOf(needle));
    positions.forEach((at, i) => expect(at, `${POPULATED_ORDER[i]} is missing`).toBeGreaterThan(-1));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).not.toContain('data-tour="dashboard-jobs-empty"');
  });

  it("greets the reader by first name, with the day's real counts", async () => {
    const html = await render();
    expect(html).toMatch(/Good (morning|afternoon|evening), Dana</);
    expect(html).toContain("Wednesday, October 14 · 1 crew out · 1 job in progress");
  });

  it("shows every figure it was handed", async () => {
    const html = await render();
    for (const figure of [
      "$41,000<", // billed this month
      "$9,500<", // collected this month
      "$7,430<", // retainage held
      "$18,250<", // overdue
      "Overdue · 2 invoices",
      "Luis Ortega, Ana Ruiz", // crews today, from the schedule
      "2 scheduled",
      "Pays in 41 days on average",
      "Forecast 8% past contract value.",
      "Example GC · Metal framing / drywall · 57% billed",
      "$10,000.00", // the job's value in the full list
    ]) {
      expect(html, `lost ${figure}`).toContain(figure);
    }
  });

  it("gives every Needs-you row one action, to the page that settles it, red first", async () => {
    const needs = block(await render(), "dashboard-needs-attention");
    expect(needs).toContain("6 items");
    const order = ["Invoice #3", "Invoice #2", "Contractor licence", "RFI 12", "Approve hours for Tue, Oct 13", "forecast over budget"];
    const at = order.map((needle) => needs.indexOf(needle));
    at.forEach((i, n) => expect(i, `${order[n]} missing`).toBeGreaterThan(-1));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const href of ["/jobs/job-1/billing", "/compliance", "/rfis?job=job-1", "/jobs/job-1/crew", "/wip"]) {
      expect(needs, `no action links to ${href}`).toContain(`href="${href}"`);
    }
  });

  it("puts the job in its stage with ONE next action from real state", async () => {
    const html = await render();
    expect(html).toContain('data-stage="Billing"');
    expect(html).toContain("Chase invoice #3</span>");
    expect(html).toContain("Invoice late");
  });

  it("links shortcuts straight to the one job that fits", async () => {
    const html = await render();
    expect(html).toMatch(/href="\/jobs\/job-1\/crew"[^>]*><span[^>]*>◷<\/span>Log hours/);
    expect(html).toMatch(/href="\/jobs\/job-1\/billing"[^>]*><span[^>]*>↗<\/span>Send pay app/);
    expect(html).toContain('href="/rfis"');
  });

  it("shows a field role the work and none of the money", async () => {
    state.context.role = "MEMBER";
    state.context.jobFunction = "FIELD";
    const html = await render();
    expect(html).not.toContain('data-tour="dashboard-money"');
    expect(html).not.toContain("Accounts receivable");
    expect(html).not.toContain("/cash-flow");
    expect(html).not.toContain('href="/wip"');
    expect(html).not.toContain("Send pay app");
    expect(html).not.toContain("$18,250");
    expect(html).not.toContain("% billed");
    const needs = block(html, "dashboard-needs-attention");
    expect(needs).not.toContain("Invoice #");
    // The licence is still news to them, but /compliance is not theirs to open.
    expect(needs).toContain("Contractor licence");
    expect(needs).not.toContain('href="/compliance"');
    expect(html).toContain("Luis Ortega");
  });

  it("says so, with a way to the schedule, when nobody is scheduled today", async () => {
    state.rows = {};
    const crews = block(await render(), "dashboard-field");
    expect(crews).toContain("Nobody is on the schedule for today.");
    expect(crews).toContain('href="/schedule"');
  });

  it("never sends anyone to /jobs, which only redirects back here", async () => {
    state.today = { ...BUSY_TODAY, gcReliability: [] };
    const html = await render();
    expect(html).toContain("Open a job below");
    expect(html).not.toContain('href="/jobs"');
  });

  it("gives each area box one line from real rows, or its plain description", async () => {
    const html = await render();
    const boxes = html.match(/data-home="areas"[\s\S]*?data-home="area-tiles"/)?.[0] ?? "";
    for (const line of [
      "1 in progress", // Jobs & bids: a count of jobs...
      "No bids due", // ...and no invitations
      "$18,250 overdue", // Money: the dashboard's own overdue total
      "1 crew out today", // Crew & field: today's schedule
      "No RFIs waiting", // Paperwork: no SENT RFIs in this fake database
      "1 expired", // Compliance: the expired licence
      "0 orders open", // Materials: a real zero, said as one
    ]) {
      expect(boxes, `lost ${line}`).toContain(line);
    }
    // Every box is a button that says whether its dropdown is open.
    expect(boxes.match(/aria-expanded="false"/g)).toHaveLength(6);
    // Phone tiles go straight to each area page.
    for (const slug of ["jobs-bids", "money", "crew-field", "paperwork", "compliance-safety", "materials-equipment"]) {
      expect(html).toContain(`href="/areas/${slug}"`);
    }
  });

  it("drops the Money box for a role that can open no money page", async () => {
    state.context.role = "MEMBER";
    state.context.jobFunction = "FIELD";
    const html = await render();
    expect(html).toContain('data-home="areas"');
    expect(html).not.toContain('href="/areas/money"');
    expect(html).not.toContain("overdue<");
  });

  it("is a working-width page", async () => {
    const html = await render();
    expect(html).toContain("max-w-7xl");
    expect(html).not.toContain("max-w-5xl");
  });
});
