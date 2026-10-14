import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /closeout as a list (declutter, 2026-10-13): "What to do next" is the list,
 * one closed row per job that opens into the full card, jobs not under way
 * behind "Show all jobs", and each job's blockers said ONCE — they were said
 * three times per job (the next-steps line, the card's chip, the package
 * panel's "Holding it up").
 *
 * Rendered from the real page with the closeout read faked, so a row that
 * does not render cannot pass for one that does.
 */

vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({
    allowed: true,
    context: {
      company: { id: "co-1", name: "Test Drywall" },
      id: "user-1",
      name: "Tester",
      email: null,
      role: "OWNER",
      jobFunction: null,
    },
  })),
}));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: vi.fn(async () => "2026-10-13") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The card and panel hand these to forms; nothing here submits one.
// (Not a Proxy: a module whose `then` is a function is awaited forever.)
vi.mock("@/lib/actions", () => ({
  addCloseoutItem: vi.fn(),
  addStandardCloseoutChecklist: vi.fn(),
  deleteCloseoutItem: vi.fn(),
  deleteServiceRequest: vi.fn(),
  deleteWarrantyPeriod: vi.fn(),
  recordServiceRequest: vi.fn(),
  setWarrantyPeriod: vi.fn(),
  updateCloseoutItem: vi.fn(),
  updateServiceRequest: vi.fn(),
  submitCloseoutPackage: vi.fn(),
  reopenCloseoutSubmission: vi.fn(),
  recordCloseoutResponse: vi.fn(),
  deleteCloseoutSubmission: vi.fn(),
}));

const base = { clientName: "Example GC", items: [], warranty: null, requests: [], submissions: [], openPunchItems: 0 };
const RIVERSIDE = {
  ...base,
  id: "job-r",
  name: "Riverside Medical",
  status: "IN_PROGRESS",
  retainageBalance: 5_000,
  readiness: { stage: "NOT_READY", blockers: [{ kind: "REQUIRED_ITEMS", count: 2 }], retainageAtStake: 5_000, daysWithGc: null },
};
const LAKESHORE = {
  ...base,
  id: "job-l",
  name: "Lakeshore Retail",
  status: "ESTIMATE",
  retainageBalance: 0,
  readiness: { stage: "NOT_READY", blockers: [{ kind: "NO_CHECKLIST", count: 0 }], retainageAtStake: 0, daysWithGc: null },
};
vi.mock("@/lib/closeout-query", () => ({ loadCloseoutJobs: vi.fn(async () => [LAKESHORE, RIVERSIDE]) }));

const { default: CloseoutPage } = await import("@/app/(app)/closeout/page");

async function render(all?: string) {
  return renderToStaticMarkup(await CloseoutPage({ searchParams: Promise.resolve(all ? { all } : {}) }));
}

describe("/closeout", () => {
  it("lists a job under way as one closed row that opens into its card", async () => {
    const html = await render();
    expect(html, "the real page rendered").toContain("What to do next");
    const row = html.match(/<li data-closeout-job="job-r">[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(row).toMatch(/<details name="closeout-job"/);
    expect(row, "closed by default").not.toMatch(/<details[^>]* open/);
    expect(row).toContain("Riverside Medical");
    expect(row).toContain("$5,000.00 held");
    // The full card is inside the row, one click away.
    expect(row).toContain('data-tour="closeout-checklist"');
  });

  it("keeps a job not yet in progress behind Show all jobs", async () => {
    const html = await render();
    expect(html).not.toContain("Lakeshore Retail");
    expect(html).toMatch(/href="\/closeout\?all=1"[^>]*>Show all jobs \(1 more is not under way yet\)</);

    const all = await render("1");
    expect(all).toContain("Lakeshore Retail");
    expect(all).toMatch(/href="\/closeout"[^>]*>Show only jobs under way</);
  });

  it("says a job's blockers once, on its row", async () => {
    const html = await render();
    expect(html.split("2 required documents outstanding").length - 1).toBe(1);
    expect(html).not.toContain("Holding it up");
    expect(html).not.toContain("documents still outstanding");
  });
});
