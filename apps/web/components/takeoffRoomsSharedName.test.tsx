// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions", () => ({ saveRoomMeasurements: vi.fn() }));
const { TakeoffRoomsPanel } = await import("./TakeoffRoomsPanel");

describe("a region holding several rooms", () => {
  it("names them in its row instead of leaving it blank", () => {
    const room = { id: 1, squareFeet: 900, perimeterFeet: 120, xs: [0, 1, 1, 0], ys: [0, 0, 1, 1], tag: null, sharedTags: [{ name: "HALL", number: "109" }, { name: "OFFICE", number: "110" }] };
    const host = document.createElement("div");
    document.body.append(host);
    const result = { rooms: [room], unplacedTags: [], mergedTags: [], grid: { width: 1, height: 1, feetPerCell: 1 } };
    act(() => createRoot(host).render(createElement(TakeoffRoomsPanel, { jobId: "j", pageId: "p", feetPerUnit: 100, hovered: null, onHover: () => {}, onClear: () => {}, result } as never)));
    const values = [...host.querySelectorAll('[data-takeoff="room-row"] input')].map((i) => (i as HTMLInputElement).value);
    expect(values).toContain("HALL + OFFICE");
    expect(values).toContain("109, 110");
  });
});
