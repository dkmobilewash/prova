// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TakeoffRevisionPanel } from "./TakeoffRevisionPanel";

// Every root is unmounted after its test, so nothing React scheduled outlives the
// test environment (#936: "window is not defined" in the scheduler after teardown).
const roots: Root[] = [];
const mount = (host: Element) => { const root = createRoot(host); roots.push(root); return root; };
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

const seg = { x1: 0, y1: 0, x2: 0.1, y2: 0 };
const paint = (result: Parameters<typeof TakeoffRevisionPanel>[0]["state"]["result"], extra: Partial<Parameters<typeof TakeoffRevisionPanel>[0]> = {}) => {
  const host = document.createElement("div");
  document.body.append(host);
  const props = { state: { earlier: "bid set.pdf", busy: false, error: null, result }, onFindWalls: vi.fn(), findDisabled: false, onClear: vi.fn(), ...extra };
  act(() => mount(host).render(createElement(TakeoffRevisionPanel, props)));
  return { host, props };
};

describe("the revision panel", () => {
  it("counts what changed, in words beside the colours, and lists the items it touches", () => {
    const { host } = paint({ earlier: "bid set.pdf", added: [seg, seg], removed: [seg], truncated: false, agreement: 0.98, changedItems: [{ name: "A walls", changed: 1, total: 2 }] });
    expect(host.textContent).toContain("2 added");
    expect(host.textContent).toContain("1 removed");
    expect(host.querySelector('[data-takeoff="revision-items"]')?.textContent).toContain("A walls: 1 of 2 measurements");
  });
  it("offers Find the walls, and Find the rooms once there are walls", () => {
    const onFindRooms = vi.fn();
    const { host, props } = paint({ earlier: "x", added: [], removed: [], truncated: false, agreement: 1, changedItems: [] }, { onFindRooms, roomsDisabled: true });
    act(() => (host.querySelector('[data-takeoff="revision-find-walls"]') as HTMLButtonElement).click());
    expect(props.onFindWalls).toHaveBeenCalled();
    expect((host.querySelector('[data-takeoff="revision-find-rooms"]') as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).toContain("No line work changed.");
  });
  it("says a re-drawn sheet was re-drawn rather than drawing it all", () => {
    const { host } = paint({ earlier: "x", added: [], removed: [], truncated: true, agreement: 0.27, changedItems: [] });
    expect(host.querySelector('[data-takeoff="revision-redrawn"]')?.textContent).toContain("27%");
  });
});
