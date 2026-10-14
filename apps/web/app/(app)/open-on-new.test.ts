import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * `?new=1` lands on the add form already OPEN. It is what the home quick
 * tiles and the ⌘K create verbs link to (UX review 2026-10-11: every field
 * create took 3-4 taps — area, list, "Raise an RFI", then the form).
 *
 * Rendered from the real page against an empty-but-one-job database, so a
 * page that reads the param and never hands it to the form fails here.
 */

const JOB = { id: "job-1", name: "Oak Ave Medical", status: "IN_PROGRESS", contact: { name: "Turner" } };

const prismaStub = new Proxy(
  {},
  {
    get: (_t, model: string) =>
      new Proxy(
        {},
        {
          get: (_target, method: string) =>
            vi.fn(async () => {
              if (model === "job" && method === "findMany") return [JOB];
              // A material order needs a vendor before its form will show.
              if (model === "vendor" && method === "findMany") return [{ id: "v-1", name: "ABC Supply" }];
              if (method === "count") return 0;
              if (method === "findUnique" || method === "findFirst") return null;
              return [];
            }),
        },
      ),
  },
);

const context = { company: { id: "company-1", name: "Test Drywall" }, id: "user-1", name: "Tester", email: null, role: "OWNER", jobFunction: null };

vi.mock("@prova/db", () => ({ prisma: prismaStub, Prisma: { Decimal: class {} } }));
vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed: true, context })) }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => context) }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: vi.fn(async () => "2026-10-11"), viewerTimeZone: vi.fn(async () => "UTC") }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/rfis",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const forms = (html: string) => html.match(/<form/g)?.length ?? 0;

describe.each([
  ["/rfis", () => import("@/app/(app)/rfis/page")],
  ["/field-reports", () => import("@/app/(app)/field-reports/page")],
  ["/submittals", () => import("@/app/(app)/submittals/page")],
  ["/material-orders", () => import("@/app/(app)/material-orders/page")],
  ["/backcharges", () => import("@/app/(app)/backcharges/page")],
  // Declutter (density audit #30): the walkthrough form waits behind its
  // button like every other add form, and ?new=1 still lands on it open.
  ["/punch-lists", () => import("@/app/(app)/punch-lists/page")],
])("%s", (_route, load) => {
  it("opens its add form on ?new=1, and only then", async () => {
    const { default: Page } = await load();
    const render = async (params: Record<string, string>) =>
      renderToStaticMarkup(await (Page as (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>)({ searchParams: Promise.resolve(params) }));
    const closed = await render({});
    const open = await render({ new: "1" });
    expect(forms(open)).toBe(forms(closed) + 1);
  });
});

describe("/punch-lists aside", () => {
  it("leads with the job filter, then the add form's button", async () => {
    const { default: Page } = await import("@/app/(app)/punch-lists/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    const filter = html.indexOf('data-tour="punch-job-filter"');
    expect(filter).toBeGreaterThan(-1);
    expect(filter).toBeLessThan(html.indexOf('data-tour="punch-add"'));
    expect(html).toMatch(/data-tour="punch-add"><button[^>]*>Add an item<\/button>/);
  });
});
