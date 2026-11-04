// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REVIEWER_KEY, isTypingTarget, startReview, type Candidate } from "@/lib/takeoff/answerKeyReview";
import { AnswerKeyPanel } from "./AnswerKeyPanel";

/**
 * Round 10: Chrome labelled 2 of 14 sheets because this panel was slow to use.
 * These pin the parts of the fix that live in the panel; the click on the
 * drawing is in the local takeoff spec, because happy-dom does no layout.
 */
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  window.localStorage.clear();
});

const cand = (id: string, y: number): Candidate => ({ id, x1: 0.1, y1: y, x2: 0.3, y2: y, lengthFeet: 20, thicknessIn: 6, from: "pair", note: "" });

function paint(extra: Partial<Parameters<typeof AnswerKeyPanel>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onState = vi.fn(), onFocus = vi.fn();
  const props = {
    state: startReview([cand("w0", 0.1), cand("w1", 0.2)]),
    onState,
    focusedId: null,
    onFocus,
    overlaysOn: true,
    onOverlays: () => {},
    sheet: { set: "S", page: 1, number: "A1", feetPerUnit: 100 },
    pairings: [],
    ...extra,
  };
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(AnswerKeyPanel, props)));
  return { host, onState, onFocus, root, props };
}
const q = (host: Element, hook: string) => host.querySelector(`[data-takeoff="${hook}"]`);

describe("the answer-key panel, round 10", () => {
  it("says what Save needs instead of a silently grey button, and the sentence focuses the box", () => {
    const { host } = paint();
    expect((q(host, "key-save-labels") as HTMLButtonElement).disabled).toBe(true);
    expect(q(host, "key-need-reviewer")?.textContent).toBe("Fill in Reviewed by to save");
    act(() => (q(host, "key-need-reviewer") as HTMLButtonElement).click());
    expect(document.activeElement).toBe(q(host, "key-reviewer"));
  });

  it("remembers Reviewed by in this browser and fills it on the next sheet", () => {
    const first = paint();
    const box = q(first.host, "key-reviewer") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, "Diego");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(window.localStorage.getItem(REVIEWER_KEY)).toBe("Diego");
    act(() => first.root.unmount());
    const second = paint();
    expect((q(second.host, "key-reviewer") as HTMLInputElement).value).toBe("Diego");
    expect(q(second.host, "key-need-reviewer")).toBeNull();
    expect((q(second.host, "key-save-labels") as HTMLButtonElement).disabled).toBe(false);
  });

  it("puts a waiting draft beside Save, with Restore and Discard, and leaves Save usable", () => {
    window.localStorage.setItem(REVIEWER_KEY, "Diego");
    const onRestore = vi.fn(), onDiscardDraft = vi.fn();
    const { host } = paint({ restoreOffer: "Restore 11 decisions", onRestore, onDiscardDraft });
    const labels = q(host, "key-labels")!;
    expect(labels.querySelector('[data-takeoff="key-restore"]')?.textContent).toContain("unsaved review in this browser");
    act(() => (labels.querySelector('[data-takeoff="key-restore-yes"]') as HTMLButtonElement).click());
    act(() => (labels.querySelector('[data-takeoff="key-restore-no"]') as HTMLButtonElement).click());
    expect(onRestore).toHaveBeenCalled();
    expect(onDiscardDraft).toHaveBeenCalled();
    expect((q(host, "key-save-labels") as HTMLButtonElement).disabled).toBe(false);
  });

  it("says how many decisions a save wrote", async () => {
    window.localStorage.setItem(REVIEWER_KEY, "Diego");
    const state = { ...startReview([cand("w0", 0.1), cand("w1", 0.2)]) };
    state.verdicts = { w0: "wall", w1: "not-a-wall" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, path: "labels/S/A1.json" })));
    const { host } = paint({ state, pairings: [{ x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.1, lengthFeet: 20, thicknessFeet: 0.5, features: [1] }] });
    await act(async () => { (q(host, "key-save-labels") as HTMLButtonElement).click(); });
    expect(q(host, "key-labels-saved")?.textContent).toBe("Saved 2 decisions to labels/S/A1.json");
    fetchMock.mockRestore();
  });

  it("A with nothing selected decides the first undecided candidate", () => {
    const { onState } = paint();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); });
    expect(onState).toHaveBeenCalled();
    expect(onState.mock.calls[0]![0].verdicts.w0).toBe("wall");
  });

  it("counts only text entry as typing, so a focused checkbox or button lets A/R/U through", () => {
    const el = (tagName: string, type?: string) => ({ tagName, type, isContentEditable: false }) as unknown as EventTarget;
    expect(isTypingTarget(el("INPUT", "text"))).toBe(true);
    expect(isTypingTarget(el("INPUT"))).toBe(true);
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("INPUT", "checkbox"))).toBe(false);
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
    expect(isTypingTarget(el("SELECT"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("says NEW walls only, and that NIC is not a wall", () => {
    const { host } = paint();
    act(() => (q(host, "key-help-toggle") as HTMLButtonElement).click());
    expect(host.textContent).toContain("Only NEW walls are walls.");
    expect(host.textContent).not.toContain("NIC counts");
  });
});
