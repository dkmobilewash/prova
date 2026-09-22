import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two things about the job pages that a word count said were fine and an
 * eye said were not.
 *
 * 1. WIDTH. `(tabs)/layout.tsx` put the header, the tab rail and every tab
 *    body inside `mx-auto max-w-3xl`, so every job tab was a 768px column
 *    with half the screen empty and no way for a tab to change it. The
 *    layout is now a `working` PageShell and each tab picks its body width.
 *
 * 2. THE RETAINAGE TAB WITH NOTHING WITHHELD. Three $0.00 tiles between two
 *    forms, one of them offering to "Log release" of money nobody holds.
 *    Now one sentence pointing at the Billing tab, where retainage actually
 *    comes from — and the figures and the release form come back the moment
 *    there is anything withheld or released.
 */

const state = vi.hoisted(() => ({
  job: {} as Record<string, unknown>,
  context: {
    company: { id: "co-1", name: "Ithy Drywall & Acoustics" },
    id: "user-1",
    name: "Dana Smith",
    email: null,
    role: "OWNER",
    jobFunction: null as string | null,
  },
}));

vi.mock("@prova/db", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy(
          {},
          {
            get: (_u, method: string) => {
              if (model === "job" && method === "findUnique") return vi.fn(async () => state.job);
              if (model === "job" && method === "findFirst") return vi.fn(async () => ({ id: "job-1", status: "IN_PROGRESS" }));
              return vi.fn(async () => []);
            },
          },
        ),
    },
  ),
  Prisma: {},
}));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => state.context) }));
vi.mock("@/lib/jobs/job-access", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/jobs/job-access")>();
  return {
    ...real,
    requireJob: vi.fn(async () => ({
      company: state.context.company,
      currentUser: state.context,
      principal: { role: state.context.role, jobFunction: state.context.jobFunction },
      job: { id: "job-1", status: "IN_PROGRESS" },
    })),
  };
});
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: vi.fn(async () => "America/Denver") }));
vi.mock("@/lib/actions", () => ({
  updateJobRetainageTerms: vi.fn(),
  createRetainageRelease: vi.fn(),
  deleteRetainageRelease: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/jobs/job-1/retainage",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

const { default: RetainagePage } = await import("@/app/(app)/jobs/[id]/(tabs)/retainage/page");

function retainageJob(withheld: (number | null)[], releases: { id: string; amount: number }[] = []) {
  return {
    id: "job-1",
    retainagePercent: { toString: () => "10" },
    substantialCompletionDate: null,
    contact: { defaultRetainagePercent: null },
    lineItems: [],
    invoices: withheld.map((retainageWithheld) => ({ retainageWithheld })),
    retainageReleases: releases.map((r) => ({
      id: r.id,
      amount: r.amount,
      note: null,
      releasedAt: new Date("2026-09-10T00:00:00.000Z"),
    })),
  };
}

async function renderRetainage() {
  return renderToStaticMarkup(await RetainagePage({ params: Promise.resolve({ id: "job-1" }) }));
}

beforeEach(() => {
  state.job = retainageJob([]);
});

describe("retainage tab with nothing withheld", () => {
  it("says so once, with the way to the Billing tab, and no $0.00 tiles or release form", async () => {
    const html = await renderRetainage();
    expect(html, "the real page rendered").toContain("Retainage");
    expect(html).toContain("Nothing withheld yet. Retainage comes off each invoice you create on the");
    expect(html).toMatch(/href="\/jobs\/job-1\/billing"[^>]*>\s*Billing tab/);
    expect(html).toContain("at the rate above.");
    expect(html).not.toContain("$0.00");
    expect(html).not.toContain("Log release");
    expect(html).not.toContain("Total withheld");
    // The rate form stays — the sentence points at it.
    expect(html).toContain('name="retainagePercent"');
  });

  it("an invoice that withheld nothing is still nothing withheld", async () => {
    state.job = retainageJob([0, null]);
    expect(await renderRetainage()).toContain("Nothing withheld yet.");
  });

  it("speaks plain English about the rate — no 'snapshotted'", async () => {
    const html = await renderRetainage();
    expect(html).not.toMatch(/snapshot/i);
    expect(html).toContain("Each invoice keeps the retainage worked out when it was created");
  });
});

describe("retainage tab with something to show — unchanged", () => {
  it("shows the three figures and the release form once anything is withheld", async () => {
    state.job = retainageJob([1_250]);
    const html = await renderRetainage();
    expect(html).not.toContain("Nothing withheld yet");
    expect(html).toContain("Total withheld");
    expect(html).toContain("$1,250.00");
    expect(html).toContain("Log release");
  });

  it("keeps a logged release visible even with nothing withheld", async () => {
    state.job = retainageJob([], [{ id: "r-1", amount: 400 }]);
    const html = await renderRetainage();
    expect(html).not.toContain("Nothing withheld yet");
    expect(html).toContain("$400.00");
    expect(html).toContain("Log release");
  });

  it("is a reading-width body inside the layout", async () => {
    expect(await renderRetainage()).toMatch(/^<div class="max-w-3xl print:max-w-none">/);
  });
});

describe("job tab widths", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it("the layout is a working-width shell and no longer caps every tab at 768px", () => {
    const layout = read("./(tabs)/layout.tsx");
    expect(layout).toMatch(/<PageShell width="working"/);
    expect(layout).not.toMatch(/className="[^"]*max-w-3xl/);
  });

  it("the three reading tabs narrow themselves; the rest take the working width", () => {
    for (const tab of ["compliance", "retainage", "field-reports"]) {
      expect(read(`./(tabs)/${tab}/page.tsx`), `${tab} should be reading width`).toMatch(
        /<PageColumn width="reading">/,
      );
    }
    for (const tab of ["page.tsx", "billing/page.tsx", "estimate/page.tsx", "crew/page.tsx", "photos/page.tsx"]) {
      expect(read(`./(tabs)/${tab}`), `${tab} should be working width`).not.toMatch(/PageColumn|max-w-3xl/);
    }
  });
});
