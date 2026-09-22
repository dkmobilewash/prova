import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The change-order decision date, defaulted at 18:00 in Denver.
 *
 * `components/ChangeOrders.tsx` rolled its own `today()` —
 * `new Date().toISOString().slice(0, 10)`, the server's UTC day — and used
 * it for three things a GC later quotes back: the "Decision date" input
 * when a CO is approved, the hidden `decidedOn` sent with Reject and
 * Withdraw, and the "Date sent to GC" input on a draft.
 *
 * From 17:00 Mountain (18:00 in the summer) that is TOMORROW. So a change
 * order approved at 6pm records "answered Sep 23" on a document the GC
 * reads, and a PM correcting it to the 22nd the next morning is refused by
 * `lib/actions/changeOrders.ts` — "A change order can't be answered before
 * it was sent" — which blames the contractor for entering the right date.
 *
 * WHY NOT components/localToday.ts, which is what ~30 other forms use.
 * That one asks the BROWSER during render, and its own comment says it may
 * only be called from a component mounted by a user action. These three
 * are not: `<Decision>` renders for every SUBMITTED change order and
 * `<DraftActions>` for every DRAFT, straight out of the server render. A
 * `localToday()` here is a hydration mismatch — and the hidden inputs are
 * CONTROLLED, so it is the loud kind.
 *
 * So the day is worked out on the server, from request data, and handed
 * down as a prop: `viewerToday()`, the same helper the fourteen pages that
 * already got this right use. The zone arrives on a cookie, the markup is
 * identical on both sides, and the component computes no day at all.
 *
 * THE FIXED POINT. 2026-09-23T00:01:00Z is 18:01 on 22 September in
 * Denver. The reader's day is the 22nd; UTC has already rolled to the
 * 23rd.
 */

const VIEWER_ZONE = "America/Denver";
/** 18:01 on 22 September in Denver; already the 23rd in UTC. */
const EVENING_IN_DENVER = new Date("2026-09-23T00:01:00.000Z");
/** The reader's day. */
const TODAY = "2026-09-22";
/** What the server's own clock would have said. */
const UTC_DAY = "2026-09-23";

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

const context = {
  company: { id: "company-1", name: "Test Drywall" },
  id: "user-1",
  name: "Tester",
  email: "tester@example.com",
  role: "OWNER",
  jobFunction: null,
};

const jobRef = { id: "job-1", companyId: "company-1", name: "Tower B", status: "CONTRACTED" };

/** One SUBMITTED change order, which is what renders <Decision>, and one
 * DRAFT, which is what renders <DraftActions>. Between them they cover all
 * four date defaults in the file. */
const changeOrders = [
  {
    id: "co-1",
    number: 1,
    jobId: "job-1",
    title: "Tile backsplash",
    description: null,
    status: "SUBMITTED",
    submittedOn: utc("2026-09-15"),
    decidedOn: null,
    decisionNotes: null,
    appliedAt: null,
    createdAt: utc("2026-09-14"),
    edits: [],
    proposals: [],
    supersedes: null,
    revisions: [],
  },
  {
    id: "co-2",
    number: 2,
    jobId: "job-1",
    title: "Extra soffit",
    description: null,
    status: "DRAFT",
    submittedOn: null,
    decidedOn: null,
    decisionNotes: null,
    appliedAt: null,
    createdAt: utc("2026-09-20"),
    edits: [],
    proposals: [],
    supersedes: null,
    revisions: [],
  },
];

const job = {
  ...jobRef,
  contact: { name: "Bell GC", email: "pm@bellgc.example" },
  signatureRequests: [],
  contractDocuments: [],
  lineItems: [],
  estimateVersions: [],
  changeOrders,
  timeEntries: [],
  invoices: [],
  retainagePercent: null,
  substantialCompletionDate: null,
  startDate: null,
  createdAt: utc("2026-08-01"),
};

const findUniqueByModel: Record<string, unknown> = { job };
const findManyByModel: Record<string, unknown[]> = {};

const prismaStub = new Proxy(
  {},
  {
    get: (_t, model: string) =>
      new Proxy(
        {},
        {
          get: (_m, method: string) => {
            if (method === "count") return vi.fn(async () => 0);
            if (method === "findUnique" || method === "findFirst")
              return vi.fn(async () => findUniqueByModel[model] ?? null);
            if (method === "findMany" || method === "groupBy")
              return vi.fn(async () => findManyByModel[model] ?? []);
            if (method === "aggregate") return vi.fn(async () => ({ _sum: {}, _count: 0 }));
            return vi.fn(async () => null);
          },
        },
      ),
  },
);

/** Enough of `Prisma.Decimal` for the change-order exposure arithmetic
 * this page does on the way to rendering the forms. Plain numbers: the
 * figures here are zero and this file is about a date. */
class DecimalStub {
  readonly n: number;
  constructor(value: number | string | DecimalStub) {
    this.n = typeof value === "object" ? value.n : Number(value);
  }
  private static of(value: number | string | DecimalStub) {
    return new DecimalStub(value);
  }
  add(other: number | string | DecimalStub) {
    return DecimalStub.of(this.n + new DecimalStub(other).n);
  }
  sub(other: number | string | DecimalStub) {
    return DecimalStub.of(this.n - new DecimalStub(other).n);
  }
  mul(other: number | string | DecimalStub) {
    return DecimalStub.of(this.n * new DecimalStub(other).n);
  }
  div(other: number | string | DecimalStub) {
    return DecimalStub.of(this.n / new DecimalStub(other).n);
  }
  negated() {
    return DecimalStub.of(-this.n);
  }
  abs() {
    return DecimalStub.of(Math.abs(this.n));
  }
  isZero() {
    return this.n === 0;
  }
  equals(other: number | string | DecimalStub) {
    return this.n === new DecimalStub(other).n;
  }
  lessThan(other: number | string | DecimalStub) {
    return this.n < new DecimalStub(other).n;
  }
  greaterThan(other: number | string | DecimalStub) {
    return this.n > new DecimalStub(other).n;
  }
  toNumber() {
    return this.n;
  }
  toFixed(digits = 2) {
    return this.n.toFixed(digits);
  }
  toString() {
    return String(this.n);
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

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: vi.fn(async () => context),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/jobs/job-1/estimate",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: vi.fn(() => {
    throw new Error("notFound() — the job fixture did not match");
  }),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "prova_tz" ? { value: VIEWER_ZONE } : undefined),
  }),
  headers: async () => ({ get: () => null }),
}));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(EVENING_IN_DENVER);
});

afterAll(() => {
  vi.useRealTimers();
});

/** Every `value`/`defaultValue` rendered for a named form field. */
function fieldValues(html: string, name: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "g"))) {
    found.push(m[0].match(/value="([^"]*)"/)?.[1] ?? "");
  }
  return found;
}

describe("the change-order date defaults at 18:01 in Denver", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/jobs/[id]/(tabs)/estimate/page");
    return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "job-1" }) }));
  };

  it("renders both change orders — the page ran and has the forms in it", async () => {
    const html = await load();
    expect(html).toContain("Tile backsplash");
    expect(html).toContain("Extra soffit");
    expect(html).toContain("Decision date");
    expect(html).toContain("Date sent to GC");
  });

  it("defaults the decision date to the reader's day, not the server's", async () => {
    const html = await load();
    const decidedOn = fieldValues(html, "decidedOn");
    // Three: the Approve form's visible date input, and the hidden inputs
    // on Reject and Withdraw. All three are markup the SERVER produced.
    expect(decidedOn).toHaveLength(3);
    expect(new Set(decidedOn)).toEqual(new Set([TODAY]));
    expect(decidedOn).not.toContain(UTC_DAY);
  });

  it("defaults the date sent to the GC to the reader's day too", async () => {
    const html = await load();
    expect(fieldValues(html, "submittedOn")).toEqual([TODAY]);
  });
});
