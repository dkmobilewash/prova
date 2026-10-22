// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LegendProposalView } from "@/lib/plan-ingest/legendProposalsQuery";
import type { LegendHeightResult } from "@/lib/takeoff/legendHeights";

/**
 * The half `action-capability-guards.test.ts` cannot see: that the Add button
 * is HIDDEN from whoever `addWallTypeFromLegend` would refuse. The page
 * computes `canAdd` as can(context, "MANAGE_ESTIMATING") and the component
 * renders the button only then; an accountant who may open the takeoff tab
 * must not meet a button that refuses them. "In your library" is derived
 * from the codes the page loaded, so a type already there offers no button
 * either, and says so.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions", () => ({ addWallTypeFromLegend: vi.fn(), readLegendBySight: vi.fn() }));
// No PDF in a test: the crop reports it could not open the drawing and the
// readings stand, which is the component's own path for a missing file.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.reject(new Error("no drawing in a unit test")) }),
}));

const { WallLegendReview, shortFlag } = await import("./WallLegendReview");

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

const type = (code: string, flags: { why: string; phrase: string }[] = []): LegendProposalView["types"][number] => ({
  code,
  name: null,
  lines: ['3 5/8" METAL STUDS AT 16" O.C.'],
  assembly: {
    components: [{ description: "3 5/8in metal stud", unit: "EA", basis: "STUDS", factor: 1, wastePercent: 0, roundUp: true, from: { phrase: "", where: "" } }],
    flags,
    read: { studWidthIn: 3.625, studSpacingIn: 16, studGauge: null, boardThicknessIn: 0.625, layersPerSide: 1, boardIsTypeX: true, insulation: null, hourlyRating: null },
  },
  from: "text",
  disagreements: [],
});

const proposal = (): LegendProposalView => ({
  id: "lp_1",
  planId: "plan_1",
  pageNumber: 25,
  sheetTitle: "WALL TYPES",
  sheetNumber: "A601",
  types: [type("P1"), type("P2", [{ why: "one-sided: the words name board on one face only", phrase: "ONE SIDE" }])],
  crops: [{ code: "P1", x: 0, y: 0, width: 100, height: 100 }],
  reason: "a legend titled WALL TYPES",
  confidence: "HIGH",
  hasSight: false,
  heightNotes: {},
  status: "PROPOSED",
});

function render(canAdd: boolean, libraryCodes: string[] = [], heights?: Record<string, Record<string, LegendHeightResult>>) {
  host.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(WallLegendReview, {
        jobId: "job_1",
        proposals: [proposal()],
        plans: [{ id: "plan_1", label: "Bid set" }],
        libraryCodes,
        heights,
        canAdd,
      }),
    );
  });
  return host;
}

describe("the wall legend review screen", () => {
  it("SHOWS EACH TYPE'S HEIGHT AND CONFIDENCE BEFORE ADD, in the row, with the general-note grade spelled out", () => {
    const out = render(true, [], {
      lp_1: {
        P1: { heightFt: 15, confidence: "LOW", generalNoteOnly: true, sentence: "Height 15 ft (LOW — general note only, check the sheet): …" },
        P2: { heightFt: null, confidence: null, generalNoteOnly: false, sentence: "No height read: to the deck, and no deck elevation was found." },
      },
    });
    const p1 = out.querySelector('[data-legend="type"][data-legend-code="P1"] [data-legend="height"]');
    expect(p1?.textContent).toBe("15 ft · LOW — general note only, check the sheet");
    expect(p1?.getAttribute("data-legend-height-confidence")).toBe("LOW");
    const p2 = out.querySelector('[data-legend="type"][data-legend-code="P2"] [data-legend="height"]');
    expect(p2?.textContent).toBe("no height read");
    expect(p2?.getAttribute("title")).toMatch(/^No height read: /);
    // No heights handed in: no line, rather than a line that says nothing.
    expect(render(true).querySelector('[data-legend="height"]')).toBeNull();
  });

  it("offers Add on every type for someone who may write the library", () => {
    const out = render(true);
    expect(out.querySelectorAll('[data-legend="type"]')).toHaveLength(2);
    expect(out.querySelectorAll('[data-legend="add"]')).toHaveLength(2);
    expect(out.querySelector('[data-legend="flags"]')?.textContent).toContain("one-sided");
  });

  it("HIDES Add from someone who may not, and still shows the readings and the flags", () => {
    const out = render(false);
    expect(out.querySelectorAll('[data-legend="type"]')).toHaveLength(2);
    expect(out.querySelectorAll('[data-legend="add"]')).toHaveLength(0);
    expect(out.textContent).toContain("P1");
    expect(out.querySelector('[data-legend="flags"]')?.textContent).toContain("one-sided");
  });

  it("says 'in your library' instead of offering Add for a code the company already has — by the code, not stored", () => {
    const out = render(true, ["p1"]);
    expect(out.querySelectorAll('[data-legend="in-library"]')).toHaveLength(1);
    expect(out.querySelectorAll('[data-legend="add"]')).toHaveLength(1);
    expect(out.querySelector('[data-legend="type"][data-legend-code="P1"] [data-legend="add"]')).toBeNull();
  });

  it("keeps each flag to one short line, with the whole reason and the words behind a click", () => {
    expect(shortFlag("the 6\" stud was decoded from the sheet's tag key, not printed beside the type — check the key")).toBe(
      "the 6\" stud was decoded from the sheet's tag key, not printed beside the type",
    );
    expect(shortFlag("the words say studSpacingIn 48 and the drawing shows 16 — the drawing was kept; check it")).toBe(
      "the words say studSpacingIn 48 and the drawing shows 16",
    );
    expect(shortFlag("x".repeat(120)).length).toBeLessThanOrEqual(96);
    const out = render(true);
    const flag = out.querySelector('[data-legend="flags"] summary');
    expect(flag?.textContent).toBe("one-sided: the words name board on one face only");
    expect(out.querySelector('[data-legend="flags"] details p')?.textContent).toContain("ONE SIDE");
  });

  it("gives every numeric field a decimal keypad and a name", () => {
    const out = render(true);
    const numeric = out.querySelectorAll('input[inputmode="decimal"]');
    expect(numeric.length).toBe(2 * 6);
    for (const input of numeric) expect(input.getAttribute("name")).not.toBe("");
  });
});
