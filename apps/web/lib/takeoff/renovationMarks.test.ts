// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TakeoffExclusionBar } from "@/components/TakeoffExclusionBar";
import { wallsSummaryRows } from "@/lib/plan-ingest/walls";
import { renovationMarks, RENOVATION_PROMPT, showsExistingWork } from "./renovationMarks";

describe("renovationMarks", () => {
  it("names what marks a sheet, and EXISTING needs three", () => {
    expect(renovationMarks("(E) OFFICE\nDEMOLITION PLAN")).toEqual(["(E)", "DEMO"]);
    expect(renovationMarks("EXISTING\nEXISTING")).toEqual([]);
    expect(renovationMarks("EXISTING WALL\nEXISTING DOOR\nEXISTING CEILING")).toEqual(["EXISTING"]);
    expect(renovationMarks("LIMIT OF WORK\nTENANT IMPROVEMENTS")).toEqual(["TENANT IMPROVEMENT", "LIMIT OF WORK"]);
  });
  it("NIC alone does not mark a sheet, and a plain new plan has no marks", () => {
    expect(showsExistingWork(renovationMarks("CASEWORK N.I.C."))).toBe(false);
    expect(showsExistingWork(renovationMarks("NEW WALL\nFIRST FLOOR PLAN\nDEMONSTRATION KITCHEN"))).toBe(false);
  });
});

describe("the renovation prompt", () => {
  it("shows with its two tools, and each picks its tool", () => {
    const onPickTool = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    act(() => createRoot(host).render(createElement(TakeoffExclusionBar, { feet: 700, aside: [], excludes: 0, workAreas: 0, readOnly: false, renovation: ["(E)"], onPickTool, onUndo: () => {}, onClear: () => {} })));
    expect(host.querySelector('[data-takeoff="renovation-prompt"]')?.textContent).toContain(RENOVATION_PROMPT);
    act(() => (host.querySelector('[data-takeoff="renovation-work-area"]') as HTMLButtonElement).click());
    act(() => (host.querySelector('[data-takeoff="renovation-exclude"]') as HTMLButtonElement).click());
    expect(onPickTool.mock.calls).toEqual([["workarea"], ["exclude"]]);
  });
  it("is not there without marks", () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => createRoot(host).render(createElement(TakeoffExclusionBar, { feet: 700, aside: [], excludes: 0, workAreas: 0, readOnly: false, renovation: null, onUndo: () => {}, onClear: () => {} })));
    expect(host.querySelector('[data-takeoff="renovation-prompt"]')).toBeNull();
  });
});

describe("the whole-set summary", () => {
  it("carries the marks of a sheet that shows existing work, and none for NIC alone", () => {
    const sheet = (pageNumber: number, renovation: string[]) => ({ pageNumber, sheetNumber: `A10${pageNumber}`, title: "FLOOR PLAN", hasScale: true, hasWalls: true, renovation });
    const rows = wallsSummaryRows({ sheets: [sheet(1, ["(E)", "DEMO"]), sheet(2, ["NIC"])], walls: new Map([[1, { groups: 1, feet: 10 }], [2, { groups: 1, feet: 10 }]]), tasks: new Map(), maxAttempts: 3 });
    expect(rows.map((r) => r.renovation ?? null)).toEqual([["(E)", "DEMO"], null]);
  });
});
