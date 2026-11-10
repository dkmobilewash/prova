// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addOpening, openingsForSave, setOpeningTag, startReview, type Candidate } from "@/lib/takeoff/answerKeyReview";
import { labelFile } from "@/lib/takeoff/labelRows";
import { restoreSaved } from "@/lib/takeoff/restoreSaved";
import { AnswerKeyPanel } from "./AnswerKeyPanel";

// ROUND 17 (the door answer key): doors are marked like windows, one kind armed at a time,
// with the printed mark, and a marked door survives save and reopen.
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});
const cand = (id: string, y: number): Candidate => ({ id, x1: 0.1, y1: y, x2: 0.3, y2: y, lengthFeet: 20, thicknessIn: 6, from: "pair", note: "" });
const q = (host: Element, hook: string) => host.querySelector(`[data-takeoff="${hook}"]`);

describe("marking doors for the door answer key", () => {
  it("arms doors from their own button, counts each kind apart, and offers the schedule's marks", () => {
    let state = startReview([cand("w0", 0.1)]);
    state = addOpening(state, { x: 0.2, y: 0.2, kind: "window" });
    state = addOpening(state, { x: 0.4, y: 0.4, kind: "door" });
    const door = state.openings![1]!.id;
    const onMarking = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const props = { state, onState: vi.fn(), focusedId: null, onFocus: vi.fn(), overlaysOn: true, onOverlays: () => {}, sheet: { set: "S", page: 1, number: "A1", feetPerUnit: 100 }, pairings: [], onMarking, marking: true, markKind: "door" as const, focusedOpening: door, doorMarks: ["101", "102A"] };
    act(() => root.render(createElement(AnswerKeyPanel, props)));
    expect(q(host, "key-window-count")?.textContent).toBe("1 window marked");
    expect(q(host, "key-door-count")?.textContent).toBe("1 door marked");
    expect(q(host, "key-mark-doors")?.textContent).toBe("Marking doors — click each one");
    const picker = q(host, "key-window-tag");
    expect(picker?.getAttribute("data-kind")).toBe("door");
    expect([...host.querySelectorAll('[data-takeoff="key-window-tag-code"]')].map((b) => b.textContent)).toEqual(["101 (1)", "102A (2)"]);
    act(() => (q(host, "key-mark-windows") as HTMLButtonElement).click());
    expect(onMarking).toHaveBeenLastCalledWith(true, "window");
  });

  it("a door point and its mark round-trip through the saved file", () => {
    const fresh = startReview([cand("w0", 0.1)]);
    let state = addOpening(fresh, { x: 0.4, y: 0.4, kind: "door" });
    state = setOpeningTag(state, state.openings![0]!.id, "102a");
    const file = labelFile({ set: "S", sheet: "A1", page: 1, reviewedBy: "Chrome", secondsSpent: 1, feetPerUnit: 100, reviewComplete: true, candidates: [], verdicts: [], unreviewed: 0, openings: openingsForSave(state) });
    expect(file.openings).toEqual([{ x: 0.4, y: 0.4, kind: "door", tag: "102A" }]);
    const back = restoreSaved(file as never, fresh, 100);
    if (!back.ok) throw new Error(back.message);
    expect((back.state.openings ?? []).map((o) => ({ kind: o.kind, tag: o.tag }))).toEqual([{ kind: "door", tag: "102A" }]);
  });
});
