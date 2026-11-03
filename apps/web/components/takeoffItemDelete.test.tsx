// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const del = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/actions", () => ({ deleteTakeoffItem: del, assignMeasurementsToItem: vi.fn(), createTakeoffItem: vi.fn(), duplicateTakeoffItem: vi.fn(), reorderTakeoffItems: vi.fn() }));
const { TakeoffItemsPanel } = await import("./TakeoffItemsPanel");

const item = { id: "i1", name: "R1 troffer", type: "COUNT" as const, colorHex: "#112233", lineStyle: "SOLID" as const, heightFt: null, sides: null, thicknessIn: null, wastePercent: null, spacingIn: null, depthIn: null, wallTypeId: null, sortOrder: 0,
  measurements: [{ id: "m1", pageNumber: 1, kind: "COUNT" as const, xs: [0.1, 0.2], ys: [0.1, 0.2], feetPerPageWidth: null }] };

function armAndConfirm(untick: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(createElement(TakeoffItemsPanel, { jobId: "j", items: [item], activeItemId: null, onPick: () => {}, currentPage: 1, hidden: new Set<string>(), onToggleHidden: () => {}, unassignedHere: [], unassignedCount: 0 })));
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
  act(() => button("Delete").click());
  const box = host.querySelector('[data-takeoff="delete-item-measurements"]') as HTMLInputElement;
  expect(box.checked).toBe(true);
  if (untick) act(() => box.click());
  act(() => button("Confirm delete").click());
  return host;
}

describe("deleting an item", () => {
  it("deletes its measurements too, by default", () => {
    armAndConfirm(false);
    expect(del).toHaveBeenLastCalledWith("j", "i1", true);
  });
  it("keeps them, in Unassigned, when unticked", () => {
    const host = armAndConfirm(true);
    expect(del).toHaveBeenLastCalledWith("j", "i1", false);
  });
});
