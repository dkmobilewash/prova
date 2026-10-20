import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /field-reports after the declutter pass (density audit #8: up to 400
 * reports, every one fully expanded, on one scroll). Rendered from the real
 * page against a stub database that honours `take`, so a page that stops
 * capping its query — or caps it and forgets the way to the rest — fails.
 */

const JOBS = [
  { id: "job-1", name: "Riverside Medical", status: "IN_PROGRESS", contact: { name: "Turner" } },
  { id: "job-2", name: "Lakeshore Retail", status: "ESTIMATE", contact: { name: "Mortenson" } },
];
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
// Ten reports, newest first, on Riverside; the 9th carries a delay.
const REPORTS = Array.from({ length: 10 }, (_, i) => ({
  id: `r-${10 - i}`,
  reportDate: new Date(`${day(10 - i)}T00:00:00.000Z`),
  crewPresent: null,
  workPerformed: `Work on day ${10 - i}`,
  weather: null,
  delays: 10 - i === 9 ? "Inspector late" : null,
  job: { id: "job-1", name: "Riverside Medical" },
  filedBy: { name: "Dana", email: "dana@example.com" },
}));
// Two people, 8h each, on Oct 10.
const ENTRIES = ["crew-a", "crew-b"].map((crewMemberId) => ({
  jobId: "job-1",
  date: new Date(`${day(10)}T00:00:00.000Z`),
  hours: 8,
  employeeUserId: null,
  crewMemberId,
  craftClassification: null,
}));

const prismaStub = new Proxy(
  {},
  {
    get: (_t, model: string) =>
      new Proxy(
        {},
        {
          get: (_target, method: string) =>
            vi.fn(async (args?: { take?: number }) => {
              if (model === "job" && method === "findMany") return JOBS;
              if (model === "dailyFieldReport" && method === "findMany") return REPORTS.slice(0, args?.take);
              if (model === "dailyFieldReport" && method === "count") return REPORTS.length;
              if (model === "timeEntry" && method === "findMany") return ENTRIES;
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
  usePathname: () => "/field-reports",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const render = async (searchParams: Record<string, string>) => {
  const { default: Page } = await import("@/app/(app)/field-reports/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
};
const rows = (html: string) => html.match(/<details/g)?.length ?? 0;

describe("/field-reports, decluttered", () => {
  it("shows the latest 7 reports and the way to the rest", async () => {
    const html = await render({});
    expect(rows(html)).toBe(7);
    expect(html).toContain("Showing the latest 7 of 10 reports.");
    expect(html).toContain('href="/field-reports?all=1"');
    expect(html).not.toContain("Work on day 3");
  });

  it("?all=1 shows every report, and keeps a job filter in its links", async () => {
    expect(rows(await render({ all: "1" }))).toBe(10);
    expect(await render({ job: "job-1" })).toContain('href="/field-reports?job=job-1&amp;all=1"');
  });

  it("each report is a closed one-line row whose summary carries the facts", async () => {
    const html = await render({});
    const details = [...html.matchAll(/<details[^>]*>([\s\S]*?)<\/details>/g)];
    for (const [whole] of details) expect(whole).not.toMatch(/^<details[^>]* open/);
    const summary = (n: number) => details[n]![1]!.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)![1]!;
    // Oct 10: date · job · 2 crew · 16h · filed by.
    expect(summary(0)).toContain("Riverside Medical");
    expect(summary(0)).toContain("2 crew · 16h");
    expect(summary(0)).toContain("filed by Dana");
    expect(summary(0)).not.toContain("Work on day 10");
    // Oct 9 carries the delay flag; Oct 10 does not.
    expect(summary(1)).toContain(">Delay<");
    expect(summary(0)).not.toContain(">Delay<");
    // One open at a time.
    expect(html.match(/<details name="field-report"/g)?.length).toBe(7);
  });

  it("filter chips say the job's name only, with the full label in the title", async () => {
    const html = await render({});
    expect(html).toMatch(/<a[^>]*title="Lakeshore Retail[^"]+"[^>]*>Lakeshore Retail<\/a>/);
  });
});
