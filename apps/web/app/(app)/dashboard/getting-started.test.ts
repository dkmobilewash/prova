import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The getting-started card as /dashboard actually renders it.
 *
 * lib/getting-started.test.ts pins the steps. This file pins the two rules
 * that live in the PAGE and nowhere else — the card is gone once every
 * required step is done, and gone when this company's hide cookie is on the
 * request — by rendering the real page against a fake database whose counts
 * each case sets. A grep for `!gettingStarted.complete` cannot tell a
 * condition that renders from one that does not.
 */

const state = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  countCalls: [] as string[],
  cookie: undefined as string | undefined,
  context: {
    company: { id: "co-1", name: "Dana Smith's Company" },
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
              if (method === "count") {
                return vi.fn(async () => {
                  state.countCalls.push(model);
                  return state.counts[model] ?? 0;
                });
              }
              if (method === "findUnique" || method === "findFirst") return vi.fn(async () => null);
              if (method === "aggregate") return vi.fn(async () => ({ _sum: {} }));
              if (method === "groupBy") return vi.fn(async () => []);
              return vi.fn(async () => []);
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
    toNumber() {
      return Number(this.value);
    }
  }
  return {
    prisma,
    Prisma: { Decimal: DecimalStub },
    JobStatus: { ESTIMATE: "ESTIMATE", CONTRACTED: "CONTRACTED", IN_PROGRESS: "IN_PROGRESS", COMPLETE: "COMPLETE" },
  };
});

vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => state.context) }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "prova_getting_started_hidden" && state.cookie !== undefined
        ? { name, value: state.cookie }
        : undefined,
  })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
// Not what this file is about, and it reaches for the network and the
// assistant's client state.
vi.mock("@/components/AskPanel", () => ({ AskPanel: () => null }));
// The button imports the actions barrel only to post to it.
vi.mock("@/lib/actions", () => ({ hideGettingStarted: vi.fn() }));

const { default: TodayPage } = await import("@/app/(app)/dashboard/page");

async function render() {
  return renderToStaticMarkup(await TodayPage({ searchParams: Promise.resolve({}) }));
}

/** Just the card's markup, so a link elsewhere on the page cannot satisfy
 * or spoil an assertion about the card. */
function card(html: string): string | null {
  const match = html.match(/<section aria-labelledby="getting-started-heading"[\s\S]*?<\/section>/);
  return match ? match[0] : null;
}

const ALL_REQUIRED_DONE = { job: 1, user: 2, crewScheduleDay: 1, dailyFieldReport: 1 };

beforeEach(() => {
  state.counts = {};
  state.countCalls = [];
  state.cookie = undefined;
  state.context.company.name = "Dana Smith's Company";
  state.context.role = "OWNER";
  state.context.jobFunction = null;
});

describe("/dashboard getting-started card", () => {
  it("shows on a brand-new account, with its progress", async () => {
    const html = await render();
    // Anti-vacuity: the real page rendered.
    expect(html).toContain("What needs a decision");
    const section = card(html);
    expect(section).not.toBeNull();
    expect(section).toContain("0 of 5 done.");
    expect(section).toContain('href="/jobs/new"');
    expect(section).toContain('href="/ask"');
    expect(section).toContain("Hide this");
  });

  it("on a company with no jobs, follows the jobs empty state and sits above the Ask box", async () => {
    // This fake database has no jobs, so this is the brand-new-account
    // layout; the order with jobs is pinned in new-account.test.ts.
    const html = await render();
    const emptyAt = html.indexOf('data-tour="dashboard-jobs-empty"');
    const cardAt = html.indexOf("getting-started-heading");
    const askAt = html.indexOf('data-tour="dashboard-ask"');
    expect(emptyAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeLessThan(cardAt);
    expect(cardAt).toBeLessThan(askAt);
  });

  it("ticks steps from the counts", async () => {
    state.counts = { job: 1 };
    const section = card(await render());
    expect(section).toContain("1 of 5 done.");
    expect(section).toMatch(/data-step="first-job" data-done="true"/);
    expect(section).toMatch(/data-step="schedule" data-done="false"/);
  });

  it("is gone once every required step is done", async () => {
    state.context.company.name = "Smith Drywall LLC";
    state.counts = ALL_REQUIRED_DONE;
    const html = await render();
    expect(html).toContain("What needs a decision");
    expect(card(html)).toBeNull();
  });

  it("stays while one required step is left, even with every optional one done", async () => {
    state.context.company.name = "Smith Drywall LLC";
    state.counts = { ...ALL_REQUIRED_DONE, crewScheduleDay: 0, quickBooksConnection: 1 };
    expect(card(await render())).toContain("4 of 5 done.");
  });

  it("is gone when this company's hide cookie is on the request, and asks nothing", async () => {
    state.cookie = "co-1";
    const html = await render();
    expect(html).toContain("What needs a decision");
    expect(card(html)).toBeNull();
    expect(state.countCalls).not.toContain("crewScheduleDay");
    expect(state.countCalls).not.toContain("quickBooksConnection");
  });

  it("still shows when the cookie names a different company", async () => {
    state.cookie = "co-other";
    expect(card(await render())).not.toBeNull();
  });

  it("shows a FIELD member only what they can reach — no settings, team or assistant", async () => {
    state.context.role = "MEMBER";
    state.context.jobFunction = "FIELD";
    const section = card(await render());
    expect(section).not.toBeNull();
    expect(section).toContain("0 of 3 done.");
    expect(section).not.toContain('href="/settings');
    expect(section).not.toContain('href="/team"');
    expect(section).not.toContain('href="/ask"');
    expect(section).toContain('href="/field-reports"');
  });

  it("never puts white text on the brand yellow", async () => {
    state.counts = { job: 1 };
    const section = card(await render()) ?? "";
    expect(section).toContain("bg-brand");
    expect(section).not.toMatch(/bg-brand[^"]*text-white|text-white[^"]*bg-brand/);
  });
});
