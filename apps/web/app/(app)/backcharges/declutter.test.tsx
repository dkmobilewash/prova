import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /backcharges after declutter round 3 (density audit #29: four tiles, a
 * disclaimer paragraph, and every backcharge an expanded card). The page
 * half is read from source; the row half is a real render.
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
const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

describe("/backcharges declutter", () => {
  it("says the totals in one StatusLine and the disclaimer as a hint, not tiles and a paragraph", () => {
    expect(page).not.toContain("sm:grid-cols-4");
    expect(page).toMatch(/<StatusLine\s+report=\{backchargesStatus\(/);
    expect(page).toMatch(/<HintedText\s+label="A record, not a deduction"/);
  });

  it("each backcharge is one line (number · job · amount · status · deadline) that opens into the card", () => {
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
    expect(html).toMatch(/<li id="cbc123"[^>]*><details name="backcharge"/);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    for (const fact of ["BC 4", "Oak Ave", "$450.00", "object by 2026-10-20"]) expect(summary).toContain(fact);
    // Description and actions are the detail, not the line.
    expect(summary).not.toContain("Debris left at L2");
    expect(summary).not.toContain("Object");
    expect(html.indexOf("Debris left at L2")).toBeGreaterThan(html.indexOf("</summary>"));
    expect(html.indexOf(">Object</button>")).toBeGreaterThan(html.indexOf("</summary>"));
  });
});
