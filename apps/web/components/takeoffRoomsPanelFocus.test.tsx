// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions", () => ({ saveRoomMeasurements: vi.fn() }));
const { TakeoffRoomsPanel } = await import("./TakeoffRoomsPanel");

describe("the rooms panel after Find the rooms", () => {
  it("brings itself into view, and again for a new result", () => {
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const result = () => ({ rooms: [], unplacedTags: [], mergedTags: [], grid: { width: 1, height: 1, feetPerCell: 1 } });
    const props = { jobId: "j", pageId: "p", feetPerUnit: 100, hovered: null, onHover: () => {}, onClear: () => {} };
    act(() => root.render(createElement(TakeoffRoomsPanel, { ...props, result: result() } as never)));
    expect(host.querySelector('[data-takeoff="rooms-panel"]')).not.toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
    act(() => root.render(createElement(TakeoffRoomsPanel, { ...props, result: result() } as never)));
    expect(scroll).toHaveBeenCalledTimes(2);
    HTMLElement.prototype.scrollIntoView = original;
  });
});
