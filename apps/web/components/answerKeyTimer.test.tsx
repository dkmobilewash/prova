// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startReview } from "@/lib/takeoff/answerKeyReview";
import { AnswerKeyPanel } from "./AnswerKeyPanel";

// `IDLE_AFTER_SECONDS` (6 min) lives in a "use client" module, so the client-boundary census forbids importing it; the literal is the rule.
const IDLE_AFTER_SECONDS = 360;

// ROUND 22: the clock advanced only on a verdict, so a sheet spent tracing,
// splitting and marking doors read 2–3 minutes. Any input now counts; a break
// longer than IDLE_AFTER still does not.
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the review clock", () => {
  it("counts time between any inputs, not only between verdicts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const props = { state: startReview([]), onState: vi.fn(), focusedId: null, onFocus: vi.fn(), overlaysOn: true, onOverlays: () => {}, sheet: { set: "S", page: 1, number: "A1", feetPerUnit: 100 }, pairings: [] };
    act(() => root.render(createElement(AnswerKeyPanel, props)));
    const spent = () => [...host.querySelectorAll("span")].find((s) => / spent$/.test(s.textContent ?? ""))?.textContent;
    const input = (kind: "pointerdown" | "keydown" | "wheel", secondsLater: number) =>
      act(() => {
        vi.advanceTimersByTime(secondsLater * 1000);
        window.dispatchEvent(kind === "keydown" ? new KeyboardEvent(kind, { key: "Shift" }) : new Event(kind));
      });
    input("pointerdown", 0);
    input("wheel", 60);
    input("keydown", 60);
    expect(spent()).toBe("2m 00s spent");
    // A break: dropped whole.
    input("pointerdown", IDLE_AFTER_SECONDS + 1);
    expect(spent()).toBe("2m 00s spent");
  });
});
