// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ createWallType: vi.fn(async () => ({ ok: true })) }));

const { PlanTextPanel } = await import("./PlanTextPanel");

/**
 * A RENDER test: the panel is the whole of what a customer sees from plan-text
 * reading, so what matters is that each of its three sentences appears with
 * the right numbers, and that nothing appears when there is nothing to say.
 */
describe("the plan-text panel", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const view = {
    sheet: {
      planId: "p",
      pageNumber: 13,
      calibrationId: "c",
      legend: { page: 25, codes: ["S6A", "C8B"] },
      doors: {
        schedulePage: 26,
        placed: [{ mark: "111B", widthFt: 3, widthFrom: "schedule" as const, placedBy: "opening" as const, x: 0.2, y: 0.3, description: null }],
        unplaced: ["100A", "100B", "101"],
        rowsTotal: 4,
      },
      typed: { taggedFeet: 245, propagatedFeet: 14, noteFeet: 0, untypedFeet: 248 },
    },
    legend: {
      page: 25,
      title: "WALL TYPES",
      codes: ["S6A", "C8B"],
      proposals: [
        {
          code: "S6A",
          name: null,
          lines: ['6" METAL STUDS AT 24" O.C.'],
          assembly: {
            components: [{ description: "6in metal stud, 25 ga at 24in o.c." }],
            flags: [],
            read: { studWidthIn: 6, studSpacingIn: 24, studGauge: 25, boardThicknessIn: null, layersPerSide: null, boardIsTypeX: false, insulation: null, hourlyRating: null },
          },
        },
        {
          code: "C8B",
          name: null,
          lines: [],
          assembly: {
            components: [],
            flags: [{ why: "the layer count contradicts itself (1, 2)", phrase: "1 LAYER / 2 LAYERS" }],
            read: { studWidthIn: null, studSpacingIn: null, studGauge: null, boardThicknessIn: null, layersPerSide: null, boardIsTypeX: false, insulation: null, hourlyRating: null },
          },
        },
      ],
      reason: "",
      confidence: "MEDIUM" as const,
    },
  };

  it("says where the typed feet came from, the doors placed and not placed, and the legend's types", () => {
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      root.render(createElement(PlanTextPanel, { view: view as any, wallTypes: [{ code: "C8B" }] }));
    });
    const text = host.textContent ?? "";
    expect(text).toContain("tagged on the drawing 245 ft");
    expect(text).toContain("same wall as a tag 14 ft");
    expect(text).toContain("untyped 248 ft");
    expect(text).toContain(`111B 3'-0"`);
    expect(text).toContain("Scheduled, not found on this sheet: 100A, 100B, 101");
    expect(text).toContain("The drawings define 2 wall types");
    expect(text).toContain("6in metal stud, 25 ga at 24in o.c.");
    expect(text).toContain("the layer count contradicts itself");
    // C8B is already in the library: no Add button for it, one for S6A.
    expect(host.querySelectorAll("button").length).toBe(1);
    expect(text).toContain("in your wall types");
    // Never a price.
    expect(text).not.toMatch(/\$/);
  });

  it("renders nothing when the switch is off or nothing was read", () => {
    act(() => {
      root.render(createElement(PlanTextPanel, { view: null, wallTypes: [] }));
    });
    expect(host.textContent).toBe("");
    act(() => {
      root.render(createElement(PlanTextPanel, { view: { sheet: null, legend: null }, wallTypes: [] }));
    });
    expect(host.textContent).toBe("");
  });
});
