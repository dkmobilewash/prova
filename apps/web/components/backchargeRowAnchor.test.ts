import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Home's "Needs you today" links a backcharge near its objection deadline to
 * /backcharges#<id> (home-logic.ts backchargeNeeds). That link is only worth
 * having if the row carries the id — otherwise it lands at the top of a long
 * list and the person hunts for the number.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions", () => ({
  deleteBackcharge: vi.fn(),
  disputeBackcharge: vi.fn(),
  reopenBackcharge: vi.fn(),
  resolveBackcharge: vi.fn(),
  updateBackcharge: vi.fn(),
}));

const { BackchargeRow } = await import("@/components/BackchargeRow");

describe("a backcharge row", () => {
  it("carries its id, so /backcharges#<id> lands on it", () => {
    const html = renderToStaticMarkup(
      createElement(BackchargeRow, {
        backcharge: {
          id: "cbc123",
          number: 4,
          jobName: "Oak Ave",
          status: "RECEIVED",
          gcReference: null,
          category: "CLEANUP",
          description: "Debris left at L2",
          claimedAmount: "450",
          issuedOn: null,
          receivedOn: "2026-10-01",
          respondByDate: "2026-10-20",
          disputedOn: null,
          disputeReason: null,
          resolvedOn: null,
          resolvedAmount: null,
          resolutionNote: null,
          loggedByName: null,
        },
        today: "2026-10-12",
        canDelete: false,
        showJob: true,
      }),
    );
    expect(html).toContain("Debris left at L2");
    expect(html).toMatch(/<li id="cbc123"/);
  });
});
