import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Job → Field reports: the delay log said "No delays logged" while report
 * rows under it carried a Delay tag. The tag also lights for a report's
 * free-text "Delays" note, which is not in the log — so an empty log has to
 * name those reports instead of contradicting them. Rendered from the real
 * tab page against a stub database, so the count has to reach the screen.
 */

const REPORTS = [1, 2, 3].map((n) => ({
  id: `r-${n}`,
  reportDate: new Date(`2026-10-0${n}T00:00:00.000Z`),
  crewPresent: null,
  workPerformed: `Work on day ${n}`,
  weather: null,
  weatherAuto: null,
  delays: n === 3 ? null : "Inspector late",
  filedBy: { name: "Dana" },
  _count: { media: 0 },
}));
let delayEvents: unknown[] = [];

const where = vi.fn();
const prismaStub = {
  job: {
    findUnique: vi.fn(async () => ({
      id: "job-1",
      siteAddress: null,
      siteLatitude: null,
      siteLongitude: null,
      siteTimeZone: null,
      dailyFieldReports: REPORTS,
      _count: { dailyFieldReports: REPORTS.length },
      delayEvents,
    })),
  },
  dailyFieldReport: {
    count: vi.fn(async (args: { where: unknown }) => {
      where(args.where);
      return REPORTS.filter((r) => r.delays).length;
    }),
  },
  timesheetSignoff: { findMany: vi.fn(async () => []) },
  timeEntry: { findMany: vi.fn(async () => []) },
};

vi.mock("@prova/db", () => ({ prisma: prismaStub, Prisma: { Decimal: class {} } }));
vi.mock("@/lib/jobs/job-access", () => ({
  requireJob: vi.fn(async () => ({ currentUser: { role: "OWNER" }, job: { id: "job-1", status: "IN_PROGRESS" } })),
}));
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: vi.fn(async () => "UTC"), viewerToday: vi.fn(async () => "2026-10-13") }));
vi.mock("next/navigation", () => ({ usePathname: () => "/jobs/job-1/field-reports", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const render = async () => {
  const { default: Page } = await import("@/app/(app)/jobs/[id]/(tabs)/field-reports/page");
  return renderToStaticMarkup(
    await Page({ params: Promise.resolve({ id: "job-1" }), searchParams: Promise.resolve({}) }),
  );
};

describe("Job → Field reports, delays", () => {
  it("does not say 'No delays logged' beside reports tagged Delay; it counts them", async () => {
    delayEvents = [];
    const html = await render();
    expect(html).not.toContain("No delays logged");
    expect(html).toContain("Nothing in the delay log yet — 2 field reports mention a delay in their notes");
    // Counted over every report on the job, not the window on screen.
    expect(where).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1" }));
  });
});
