import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * /rfis, /submittals and /drawings, read at 7pm in California.
 *
 * All three decided what day it was with `new Date().toISOString().slice(0,
 * 10)` — the SERVER's UTC day — and then compared plain calendar dates
 * against it. West of UTC that day rolls over in the afternoon, so from 5pm
 * Pacific (4pm in the summer) until midnight:
 *
 *   - an RFI due today read "Overdue", and the status line named it and
 *     quoted how many days late it was;
 *   - a submittal the GC still had until today read "past the due-back
 *     date";
 *   - a drawing revision that had been missing two days read "waiting 3
 *     days".
 *
 * These are the three screens a sub takes to an argument about who sat on
 * what, so being a day out is not cosmetic. It is the same defect as issue
 * #111 item 1, on the pages the alert engine's fix did not reach.
 *
 * WHY NOTHING CAUGHT IT. `isOverdue` in components/rfiLabels.ts and
 * components/submittalLabels.ts is pure and correct, and its unit tests pass
 * it a `today` of their own choosing — they cannot see which clock the PAGE
 * reads, and would be just as green handed the UTC day forever. A test that
 * reads the real clock cannot see it either: it agrees with the bug all
 * morning and only disagrees after 5pm Pacific, which is the bug wearing a
 * disguise. So the instant and the zone below are both fixed, and the page
 * is rendered rather than inspected.
 *
 * THE FIXED POINT. 2026-09-16T02:00:00Z is 7pm on 15 September in Los
 * Angeles. Every date in these fixtures is chosen so the two calendars
 * disagree about it: a row dated 2026-09-15 is TODAY for the reader and
 * YESTERDAY in UTC, which is exactly the window the defect lived in. Each
 * case also carries a row that IS genuinely late, so "nothing says overdue"
 * can never pass by the page failing to render.
 */

const VIEWER_ZONE = "America/Los_Angeles";
/** 7pm 15 Sep in Los Angeles; already 16 Sep in UTC. */
const EVENING_IN_CALIFORNIA = new Date("2026-09-16T02:00:00.000Z");
/** The reader's day. */
const TODAY = "2026-09-15";
/** Yesterday for the reader — genuinely late, in either calendar. */
const YESTERDAY = "2026-09-14";

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

const context = {
  company: { id: "company-1", name: "Test Drywall" },
  id: "user-1",
  name: "Tester",
  email: null,
  role: "OWNER",
  jobFunction: null,
};

const job = { id: "job-1", name: "Tower B", status: "ACTIVE", contact: { name: "Bell GC" } };

/** One RFI due on the reader's today, one due the day before. */
const rfiRows = [
  {
    id: "rfi-1",
    number: 1,
    job: { name: job.name },
    subject: "Head of wall at grid 4",
    question: "Which detail governs?",
    drawingReference: "A-501",
    specSection: "09 21 16",
    status: "SENT",
    sentOn: utc("2026-09-08"),
    dueBy: utc(TODAY),
    answeredOn: null,
    answer: null,
    costImpact: false,
    scheduleImpact: false,
    askedBy: { name: "Tester" },
  },
  {
    id: "rfi-2",
    number: 2,
    job: { name: job.name },
    subject: "Shaft wall rating",
    question: "One hour or two?",
    drawingReference: "A-502",
    specSection: "09 21 16",
    status: "SENT",
    sentOn: utc("2026-09-08"),
    dueBy: utc(YESTERDAY),
    answeredOn: null,
    answer: null,
    costImpact: false,
    scheduleImpact: false,
    askedBy: { name: "Tester" },
  },
];

const submittalRows = [
  {
    id: "sub-1",
    number: 1,
    job: { name: job.name },
    title: "Track and stud data",
    description: null,
    specSection: "09 22 16",
    drawingReference: null,
    submittedBy: { name: "Tester" },
    revisions: [
      {
        revisionNumber: 0,
        sentOn: utc("2026-09-01"),
        dueBack: utc(TODAY),
        returnedOn: null,
        outcome: null,
        responseNotes: null,
      },
    ],
  },
  {
    id: "sub-2",
    number: 2,
    job: { name: job.name },
    title: "Shaft wall assembly",
    description: null,
    specSection: "09 22 16",
    drawingReference: null,
    submittedBy: { name: "Tester" },
    revisions: [
      {
        revisionNumber: 0,
        sentOn: utc("2026-09-01"),
        dueBack: utc(YESTERDAY),
        returnedOn: null,
        outcome: null,
        responseNotes: null,
      },
    ],
  },
];

const drawingSetRows = [
  {
    id: "set-1",
    name: "Architectural",
    description: null,
    job: { name: job.name },
    revisions: [
      {
        id: "rev-1",
        label: "Bulletin 3",
        // Issued two days before the reader's today, three before UTC's.
        issuedOn: utc("2026-09-13"),
        receivedOn: null,
        description: null,
        fileUrl: null,
        fileName: null,
      },
    ],
  },
];

/** Only the models and methods these three pages call. Anything else
 * returns nothing, so a page reaching further fails loudly rather than
 * rendering half of itself. */
const data: Record<string, { findMany?: unknown[]; count?: number }> = {
  job: { findMany: [job] },
  rfi: { findMany: rfiRows, count: 0 },
  submittal: { findMany: submittalRows },
  drawingSet: { findMany: drawingSetRows },
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
            if (method === "findMany") return vi.fn(async () => data[model]?.findMany ?? []);
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

/**
 * The cookie, NOT lib/viewerToday.ts.
 *
 * Mocking `viewerToday` would only prove the page calls a function with that
 * name. Mocking the request instead exercises the real chain — the cookie
 * components/TimeZoneCookie.tsx writes, `resolveViewerTimeZone`,
 * `todayInZone` and the page — so this test is about the behaviour a person
 * gets, not about an import.
 */
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "prova_tz" ? { value: VIEWER_ZONE } : undefined),
  }),
  headers: async () => ({ get: () => null }),
}));

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

describe("/rfis after the UTC day has rolled over", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/rfis/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders both RFIs — the page ran and has rows in it", async () => {
    const html = await load();
    expect(html).toContain("Head of wall at grid 4");
    expect(html).toContain("Shaft wall rating");
  });

  it("does not call an RFI due today overdue", async () => {
    const html = await load();
    // Exactly one, and it is #2 — the one genuinely a day late. Counting
    // rather than asserting absence: "no Overdue anywhere" would also pass
    // on a page that rendered nothing.
    expect(html.split(">Overdue<").length - 1).toBe(1);
  });

  it("names only the genuinely late RFI in the status line, with the right day count", async () => {
    const html = await load();
    expect(html).toContain("1 RFI past the date we asked for — #2 Tower B (1 day)");
    // On the server's UTC day this said "2 RFIs", and #1 — due today — was
    // in the list at one day late.
    expect(html).not.toContain("2 RFIs past the date we asked for");
    expect(html).not.toContain("#1 Tower B");
  });
});

describe("/submittals after the UTC day has rolled over", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/submittals/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders both packages — the page ran and has rows in it", async () => {
    const html = await load();
    expect(html).toContain("Track and stud data");
    expect(html).toContain("Shaft wall assembly");
  });

  it("does not say the GC blew a due-back date that has not passed", async () => {
    const html = await load();
    expect(html.split(">Overdue<").length - 1).toBe(1);
    expect(html).toContain("1 submittal with the GC past the due-back date — #2 Tower B (1 day)");
    expect(html).not.toContain("2 submittals with the GC past the due-back date");
    expect(html).not.toContain("#1 Tower B");
  });
});

describe("/drawings after the UTC day has rolled over", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/drawings/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders the set — the page ran and has rows in it", async () => {
    const html = await load();
    expect(html).toContain("Architectural");
    expect(html).toContain("Bulletin 3");
    expect(html).toContain("NOT RECEIVED");
  });

  it("counts the wait from the reader's calendar, not the server's", async () => {
    const html = await load();
    // Issued 13 Sep; it is the 15th where the reader is standing and the
    // 16th in UTC. Two days, not three.
    expect(html).toContain("waiting 2 days");
    expect(html).not.toContain("waiting 3 days");
  });
});

/* ------------------------------------------------------------ the guard */

/**
 * The renders above prove the behaviour on three pages. This proves the
 * expression is gone, which is the cheap half and the one that names the
 * mistake for whoever reintroduces it.
 *
 * The file list is written out rather than derived on purpose: a glob that
 * stopped matching would leave this describe asserting nothing at all, which
 * is the failure mode this repo keeps paying for. `readFileSync` throws on a
 * path that moves, so the list cannot rot quietly.
 */
describe("the correspondence pages take their day from the reader", () => {
  const pages = ["app/(app)/rfis/page.tsx", "app/(app)/submittals/page.tsx", "app/(app)/drawings/page.tsx"];

  it("is three pages, all of them read", () => {
    expect(pages).toHaveLength(3);
    for (const page of pages) {
      expect(readFileSync(join(process.cwd(), page), "utf8").length).toBeGreaterThan(0);
    }
  });

  it.each(pages)("%s asks viewerToday() and derives no day from the server clock", (page) => {
    const source = readFileSync(join(process.cwd(), page), "utf8");
    expect(source).toContain("await viewerToday()");
    // `new Date()` alone is fine — an instant is the one thing UTC is right
    // about. It is `.toISOString()` on top of it, turning an instant into a
    // calendar day, that was the defect.
    expect(source).not.toMatch(/new Date\(\)\.toISOString\(\)/);
  });
});
