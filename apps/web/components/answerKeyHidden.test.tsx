// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REVIEWER_KEY, startReview, type Candidate } from "@/lib/takeoff/answerKeyReview";
import type { SavedVerdict } from "@/lib/takeoff/restoreSaved";
import { AnswerKeyPanel } from "./AnswerKeyPanel";

// Hidden decisions: kept from the file, scored, and until now never seen. Green Bay's wrong walls
// were exactly these. Each can be flipped or deleted, and Save writes the result, wall type kept.
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  window.localStorage.clear();
});
const cand = (id: string, y: number): Candidate => ({ id, x1: 0.1, y1: y, x2: 0.3, y2: y, lengthFeet: 20, thicknessIn: 6, from: "pair", note: "" });
const q = (host: Element, hook: string) => host.querySelector(`[data-takeoff="${hook}"]`);
const all = (host: Element, hook: string) => [...host.querySelectorAll(`[data-takeoff="${hook}"]`)];
const CARRIED: SavedVerdict[] = [
  { x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.6, lengthFeet: 77, thicknessFeet: 0.4, verdict: "wall", wallType: "IW-7" },
  { x1: 0.6, y1: 0.2, x2: 0.8, y2: 0.2, lengthFeet: 38, verdict: "not-a-wall" },
];

function paint(empty = false) {
  window.localStorage.setItem(REVIEWER_KEY, "Diego");
  const host = document.createElement("div");
  document.body.append(host);
  const seen: { carried: SavedVerdict[] } = { carried: CARRIED };
  function Harness() {
    const [carried, setCarried] = useState<SavedVerdict[]>(CARRIED);
    seen.carried = carried;
    return createElement(AnswerKeyPanel, {
      state: startReview(empty ? [] : [cand("w0", 0.1)]),
      onState: vi.fn(),
      focusedId: null,
      onFocus: vi.fn(),
      overlaysOn: true,
      onOverlays: () => {},
      sheet: { set: "S", page: 1, number: "A3.1", feetPerUnit: 100 },
      pairings: [],
      carried,
      onCarried: setCarried,
      sourceFinderVersion: "old",
    });
  }
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(Harness)));
  return { host, seen };
}

describe("hidden decisions in answer-key mode", () => {
  it("lists every hidden decision with its length, verdict and type", () => {
    const { host } = paint();
    expect(q(host, "key-hidden-count")?.textContent).toBe("Hidden decisions (2)");
    expect(all(host, "key-hidden-row").map((r) => r.querySelector("span")?.textContent)).toEqual(["77 ft · wall · IW-7", "38 ft · not-a-wall"]);
  });

  it("flips one and deletes another; Save writes exactly what is left, the wall type kept", async () => {
    const { host, seen } = paint(true);
    act(() => (all(host, "key-hidden-flip")[0] as HTMLButtonElement).click());
    expect(seen.carried[0]!.verdict).toBe("not-a-wall");
    act(() => (all(host, "key-hidden-delete")[1] as HTMLButtonElement).click());
    expect(q(host, "key-hidden-count")?.textContent).toBe("Hidden decisions (1)");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, path: "labels/S/A3.1.json" })));
    await act(async () => {
      (q(host, "key-save-labels") as HTMLButtonElement).click();
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.carried).toEqual([{ x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.6, lengthFeet: 77, thicknessFeet: 0.4, verdict: "not-a-wall", wallType: "IW-7", finderVersion: "old" }]);
    fetchMock.mockRestore();
  });

  it("shows nothing when there is nothing hidden", () => {
    window.localStorage.setItem(REVIEWER_KEY, "Diego");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(createElement(AnswerKeyPanel, { state: startReview([cand("w0", 0.1)]), onState: vi.fn(), focusedId: null, onFocus: vi.fn(), overlaysOn: true, onOverlays: () => {}, sheet: { set: "S", page: 1, number: "A1", feetPerUnit: 100 }, pairings: [] })));
    expect(q(host, "key-hidden-list")).toBeNull();
  });
});
