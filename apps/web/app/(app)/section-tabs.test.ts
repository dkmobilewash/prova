import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * /settings is five tabs, one group rendered per visit (density audit #2:
 * fifteen sections and 7.1 screens on one scroll). Three things can go wrong
 * and all three are silent in a browser:
 *
 *   1. a tab renders another tab's section too (the page is tall again), or
 *      a section is in NO tab (a feature quietly gone) — so every heading
 *      the page had is required in exactly one tab;
 *   2. the tab lit in the row is not the group shown;
 *   3. a deep link into a section of a non-default tab lands on Company,
 *      because a `#hash` never reaches the server — so every
 *      `/settings?tab=…#id` in the app must land on a render carrying that id.
 *
 * /union-compliance gets the same census (audit #5): three tabs, each
 * section in exactly one.
 *
 * Rendered from the real page against an empty database, as
 * empty-states.test.ts does.
 */

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

const context = { company: { id: "company-1", name: "Test Drywall" }, id: "user-1", name: "Tester", email: null, role: "OWNER", jobFunction: null };

let search = new URLSearchParams();
let pathname = "/settings";

vi.mock("@prova/db", () => ({ prisma: emptyPrisma, Prisma: { Decimal: class {} } }));
vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed: true, context })) }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => context) }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: vi.fn(async () => "2026-10-13"), viewerTimeZone: vi.fn(async () => "UTC") }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => search,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// QuickBooks keys present (names only), so the tab renders its Connect
// branch — the one carrying `#quickbooks-import`, which /settings/import
// links to.
beforeAll(() => {
  vi.stubEnv("QUICKBOOKS_CLIENT_ID", "x");
  vi.stubEnv("QUICKBOOKS_CLIENT_SECRET", "x");
  vi.stubEnv("QUICKBOOKS_REDIRECT_URI", "https://x.test/cb");
});
afterAll(() => vi.unstubAllEnvs());

/** Every H2 the page had before it was tabbed, by the tab it now lives on. */
const EXPECTED: Record<string, string[]> = {
  company: ["Company", "Set up for your work", "Company locations"],
  estimating: ["How you take off board", "Default markup", "Phase codes", "Employer burden"],
  quickbooks: ["QuickBooks Online"],
  licences: ["Contractor licences", "Insurance policies", "Bonding"],
  appearance: ["Appearance"],
};

async function render(params: Record<string, string>) {
  search = new URLSearchParams(params);
  pathname = "/settings";
  const { default: Page } = await import("@/app/(app)/settings/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

const h2s = (html: string) => [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1].trim());
const tabParams = (tab: string): Record<string, string> => (tab === "company" ? {} : { tab });

describe("/settings tabs", () => {
  it("renders each group's sections and nothing from another group", async () => {
    for (const [tab, headings] of Object.entries(EXPECTED)) {
      expect(h2s(await render(tabParams(tab))), `?tab=${tab}`).toEqual(headings);
    }
  });

  it("puts every section the page had in exactly one tab", async () => {
    const all = Object.values(EXPECTED).flat();
    // The twelve H2 sections of the untabbed page (the audit's "15" also
    // counted the link paragraphs and banners, which were never sections).
    expect(all.length).toBe(12);
    const seen = new Map<string, number>();
    for (const tab of Object.keys(EXPECTED)) {
      for (const h of h2s(await render(tabParams(tab)))) seen.set(h, (seen.get(h) ?? 0) + 1);
    }
    for (const heading of all) expect(seen.get(heading), heading).toBe(1);
    expect([...seen.keys()].sort()).toEqual([...all].sort());
  });

  it("an unknown tab falls back to Company, and lights Company", async () => {
    const html = await render({ tab: "nope" });
    expect(h2s(html)).toEqual(EXPECTED.company);
    expect(html).toMatch(/<a(?=[^>]*href="\/settings")(?=[^>]*aria-current="page")/);
  });

  it("lights the tab whose group it shows", async () => {
    const html = await render({ tab: "licences" });
    expect(html).toMatch(/<a(?=[^>]*href="\/settings\?tab=licences")(?=[^>]*aria-current="page")/);
    const tabsNav = html.match(/<nav aria-label="Settings sections"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(tabsNav.match(/aria-current="page"/g)?.length).toBe(1);
  });

  it("the four child pages are one link row, not four paragraphs", async () => {
    const html = await render({});
    const nav = html.match(/<nav aria-label="More settings"[\s\S]*?<\/nav>/)?.[0] ?? "";
    for (const href of ["/settings/integrations", "/settings/assistant", "/settings/export", "/settings/import"]) {
      expect(nav).toContain(`href="${href}"`);
    }
    expect(html).not.toContain("connect and disconnect third-party services");
  });

  it("every /settings?tab=…#id link in the app lands on a render with that id", async () => {
    const web = resolve(new URL("../..", import.meta.url).pathname);
    const sources = ["lib/renewals.ts", "app/(app)/phase-codes/page.tsx", "app/(app)/settings/import/page.tsx"];
    const links = sources.flatMap((f) =>
      [...readFileSync(resolve(web, f), "utf8").matchAll(/"\/settings\?tab=(\w+)#([\w-]+)"/g)].map((m) => ({ tab: m[1], id: m[2], f })),
    );
    // renewals ×3, phase-codes ×2, import ×1. A pattern that stopped matching
    // would otherwise pass on nothing.
    expect(links.length).toBe(6);
    for (const { tab, id, f } of links) {
      expect(await render({ tab }), `${f}: ?tab=${tab}#${id}`).toContain(`id="${id}"`);
    }
  });

  it("the QuickBooks redirect's ?qb banner shows on the QuickBooks tab", async () => {
    const html = await render({ tab: "quickbooks", qb: "connected" });
    expect(html).toContain("QuickBooks connected successfully.");
    expect(h2s(html)).toEqual(EXPECTED.quickbooks);
  });
});

// ------------------------------------------------------- /union-compliance --

const UC_EXPECTED: Record<string, string[]> = {
  month: ["Fringe remittance", "Apprentice ratio"],
  apprenticeships: ["Apprenticeship programs", "Apprenticeship committees"],
  setup: ["Who works under each craft", "Locals, classifications and rates"],
};

async function renderUc(params: Record<string, string>) {
  search = new URLSearchParams(params);
  pathname = "/union-compliance";
  const { default: Page } = await import("@/app/(app)/union-compliance/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}
const ucParams = (tab: string): Record<string, string> => (tab === "month" ? {} : { tab });

describe("/union-compliance tabs", () => {
  it("renders each tab's sections and nothing from another tab", async () => {
    for (const [tab, headings] of Object.entries(UC_EXPECTED)) {
      expect(h2s(await renderUc(ucParams(tab))), `?tab=${tab}`).toEqual(headings);
    }
  });

  it("puts every section the page had in exactly one tab", async () => {
    const all = Object.values(UC_EXPECTED).flat();
    expect(all.length).toBe(6);
    const seen = new Map<string, number>();
    for (const tab of Object.keys(UC_EXPECTED)) {
      for (const h of h2s(await renderUc(ucParams(tab)))) seen.set(h, (seen.get(h) ?? 0) + 1);
    }
    for (const heading of all) expect(seen.get(heading), heading).toBe(1);
  });

  it("a ?month= visit stays on This month, and lights it", async () => {
    const html = await renderUc({ month: "2026-09" });
    expect(h2s(html)).toEqual(UC_EXPECTED.month);
    const tabsNav = html.match(/<nav aria-label="Fringe and apprentice sections"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(tabsNav).toMatch(/<a(?=[^>]*href="\/union-compliance")(?=[^>]*aria-current="page")/);
  });

  it("explains the DAS committee once, not twice, when none are recorded", async () => {
    const html = await renderUc({ tab: "apprenticeships" });
    expect(html).toContain("Apprenticeship committees");
    expect(html.match(/own list/g)?.length).toBe(1);
  });

  it("the Start here pointer names the Setup tab, and is not on Setup itself", async () => {
    expect(await renderUc({})).toContain('href="/union-compliance?tab=setup#setup"');
    const setup = await renderUc({ tab: "setup" });
    expect(setup).toContain('id="setup"');
    expect(setup).not.toContain('data-testid="uc-start-here"');
  });
});

describe("a union local card", () => {
  const local = (crafts: number) => ({
    unionLocalId: "ul-1",
    label: "IUPAT DC 16 · Local 9",
    parentInternational: "IUPAT",
    localNumber: "9",
    jurisdictionName: "CA",
    tradeJurisdiction: null,
    agreementId: "ag-1",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    ratio: null,
    crafts: Array.from({ length: crafts }, (_, i) => ({
      id: `c${i}`,
      name: `Taper ${i}`,
      tier: i === 0 ? null : ("JOURNEYMAN" as const),
      apprenticePeriod: null,
      unionLocalId: "ul-1",
      unionLocalLabel: "Local 9",
      schedules: [],
      usageCount: 0,
    })),
  });
  const card = async (crafts: number) => {
    const { UnionLocalCard } = await import("@/components/UnionLocalCard");
    const { createElement } = await import("react");
    return renderToStaticMarkup(createElement(UnionLocalCard, { local: local(crafts), today: "2026-10-13", canDelete: true }));
  };

  it("is one closed row carrying the name, the classification count and what is missing", async () => {
    const html = await card(2);
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*name="union-local"/);
    const summary = html.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
    expect(summary).toContain("IUPAT DC 16 · Local 9");
    expect(summary).toContain("2 classifications");
    expect(summary).toContain("1 not tiered");
    expect(summary).toContain("2 with no rate");
    // The rates and classifications are inside, not gone.
    expect(html).toContain("Taper 1");
  });

  it("opens when it has no classifications, since adding one is the only thing to do", async () => {
    expect(await card(0)).toMatch(/<details(?=[^>]*\sopen)[^>]*name="union-local"/);
  });
});

// ------------------------------------------------- /settings/integrations --

describe("/settings/integrations", () => {
  const load = async () => {
    search = new URLSearchParams();
    pathname = "/settings/integrations";
    const { default: Page } = await import("@/app/(app)/settings/integrations/page");
    return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  };

  it("is headed Integrations, never its raw path", async () => {
    const html = await load();
    expect(html).toMatch(/<h1[^>]*>Integrations<\/h1>/);
    expect(html.replace(/<[^>]*>/g, " ")).not.toContain("/settings/integrations");
  });

  it("says 'not set up on this install' once, above the list, not on every card", async () => {
    const html = await load();
    // Anti-vacuity: on this test install several providers have no keys.
    expect(html.match(/>Not set up</g)?.length ?? 0).toBeGreaterThan(1);
    expect(html.match(/not set up on this\s+install/gi)?.length).toBe(1);
    expect(html.indexOf('data-testid="integrations-not-set-up"')).toBeLessThan(html.indexOf('data-tour="integrations-list"'));
  });

  it("keeps each provider's description, behind its card's own expand", async () => {
    const html = await load();
    const details = html.match(/<details[^>]*>\s*<summary[^>]*>What it does<\/summary>/g) ?? [];
    expect(details.length).toBeGreaterThan(3);
    expect(html).toContain("One direction only");
  });
});
