import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Six screens read at 17:01 in Los Angeles, on a day that decides money.
 *
 * Sibling of correspondence-dates.test.ts, which did this for /rfis,
 * /submittals and /drawings. These are the screens that fix did not reach,
 * and the two at the top are the ones an owner opens to decide who to
 * chase.
 *
 * WHAT WAS WRONG, all of it the same mistake wearing different clothes —
 * a calendar day worked out from the SERVER's UTC clock and then compared
 * against dates that are plain calendar days:
 *
 *   - /cash-flow and /dashboard handed a raw `new Date()` to
 *     `daysPastDueFor`, which floors the gap against a UTC-midnight due
 *     date. An $85,000 invoice due today read "Current" at 16:59 PDT and
 *     "1d overdue" at 17:01 — it moved into the 1-30 aging bucket, the
 *     forecast row flipped from "Sep 2026" to "Overdue", and the
 *     dashboard's Overdue invoices tile went from $0.00 to $85,000.00;
 *   - /certifications called a card that expires today EXPIRED, on the
 *     page whose own copy is about a man being turned away at a gate;
 *   - /messages called a message sent today a stale send, on a threshold
 *     of one day — the tightest possible, so the UTC roll-over is the
 *     whole of it;
 *   - /pipeline called a bid due today overdue;
 *   - /field-reports counted TODAY as a finished weekday, so a foreman
 *     still on site at 5pm was already listed as not having filed.
 *
 * THE FIXED POINT. 2026-09-23T00:01:00Z is 17:01 on Tuesday 22 September
 * in Los Angeles — one minute past the roll-over, which is where the
 * defect starts and where a test reading the real clock agrees with the
 * bug all morning. Every fixture date below is 2026-09-22: TODAY for the
 * reader, YESTERDAY in UTC. Each case carries something that proves the
 * page rendered, because every "does not say overdue" assertion here
 * would pass just as happily on an empty string.
 *
 * WHY THE COOKIE AND NOT A MOCK OF viewerToday. Mocking the helper would
 * only prove a page calls a function with that name. Mocking the request
 * exercises the real chain — the cookie components/TimeZoneCookie.tsx
 * writes, `resolveViewerTimeZone`, `todayInZone` and the page — so these
 * are assertions about what a person sees.
 */

const VIEWER_ZONE = "America/Los_Angeles";
/** 17:01 on Tuesday 22 September in Los Angeles; already the 23rd in UTC. */
const EVENING_IN_CALIFORNIA = new Date("2026-09-23T00:01:00.000Z");
/** The reader's day — a Tuesday, so /field-reports has one finished
 * weekday behind it and one that is still being worked. */
const TODAY = "2026-09-22";
/** Yesterday for the reader — genuinely late in either calendar. */
const YESTERDAY = "2026-09-21";

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

const context = {
  company: {
    id: "company-1",
    name: "Test Drywall",
    businessScopeAskedAt: utc("2026-01-01"),
  },
  id: "user-1",
  name: "Tester",
  email: null,
  role: "OWNER",
  jobFunction: null,
};

/* ------------------------------------------------------------ fixtures */

/** Due on the reader's today, unpaid, no retainage. */
const invoice = {
  id: "inv-1",
  number: 1,
  amount: "85000",
  retainageWithheld: null,
  issuedAt: utc("2026-08-22"),
  dueAt: utc(TODAY),
  jobId: "job-1",
  payments: [],
};

const job = {
  id: "job-1",
  name: "Tower B",
  status: "IN_PROGRESS",
  createdAt: utc("2026-08-01"),
  contact: { id: "contact-1", name: "Bell GC", paymentTermsDays: 30 },
  substantialCompletionDate: null,
  retainageReleases: [],
  invoices: [invoice],
  lineItems: [],
  assignments: [],
  timeEntries: [],
};

/** One card expiring on the reader's today, one that genuinely lapsed. */
const certifications = [
  {
    id: "cert-1",
    holderUserId: "user-1",
    companyId: "company-1",
    kind: "OSHA_30",
    otherLabel: null,
    issuer: "OSHA",
    referenceNumber: "A-1",
    issuedOn: utc("2021-09-21"),
    expiresOn: utc(TODAY),
    notes: null,
    documentUrl: null,
    documentLabel: null,
    createdAt: utc("2021-09-21"),
  },
  {
    id: "cert-2",
    holderUserId: "user-2",
    companyId: "company-1",
    kind: "SCAFFOLD",
    otherLabel: null,
    issuer: "Trainer",
    referenceNumber: "B-2",
    issuedOn: utc("2020-09-20"),
    expiresOn: utc(YESTERDAY),
    notes: null,
    documentUrl: null,
    documentLabel: null,
    createdAt: utc("2020-09-20"),
  },
];

const workers = [
  { id: "user-1", name: "Ana Ruiz", email: "ana@example.com" },
  { id: "user-2", name: "Ben Ortiz", email: "ben@example.com" },
];

/** Sent on the reader's today — nothing is stale yet. */
const messages = [
  {
    id: "msg-1",
    subject: "Revised shop drawings",
    body: "Attached.",
    toEmail: "pm@bellgc.example",
    toName: "Bell PM",
    sentAt: utc(TODAY),
    createdAt: utc(TODAY),
    job: { name: "Tower B" },
    sentBy: { name: "Tester" },
    events: [],
    attachments: [],
  },
];

/** A GC with one live invitation, due on the reader's today. `jobs` is
 * empty for the dashboard's GC-reliability column, which reads the same
 * model with a different select. */
const contacts = [
  {
    id: "contact-1",
    name: "Bell GC",
    jobs: [],
    bidInvitations: [
      {
        id: "bid-1",
        projectName: "Tower B fitout",
        status: "INVITED",
        dueDate: utc(TODAY),
        bidAmount: null,
      },
    ],
  },
];

/** Filed for the reader's yesterday. Today has nothing yet, which at 5pm
 * on site is not a gap — today is not over. */
const fieldReports = [
  {
    id: "fr-1",
    reportDate: utc(YESTERDAY),
    crewPresent: 4,
    workPerformed: "Framed grid 4 through 7.",
    weather: "Clear",
    delays: null,
    job: { id: "job-1", name: "Tower B" },
    filedBy: { name: "Tester", email: null },
  },
];

const data: Record<string, { findMany?: unknown[]; count?: number }> = {
  job: { findMany: [job] },
  invoice: { findMany: [{ ...invoice, job: { name: job.name, contact: job.contact } }] },
  user: { findMany: workers },
  workerCertification: { findMany: certifications },
  certificationRequirement: { findMany: [] },
  outboundMessage: { findMany: messages },
  contact: { findMany: contacts },
  dailyFieldReport: { findMany: fieldReports },
};

const prismaStub = new Proxy(
  {},
  {
    get: (_t, model: string) =>
      new Proxy(
        {},
        {
          get: (_m, method: string) => {
            if (method === "count") return vi.fn(async () => data[model]?.count ?? 0);
            if (method === "findUnique" || method === "findFirst") return vi.fn(async () => null);
            if (method === "findMany" || method === "groupBy")
              return vi.fn(async () => data[model]?.findMany ?? []);
            if (method === "aggregate") return vi.fn(async () => ({ _sum: {}, _count: 0 }));
            return vi.fn(async () => null);
          },
        },
      ),
  },
);

class DecimalStub {
  constructor(private readonly value: number | string) {}
  toString() {
    return String(this.value);
  }
}

vi.mock("@prova/db", () => ({
  prisma: prismaStub,
  Prisma: { Decimal: DecimalStub },
  TradeScope: {
    METAL_FRAMING_DRYWALL: "METAL_FRAMING_DRYWALL",
    LATH_PLASTER: "LATH_PLASTER",
    EIFS: "EIFS",
    ACOUSTICAL_CEILINGS: "ACOUSTICAL_CEILINGS",
    FIREPROOFING: "FIREPROOFING",
  },
  BidInvitationStatus: {
    INVITED: "INVITED",
    SUBMITTED: "SUBMITTED",
    WON: "WON",
    LOST: "LOST",
    DECLINED: "DECLINED",
  },
}));

vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({ allowed: true, context })),
}));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: vi.fn(async () => context),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "prova_tz" ? { value: VIEWER_ZONE } : undefined),
  }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/lib/actions/notifications", () => ({ sendMyAlertDigest: vi.fn() }));

const noSearchParams = () => Promise.resolve({});

beforeAll(() => {
  // Date only. Faking timers wholesale would take setTimeout with it and
  // React's renderer along with it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(EVENING_IN_CALIFORNIA);
});

afterAll(() => {
  vi.useRealTimers();
});

/** The money in a labelled StatCard, so an assertion names a figure rather
 * than a blob of markup. */
function statCard(html: string, label: string): string | null {
  const at = html.indexOf(`>${label}</p>`);
  if (at === -1) return null;
  return html.slice(at).match(/\$[\d,]+\.\d\d/)?.[0] ?? null;
}

/** The amount rendered under one aging-bucket heading. */
function agingBucket(html: string, label: string): string | null {
  const at = html.indexOf(`>${label}</p>`);
  if (at === -1) return null;
  return html.slice(at).match(/\$[\d,]+\.\d\d/)?.[0] ?? null;
}

/** The number rendered ABOVE a summary-tile caption, which is how
 * /certifications stacks its totals. */
function summaryTile(html: string, caption: string): string | null {
  const at = html.indexOf(`>${caption}</p>`);
  if (at === -1) return null;
  const before = html.slice(0, at);
  return before.match(/>(\d+)<\/p><p[^>]*$/)?.[1] ?? null;
}

/** The AR-expected cell of one forecast row. */
function forecastRow(html: string, label: string): string | null {
  const at = html.indexOf(`>${label}</td>`);
  if (at === -1) return null;
  return html.slice(at).match(/\$[\d,]+\.\d\d/)?.[0] ?? null;
}

describe("/cash-flow, an invoice due today, read at 17:01 in California", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/cash-flow/page");
    return renderToStaticMarkup(await Page());
  };

  it("renders the invoice — the page ran and has a row in it", async () => {
    const html = await load();
    expect(html).toContain("Tower B");
    expect(html).toContain("Bell GC");
    expect(html).toContain("Sep 22, 2026");
  });

  it("does not call an invoice due today overdue", async () => {
    const html = await load();
    expect(html).toContain(">Current</span>");
    expect(html).not.toContain("1d overdue");
  });

  it("ages it as current, not 1-30 days", async () => {
    const html = await load();
    expect(agingBucket(html, "Current")).toBe("$85,000.00");
    expect(agingBucket(html, "1–30 days")).toBe("$0.00");
  });

  it("forecasts it into this month rather than into Overdue", async () => {
    const html = await load();
    expect(forecastRow(html, "Sep 2026")).toBe("$85,000.00");
    expect(forecastRow(html, "Overdue")).toBe("$0.00");
  });
});

describe("/dashboard, the same invoice, the same minute", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/dashboard/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders the tiles — the page ran", async () => {
    const html = await load();
    expect(html).toContain("Overdue invoices");
    expect(html).toContain("Retainage held");
  });

  it("shows nothing past its due date", async () => {
    const html = await load();
    expect(statCard(html, "Overdue invoices")).toBe("$0.00");
    expect(html).toContain("Nothing past its due date.");
    expect(html).not.toContain("1 invoice past due");
  });
});

describe("/certifications, a card that expires today", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/certifications/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders both workers — the page ran and has rows in it", async () => {
    const html = await load();
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain("Ben Ortiz");
  });

  it("does not call a card that is good until today expired", async () => {
    const html = await load();
    // Ana's OSHA 30 runs out at the end of today, so today it is still a
    // card she can produce at the gate.
    expect(html).toContain("expires today");
    // Exactly one lapse, and it is Ben's, which genuinely ran out
    // yesterday. Counting rather than asserting absence: "no Expired
    // anywhere" would also pass on a page that rendered nothing.
    expect(html.split("expired 1 day ago").length - 1).toBe(1);
    expect(html).not.toContain("expired 2 days ago");
  });

  it("counts one expired card in the totals, not two", async () => {
    const html = await load();
    expect(summaryTile(html, "Expired")).toBe("1");
  });
});

describe("/messages, a message sent today", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/messages/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders the message — the page ran and has a row in it", async () => {
    const html = await load();
    expect(html).toContain("Revised shop drawings");
  });

  it("does not call today's send unconfirmed", async () => {
    const html = await load();
    // `stale` fires at one whole day, which is the tightest threshold in
    // the app — so the UTC roll-over is the entire difference between
    // "sent an hour ago" and "sent and never confirmed".
    expect(html).not.toContain("1 message sent and never confirmed delivered.");
    expect(html).toContain("1 message sent, nothing bounced, nothing confirmed yet.");
  });
});

describe("/pipeline, a bid due today", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/pipeline/page");
    return renderToStaticMarkup(await Page());
  };

  it("renders the invitation — the page ran and has a row in it", async () => {
    const html = await load();
    expect(html).toContain("Bell GC");
    expect(html).toContain("Tower B fitout");
    expect(html).toContain("Waiting on us");
  });

  it("does not call a bid due today past the date they asked for", async () => {
    const html = await load();
    expect(html).not.toContain("past the date they asked for");
  });
});

describe("/field-reports at 5pm on a workday nobody has filed yet", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/field-reports/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders yesterday's report — the page ran and has a row in it", async () => {
    const html = await load();
    expect(html).toContain("Framed grid 4 through 7.");
  });

  it("does not count today as a weekday that went unfiled", async () => {
    const html = await load();
    // Monday was filed; Tuesday is today and is still being worked. On
    // the server's UTC day Tuesday was already over at 17:01 Pacific, so
    // the page named it as a day nobody filed and dropped the week to 50%
    // — while the crew was still on site. The page's own #397 rule is
    // that today is not over, so nothing is claimed about it.
    expect(html).not.toContain("Tue, Sep 22");
    expect(html).toContain("100% of finished weekdays covered");
    expect(html).not.toContain("50% of finished weekdays covered");
  });
});
