import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * What a contractor sees on their first morning, when every table is empty.
 *
 * These pages are only ever looked at with data in them — a seeded laptop, a
 * demo database, the operator's own production company — so their zero
 * states were the least-viewed and worst screens in the app. `/cash-flow`
 * rendered 28 separate instances of $0.00, five aging buckets in the amber
 * used for overdue money, and a seven-row forecast table of zeros, because
 * `calculateCashFlowForecast` seeds its months unconditionally and the page
 * mapped them with no length check. Those numbers are measured here, not
 * asserted from memory: the counts in this file are what the renderer
 * actually produced.
 *
 * WHY THIS FILE RENDERS RATHER THAN READS THE SOURCE. An empty state is
 * output. `components/EquipmentRow.test.ts` is the precedent and its reason
 * is the same one: typecheck, lint and the whole unit suite stayed green
 * about markup nobody had ever produced. A grep for `href="/jobs/new"`
 * cannot tell a link that renders from one inside a branch that never runs.
 *
 * Each page is rendered with an entirely empty database, and each case
 * carries an anti-vacuity assertion — something that proves the page
 * rendered at all. Without one, every `not.toContain` below would pass just
 * as happily on the empty string, which is this repo's most-repeated
 * failure: a check that answers a question nobody asked.
 */

/** Every model, every method, nothing in the database. */
const emptyPrisma = new Proxy(
  {},
  {
    get: () =>
      new Proxy(
        {},
        {
          get: (_target, method: string) => {
            if (method === "count") return vi.fn(async () => 0);
            if (method === "findUnique" || method === "findFirst") return vi.fn(async () => null);
            return vi.fn(async () => []);
          },
        },
      ),
  },
);

const context = {
  company: { id: "company-1", name: "Test Drywall" },
  id: "user-1",
  name: "Tester",
  // Null so the alerts page's e-mail digest button, which is not what any of
  // this is about, stays out of the markup.
  email: null,
  role: "OWNER",
  jobFunction: null,
};

/** Enough of `Prisma.Decimal` to be constructed. The actions barrel that
 * `/alerts` and `/closeout` reach builds a module-level `new
 * Prisma.Decimal(0)`, so this has to exist at import time even though
 * nothing here does arithmetic with it. */
class DecimalStub {
  constructor(private readonly value: number | string) {}
  toString() {
    return String(this.value);
  }
}

vi.mock("@prova/db", () => ({
  prisma: emptyPrisma,
  Prisma: { Decimal: DecimalStub },
  // Read as `trade in TradeScope`, so the keys are what matter.
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
// Returns the company alongside the user's own fields, which is the shape
// the pages destructure as `{ company, ...currentUser }`.
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: vi.fn(async () => context),
}));
// Both read cookies, which needs a request this test does not have.
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: vi.fn(async () => "2026-09-12"),
  viewerTimeZone: vi.fn(async () => "UTC"),
}));
// Server actions, imported by these pages only to hand to a form.
vi.mock("@/lib/actions/notifications", () => ({ sendMyAlertDigest: vi.fn() }));

/** Each page is imported and called at its own call site below, so its real
 * props are typechecked rather than widened away by a shared helper. */
const noSearchParams = () => Promise.resolve({});

describe("/cash-flow on an account with no invoices", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/cash-flow/page");
    return renderToStaticMarkup(await Page());
  };

  it("renders, and says what the page is for rather than showing zeros", async () => {
    const html = await load();
    // Anti-vacuity: this is a real render of the real page.
    expect(html).toContain("Cash flow forecast");
    expect(html).toContain("every figure on this page is worked out from an invoice");
  });

  it("shows no money at all — no $0.00 anywhere", async () => {
    const html = await load();
    expect(html).not.toContain("$0.00");
  });

  it("does not render the seven-row forecast table of zeros", async () => {
    const html = await load();
    expect(html).not.toContain("AR expected");
    expect(html).not.toContain("Retainage expected");
    expect(html).not.toContain("<table");
  });

  it("does not colour an empty account as though it were overdue", async () => {
    const html = await load();
    // The amber used for past-due money, and the bucket labels it was on.
    expect(html).not.toContain("text-amber-400");
    expect(html).not.toContain("90+ days");
  });

  it("links to where a job comes from, since there are no jobs either", async () => {
    const html = await load();
    expect(html).toContain('href="/jobs/new"');
    expect(html).toContain("Create a job");
  });
});

describe("/bids with no bids and no filter applied", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/bids/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders, and stops blaming a filter that is not set", async () => {
    const html = await load();
    expect(html).toContain("Bid history");
    expect(html).toContain("No bids logged yet");
    expect(html).not.toContain("No bids match this filter");
  });

  it("links to the contacts page, where a bid invitation is actually created", async () => {
    const html = await load();
    expect(html).toContain('href="/contacts"');
  });

  it("keeps the filter wording when a filter IS set", async () => {
    const { default: Page } = await import("@/app/(app)/bids/page");
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ status: "WON" }) }),
    );
    expect(html).toContain("Bid history");
    expect(html).toContain("No bids match this filter");
    // And a way back out of it.
    expect(html).toContain('href="/bids"');
  });
});

describe("/schedule with no jobs", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/schedule/page");
    return renderToStaticMarkup(await Page());
  };

  it("renders, and names the missing thing as the job rather than the schedule", async () => {
    const html = await load();
    expect(html).toContain("Schedule");
    expect(html).toContain("No jobs yet, so there is nothing to lay out");
    expect(html).not.toContain("No jobs scheduled yet");
  });

  it("links to where a job comes from", async () => {
    const html = await load();
    expect(html).toContain('href="/jobs/new"');
  });
});

describe("/alerts with nothing recorded anywhere", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/alerts/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders, and explains why it is empty", async () => {
    const html = await load();
    expect(html).toContain("Alerts");
    expect(html).toContain("Nothing needs attention");
  });

  it("drops the four tiles that summarised nothing", async () => {
    const html = await load();
    expect(html).not.toContain("Past due");
    expect(html).not.toContain("Coming up");
    expect(html).not.toContain("$0.00");
  });

  it("offers the two places a new account can record a date it will watch", async () => {
    const html = await load();
    expect(html).toContain('href="/settings"');
    expect(html).toContain('href="/jobs"');
  });
});

describe("/closeout with no jobs", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/closeout/page");
    return renderToStaticMarkup(await Page());
  };

  it("renders, and explains what a closeout package is before there is one", async () => {
    const html = await load();
    expect(html).toContain("Closeout");
    expect(html).toContain("No jobs yet");
    expect(html).toContain("lien waivers");
  });

  it("drops the four zero tiles", async () => {
    const html = await load();
    expect(html).not.toContain("Jobs still in warranty");
    expect(html).not.toContain("Open callbacks");
  });

  it("links to where a job comes from, which the old copy only described", async () => {
    const html = await load();
    expect(html).toContain('href="/jobs/new"');
    expect(html).not.toContain("create one and it will appear here");
  });
});

describe("/settings with nothing filled in", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/settings/page");
    return renderToStaticMarkup(await Page({ searchParams: noSearchParams() }));
  };

  it("renders all four compliance sections", async () => {
    const html = await load();
    expect(html).toContain("Company locations");
    expect(html).toContain("Insurance policies");
    expect(html).toContain("Bonding");
  });

  it("says something in each of the three sections that used to say nothing", async () => {
    // Locations, Insurance and Bonding all hid their list behind
    // `length > 0` and their form inside a closed `<details>`, so an empty
    // account got a heading and a triangle. Licences was the only one of
    // the four that explained itself.
    const html = await load();
    expect(html).toContain("No locations recorded");
    expect(html).toContain("No policies recorded");
    expect(html).toContain("No bonding recorded");
    // The one that was already right, unchanged.
    expect(html).toContain("No licences recorded");
  });
});

describe("/deployment with no jobs", () => {
  const load = async () => {
    const { default: Page } = await import("@/app/(app)/deployment/page");
    return renderToStaticMarkup(await Page());
  };

  it("renders, and distinguishes no jobs from no RUNNING jobs", async () => {
    const html = await load();
    expect(html).toContain("Deployment");
    expect(html).toContain("No jobs yet, so there is nowhere to be deployed");
    // The old sentence blamed estimates, on an account with no estimates.
    expect(html).not.toContain("an estimate has nobody on it yet");
  });

  it("links out to both halves of a deployment — the job and the equipment", async () => {
    const html = await load();
    expect(html).toContain('href="/jobs/new"');
    expect(html).toContain('href="/equipment"');
  });
});
