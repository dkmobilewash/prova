import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WIP_SCHEDULE_COLUMNS } from "@/lib/wip-schedule";

/**
 * /wip after declutter round 3 (density audit #35: earned and over/under,
 * the point of the schedule, were off-screen to the right of a 19-column
 * table). The default view is the eight key columns; `?detail=1` is the
 * whole table exactly as before. A real render against a mocked query.
 */

vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({
    allowed: true,
    context: { id: "u1", role: "OWNER", jobFunction: null, company: { id: "c1" } },
  })),
}));
vi.mock("@/components/PageAlerts", () => ({ PageAlerts: () => null }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: vi.fn(async () => "Oct 14, 2026") }));
vi.mock("@/lib/wip-schedule-query", () => ({
  loadWipSchedule: vi.fn(async () => {
    const row = Object.fromEntries(WIP_SCHEDULE_COLUMNS.map((c) => [c.key, 1234]));
    return [
      { ...row, job: "Riverside", customer: "Acme GC", status: "IN_PROGRESS" },
      { ...row, job: "TOTAL", customer: "", status: "" },
    ];
  }),
}));

const { default: WipSchedulePage } = await import("./page");

async function render(detail?: string) {
  return renderToStaticMarkup(await WipSchedulePage({ searchParams: Promise.resolve(detail ? { detail } : {}) }));
}
const headings = (html: string) => (html.match(/<th /g) ?? []).length;

describe("/wip declutter", () => {
  it("shows the eight key columns by default, with short headings and the full one as a hint", async () => {
    const html = await render();
    expect(headings(html)).toBe(8);
    for (const label of ["Contract", "% complete", "Earned", "Billed", "Overbilled", "Underbilled"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(html).not.toContain("Cost to date");
    // The definitions are hints on the headings now, not a paragraph block.
    expect(html).toContain("Billed ahead of the work earned");
    expect(html).not.toContain("<dl");
    expect(html).toContain('href="/wip?detail=1"');
    expect(html).toContain("Show the cost breakdown (11 more columns)");
  });

  it("?detail=1 is the whole table as before", async () => {
    const html = await render("1");
    expect(headings(html)).toBe(WIP_SCHEDULE_COLUMNS.length);
    expect(html).toContain("Cost to date");
    expect(html).toContain('href="/wip"');
  });

  it("wears the shared PageHeader: Home / Money / Work in progress, one-line subtitle", async () => {
    const html = await render();
    const crumb = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(crumb).toContain(">Home</a>");
    expect(crumb).toContain('href="/areas/money"');
    expect(crumb).toContain(">Money</a>");
    expect(crumb).toContain('aria-current="page"');
    expect(crumb).toContain(">Work in progress</span>");
    expect(html).toMatch(/<h1[^>]*>Work in progress<\/h1>/);
  });

  it("says what the dash means in ONE sentence — no \"— is not zero. Not zero —\"", async () => {
    const html = await render();
    const line = html.match(/<p[^>]*data-tour="wip-coverage"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    const text = line.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim();
    expect(text).toMatch(/^A — means the figure cannot be worked out yet, not that it is zero/);
    expect(text).not.toMatch(/Not zero/i);
    expect(text.match(/\./g) ?? []).toHaveLength(1);
  });
});
