import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /pipeline said "1 past the deadline and never sent" twice, one under the
 * other: a red badge beside "Waiting on us" and the standing line under it.
 * It is said once now — the line, which names the bid — and that line is
 * the red one. Rendered from the real page with its loaders faked.
 */

const context = { company: { id: "co-1", name: "Test Drywall" }, id: "u-1", name: "Tester", email: null, role: "OWNER", jobFunction: null };
const record = {
  invited: 2, bid: 1, declined: 0, won: 0, lost: 0, outstanding: 2, overdue: 1,
  winRate: null, valueWon: 0, valueWonUnpriced: 0,
};
const live = [
  { id: "b-1", projectName: "Oak Ave addition", contactId: "c-1", contactName: "Northside Builders", status: "INVITED", dueDate: "2026-09-01" },
  { id: "b-2", projectName: "Elm St TI", contactId: "c-1", contactName: "Northside Builders", status: "SUBMITTED", dueDate: "2026-09-20" },
];

vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed: true, context })) }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: vi.fn(async () => "2026-09-12") }));
vi.mock("@/lib/bid-pipeline-query", () => ({
  loadBidPipeline: vi.fn(async () => ({ rows: [{ contactId: "c-1", contactName: "Northside Builders", record }], live })),
  loadBidLog: vi.fn(async () => (await import("@/lib/bid-pipeline")).summariseBidLog([], "2026-09-12")),
}));
vi.mock("@/lib/bid-pursuits-query", () => ({
  loadBidPursuits: vi.fn(async () => []),
  loadLinkableInvitations: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/pipeline", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe("/pipeline with a bid past its deadline and never sent", () => {
  it("says it once, on the red standing line that names the bid", async () => {
    const { default: Page } = await import("@/app/(app)/pipeline/page");
    const html = renderToStaticMarkup(await Page());
    expect(html, "the real page rendered").toContain("Waiting on us");
    expect(html.split("past the deadline and never sent").length - 1).toBe(1);
    const missed = html.match(/<li data-pipeline-missed=""[^>]*>([\s\S]*?)<\/li>/);
    expect(missed?.[0], "the missed line is the rose one").toContain("bg-tag-rose");
    expect(missed?.[1]).toContain("1 past the deadline and never sent: Oak Ave addition");
  });
});
