import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A page with nothing in it says so ONCE.
 *
 * Cyrus's repeated complaint is that pages "look empty", and on these four
 * it was measurable: `/safety` printed "No cases logged for 2026." twice in
 * a row (the status line, then the paragraph under it), and `/rfis`,
 * `/submittals` and `/drawings` stacked three empties — a status line ("No
 * open RFIs."), a zero count header ("0 in play · Show closed"), then the
 * EmptyState's own title. `/bids` already hid its count at zero; these now
 * do the same.
 *
 * The other half matters as much: a company that HAS records must keep
 * every line it had. So each page is rendered twice — on an empty database,
 * and on one where records exist but the current filter shows none — and
 * the second render must still carry the status line and the count.
 *
 * Rendered, not grepped, for the reason empty-states.test.ts gives: a grep
 * cannot tell a line that renders from one inside a branch that never runs.
 * Every negative assertion sits beside a positive one proving the page
 * rendered at all.
 */

type Seed = Record<string, Record<string, unknown>>;
let seed: Seed = {};

/** Every model, every method: whatever `seed` says, else empty. */
const prismaStub = new Proxy(
  {},
  {
    get: (_t, model: string) =>
      new Proxy(
        {},
        {
          get: (_target, method: string) => {
            return vi.fn(async () => {
              const seeded = seed[model]?.[method];
              if (seeded !== undefined) return typeof seeded === "function" ? (seeded as () => unknown)() : seeded;
              if (method === "count") return 0;
              if (method === "findUnique" || method === "findFirst") return null;
              return [];
            });
          },
        },
      ),
  },
);

const context = {
  company: { id: "company-1", name: "Test Drywall" },
  id: "user-1",
  name: "Tester",
  email: null,
  role: "OWNER",
  jobFunction: null,
};

class DecimalStub {
  constructor(private readonly value: number | string) {}
  toString() {
    return String(this.value);
  }
}

vi.mock("@prova/db", () => ({
  prisma: prismaStub,
  Prisma: { Decimal: DecimalStub },
}));
vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({ allowed: true, context })),
}));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: vi.fn(async () => context),
}));
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: vi.fn(async () => "2026-09-12"),
  viewerTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/safety",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const JOB = { id: "job-1", name: "Oak Ave Medical", status: "IN_PROGRESS", contact: { name: "Turner" } };

beforeEach(() => {
  seed = {};
});

function count(html: string, pattern: RegExp) {
  return html.match(new RegExp(pattern.source, "g"))?.length ?? 0;
}

// ------------------------------------------------------------------ safety --

describe("/safety", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/safety/page");
    return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  };

  it("never logged anything: ONE 'no cases' sentence, inside an EmptyState with an example", async () => {
    const html = await load();
    expect(html).toContain("Incident log");
    expect(count(html, /No cases logged for \d{4}/)).toBe(1);
    expect(html).not.toContain("data-status=");
    expect(html).toContain('data-tour="safety-empty"');
    // The example is marked as one, never passed off as a record.
    expect(html).toContain("data-empty-example");
    expect(html).toContain("Case 2026-003");
    // Its primary presses the page's own Record an incident button.
    expect(html).toMatch(/<button(?=[^>]*bg-brand)[^>]*data-opens="safety-record-incident"/);
  });

  it("toolbox talks get their own EmptyState rather than a bare sentence", async () => {
    const html = await load();
    expect(html).toContain('data-tour="safety-talks-empty"');
    expect(html).toContain("No toolbox talks logged yet");
    expect(html).not.toContain("Nothing logged yet.");
  });

  it("cases in an earlier year only: still one sentence, and no teaching example", async () => {
    // First findMany is the distinct years; the second, this year's cases.
    let call = 0;
    seed.safetyIncident = { findMany: () => (call++ === 0 ? [{ caseYear: 2019 }] : []) };
    const html = await load();
    expect(html).toContain("Incident log");
    expect(count(html, /No cases logged for \d{4}/)).toBe(1);
    expect(html).not.toContain('data-tour="safety-empty"');
  });
});

// ------------------------------------------------------ the three list pages --

type ListCase = {
  route: string;
  model: string;
  load: (params: Record<string, string>) => Promise<string>;
  /** The zero-count header, as the page writes it. */
  header: RegExp;
  /** The status line's zero sentence. */
  status: string;
};

const LIST_PAGES: ListCase[] = [
  {
    route: "/rfis",
    model: "rfi",
    load: async (params) => {
      const { default: Page } = await import("@/app/(app)/rfis/page");
      return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
    },
    header: />0 (?:<!-- -->)?in play</,
    status: "No open RFIs.",
  },
  {
    route: "/submittals",
    model: "submittal",
    load: async (params) => {
      const { default: Page } = await import("@/app/(app)/submittals/page");
      return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
    },
    header: />0 (?:<!-- -->)?in play</,
    status: "No submittals yet.",
  },
  {
    route: "/drawings",
    model: "drawingSet",
    load: async (params) => {
      const { default: Page } = await import("@/app/(app)/drawings/page");
      return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
    },
    header: />0 (?:<!-- -->)?sets</,
    status: "No drawing sets yet.",
  },
];

for (const page of LIST_PAGES) {
  describe(`${page.route}`, () => {
    it("never logged anything: the EmptyState alone, no status line and no zero count above it", async () => {
      const html = await page.load({});
      expect(html).toContain("data-empty-state");
      expect(html).not.toMatch(page.header);
      expect(html).not.toContain(page.status);
      expect(html).not.toContain("data-status=");
    });

    it("records exist but this filter shows none: the count header is still there", async () => {
      seed.job = { findMany: [JOB] };
      seed[page.model] = { count: 2 };
      const html = await page.load({ job: JOB.id });
      expect(html).not.toContain("data-empty-state");
      expect(html).toMatch(page.header);
      expect(html, "the status line went missing on an account with records").toContain("data-status=");
    });
  });
}
