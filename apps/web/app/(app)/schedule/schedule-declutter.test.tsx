import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /schedule after the declutter pass (density audit #16, 2.43 screens): the
 * week grid was followed by the same days again as a list, the gap list
 * repeated one sentence per row, the calendar paragraph sat open, and both
 * job lists showed every job ever. Rendered from the real page.
 */

const TODAY = "2026-10-14";
const job = (n: number, startDate: string | null) => ({
  id: `job-${n}`,
  name: `Job ${n}`,
  status: "IN_PROGRESS",
  startDate: startDate ? new Date(`${startDate}T00:00:00Z`) : null,
  endDate: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  contact: { name: "GC" },
  assignments: [],
});
// Seven started jobs, oldest first (the query's order), one upcoming.
const SCHEDULED = [1, 2, 3, 4, 5, 6].map((n) => job(n, `2026-0${n}-01`)).concat(job(7, "2026-11-01"));
const UNSCHEDULED = [8, 9, 10, 11, 12, 13].map((n) => job(n, null));
const day = (id: string, workDate: string) => ({
  id,
  workDate: new Date(`${workDate}T00:00:00Z`),
  jobId: "job-7",
  job: { name: "Job 7" },
  note: null,
  craftClassification: null,
});

vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findMany: vi.fn(async ({ where }: { where: { startDate: unknown } }) =>
        where.startDate === null ? UNSCHEDULED : SCHEDULED,
      ),
    },
    user: { findMany: vi.fn(async () => [{ id: "u-1", name: "Ana Reyes", email: "a@x" }]) },
    crewMember: { findMany: vi.fn(async () => []) },
    craftClassification: { findMany: vi.fn(async () => []) },
    calendarFeedToken: { findUnique: vi.fn(async () => null) },
    crew: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: vi.fn(async () => ({ id: "u-1", role: "OWNER", company: { id: "co-1" } })),
}));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => TODAY }));
vi.mock("@/lib/crew-schedule-query", () => ({
  loadUpcomingSchedule: vi.fn(async () => [day("d-1", "2026-10-15"), day("d-2", "2026-10-16")]),
  loadScheduleBetween: vi.fn(async () => [day("d-1", "2026-10-15")]),
  loadPlannedDaysMissingHours: vi.fn(async () => [day("m-1", "2026-10-01"), day("m-2", "2026-10-02"), day("m-3", "2026-10-03")]),
  scheduledWorkerName: () => "Ana Reyes",
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/schedule", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => ({
  scheduleCrewDay: vi.fn(),
  unscheduleCrewDay: vi.fn(),
  moveCrewDay: vi.fn(),
  saveCrew: vi.fn(),
  renameCrew: vi.fn(),
  archiveCrew: vi.fn(),
  ensureCalendarFeedToken: vi.fn(),
  regenerateCalendarFeedToken: vi.fn(),
}));

const { default: SchedulePage } = await import("@/app/(app)/schedule/page");
const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await SchedulePage({ searchParams: Promise.resolve(sp) }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("/schedule", () => {
  it("shows the week grid at md and up and the list on a phone — never both open at one width", async () => {
    const html = await render();
    const desktop = html.slice(html.indexOf('<div class="hidden md:block">'), html.indexOf('<div class="md:hidden">'));
    const phone = html.slice(html.indexOf('<div class="md:hidden">'), html.indexOf('data-tour="schedule-missing-hours"'));
    // Desktop: the grid open, the list (with Move/Remove) behind a summary.
    expect(desktop).toMatch(/^<div class="hidden md:block"><section[^>]*aria-label="Week board"/);
    expect(desktop).toMatch(/<details[^>]*><summary[^>]*>Move or take someone off · 2 planned days in the next two weeks<\/summary>[\s\S]*Ana Reyes/);
    // ...and nothing of the list sits open above that summary.
    expect(desktop.slice(0, desktop.indexOf("<details"))).not.toContain(">Move</button>");
    // Phone: the list open, the grid (with its week links) behind a summary.
    expect(phone).toMatch(/^<div class="md:hidden"><h3[^>]*>Next two weeks<\/h3><ul/);
    expect(phone).toMatch(/<details[^>]*><summary[^>]*>Week board, by job<\/summary>[\s\S]*aria-label="Week board"/);
    expect(html).not.toContain("Next two weeks, as a list");
  });

  it("puts the gap list behind one count line and says its sentence once", async () => {
    const html = await render();
    expect(html).toMatch(/<summary[^>]*>3 planned days with no hours<\/summary>/);
    expect(count(html, "That is a gap in the paperwork")).toBe(1);
  });

  it("keeps the calendar link a button, with its paragraph behind a summary", async () => {
    const html = await render();
    const box = html.slice(html.indexOf('data-tour="schedule-subscribe"'), html.indexOf('data-tour="schedule-start-dates"'));
    expect(box).toContain("Create my calendar link</button>");
    expect(box).toMatch(/<details[^>]*><summary[^>]*>How the calendar link works<\/summary>[\s\S]*treat it like a key/);
    // Said once, and that once is the one inside the summary.
    expect(count(box, "treat it like a key")).toBe(1);
  });

  it("caps Job start dates and Unscheduled at 5, upcoming first, with See all", async () => {
    const html = await render();
    const starts = html.slice(html.indexOf('data-tour="schedule-start-dates"'), html.indexOf('data-tour="schedule-unscheduled"'));
    const unsched = html.slice(html.indexOf('data-tour="schedule-unscheduled"'));
    expect(count(starts, 'href="/jobs/job-')).toBe(5);
    // The upcoming job leads; the oldest two fall behind See all.
    expect(starts.indexOf(">Job 7<")).toBeGreaterThan(-1);
    expect(starts.indexOf(">Job 7<")).toBeLessThan(starts.indexOf(">Job 6<"));
    expect(starts).not.toContain(">Job 1<");
    expect(starts).toContain("See all 7");
    expect(count(unsched, 'href="/jobs/job-')).toBe(5);
    expect(unsched).toContain("See all 6");
  });

  it("shows every job on ?all=1, keeping the week", async () => {
    const html = await render({ all: "1", week: "2026-10-12" });
    const starts = html.slice(html.indexOf('data-tour="schedule-start-dates"'), html.indexOf('data-tour="schedule-unscheduled"'));
    expect(count(starts, 'href="/jobs/job-')).toBe(7);
    expect(starts).toContain('href="?week=2026-10-12"');
  });
});
