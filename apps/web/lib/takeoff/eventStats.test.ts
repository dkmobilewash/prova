import { describe, expect, it } from "vitest";
import { jobAutomation, type StatEvent } from "./eventStats";
import { groupTarget } from "./eventTarget";

const at = (min: number) => new Date(Date.UTC(2026, 10, 11, 12, min));
const ev = (kind: string, min: number, target: string | null = null, batch: string | null = null): StatEvent => ({ kind, target, batch, createdAt: at(min) });

describe("one job's automation from its events", () => {
  it("counts a person's presses, an Accept all press once, and not the rule's or the send", () => {
    const s = jobAutomation(
      [ev("ACCEPT", 1, "a"), ev("PICK", 1, "a"), ev("HEIGHT_EDIT", 1, "a"), ev("ACCEPT_ALL", 2, "b", "p1"), ev("ACCEPT_ALL", 2, "c", "p1"), ev("SKIP", 3, "d"), ev("AUTO_POST", 0, "e"), ev("SEND", 9)],
      at(0),
    );
    expect(s).toEqual({ touches: 5, autoPosted: 1, accepted: 3, changedAfterAccept: 0, minutesToSend: 9 });
  });

  it("a group undone or retyped after it was taken is changed once; a change before any accept is not", () => {
    const s = jobAutomation([ev("CHANGE", 1, "x"), ev("ACCEPT", 2, "x"), ev("AUTO_POST", 0, "y"), ev("UNDO", 3, "x"), ev("ACCEPT", 4, "x"), ev("CHANGE", 5, "x"), ev("CHANGE", 6, "y"), ev("ACCEPT", 7, "z")], null);
    expect(s.changedAfterAccept).toBe(2);
    expect(s.minutesToSend).toBeNull();
  });

  it("the target is the same for the same group read a hair off or drawn backwards, and different for another sheet", () => {
    const runs = [{ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2 }, { x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.6 }];
    const again = [{ x1: 0.50001, y1: 0.6, x2: 0.5, y2: 0.2 }, { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2 }];
    expect(groupTarget("p", 1, runs)).toBe(groupTarget("p", 1, again));
    expect(groupTarget("p", 2, runs)).not.toBe(groupTarget("p", 1, runs));
    expect(groupTarget("p", 1, runs)).toMatch(/^[0-9a-f]{16}$/);
  });
});
