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

vi.mock("@prova/db", () => ({ prisma: emptyPrisma, Prisma: { Decimal: class {} } }));
vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed: true, context })) }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => context) }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: vi.fn(async () => "2026-10-13"), viewerTimeZone: vi.fn(async () => "UTC") }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
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
