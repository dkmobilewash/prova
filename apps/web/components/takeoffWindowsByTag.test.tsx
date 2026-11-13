// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TakeoffDoorsPanel } from "./TakeoffDoorsPanel";
import type { DoorsWindowsResult } from "@/lib/takeoff/doorsWindows";

// Windows stop being "to check" exactly when the sheet's tags were read.
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));
const frame = { kind: "window" as const, x1: 0, y1: 0, x2: 0.04, y2: 0, widthFeet: 4, wall: 0, lines: 3 };
const base: DoorsWindowsResult = { doors: [], windows: [frame, frame], join: null, unplacedMarks: [], tagged: { counted: false, vocabulary: null, windows: [], byTag: [] }, doorMarks: [], existingDoors: [] };
const paint = (result: DoorsWindowsResult) => act(() => root.render(createElement(TakeoffDoorsPanel, { result, groupOfWall: () => null, hovered: null, onHover: () => {} })));

describe("the doors panel's windows", () => {
  it("are counted by tag and type when the tags were read, with what the count rests on", () => {
    const row = { mark: "W1", widthFt: 4, heightFt: 2, description: null };
    paint({
      ...base,
      tagged: {
        counted: true,
        vocabulary: "schedule",
        windows: [{ tag: "W1", x: 0, y: 0, row, frame: 0 }, { tag: "W1", x: 0.1, y: 0, row, frame: null }, { tag: "W5", x: 0.2, y: 0, row: null, frame: 1 }],
        byTag: [{ tag: "W1", count: 2, row }, { tag: "W5", count: 1, row: null }],
      },
    });
    expect(host.querySelector('[data-takeoff="windows-by-tag"]')?.textContent).toBe("3 windows by tag");
    const types = host.querySelector('[data-takeoff="windows-by-type"]')?.textContent ?? "";
    expect(types).toContain("W1 ×2 (4.0 × 2.0 ft)");
    expect(types).toContain("W5 not in the schedule read");
    expect(types).toContain("1 with no frame drawn by the tag");
    expect(host.textContent).not.toContain("to check");
  });

  it("stay to check when no tag could be read", () => {
    paint(base);
    expect(host.textContent).toContain("2 windows to check");
    expect(host.querySelector('[data-takeoff="windows-by-tag"]')).toBeNull();
  });
});
