// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/actions", () => ({ addFinishLinesToEstimate: vi.fn() }));
const { TakeoffFinishPanel } = await import("./TakeoffFinishPanel");
const FPU = 100;
const room = { id: 1, squareFeet: 200, perimeterFeet: 60, xs: [0.1, 0.3, 0.3, 0.1], ys: [0.1, 0.1, 0.2, 0.2], tag: { name: "R", number: "101", areaSf: null, x: 0.2, y: 0.15 } };
const schedule = { byType: false, rows: [{ key: "101", name: "R", floor: "CPT-1", base: "RB-1", wall: "PT-1", sides: null, ceiling: "ACT-1" }, { key: "102", name: "S", floor: "CPT-1", base: "RB-1", wall: "PT-1", sides: null, ceiling: "ACT-1" }] };

async function panel(read: unknown) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(TakeoffFinishPanel, { jobId: "j", sheetName: "A101", rooms: [room], ceilings: new Map(), words: [], widthPt: 2592, feetPerUnit: FPU, doors: [], windows: [], onRead: async () => read } as never)));
  await act(async () => { (host.querySelector('[data-takeoff="read-finishes"]') as HTMLButtonElement).click(); });
  return host;
}

describe("the finish panel", () => {
  it("shows the join, what is missing, and a pressable add button", async () => {
    const host = await panel(schedule);
    expect(host.querySelector('[data-takeoff="finish-joined"]')?.textContent).toBe("1 of 1 rooms joined to the schedule");
    expect(host.textContent).toMatch(/1 scheduled rooms were not found on this sheet.*102/);
    expect(host.textContent).toMatch(/1 rooms have no height/);
    expect(host.textContent).toMatch(/North is taken as up the page/);
    expect(host.textContent).toMatch(/No doors were read/);
    const add = host.querySelector('[data-takeoff="add-finishes"]') as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    expect(add.textContent).toBe("Add 3 lines to the estimate");
  });
  it("says so when the set has no schedule", async () => {
    expect((await panel(null)).textContent).toMatch(/No room finish schedule was found/);
  });
});
