import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The new-customer walk stopped on two of eight real sets at the scale step, with the app offering
// the one press a person makes both times: "Use 1/8" (from 18 dimensions)" on the plan set, and
// "Use the printed scale on all 6 sheets" in the review queue, whose per-sheet buttons sit in a
// closed list. Pressing a closed list's button waited forever (no action timeout).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const walk = read("../local/new-customer-walk.local.spec.ts");

describe("the walk answers every one-press scale fix the app offers", () => {
  it.each([
    ["../../components/PlanSetScales.tsx", "plan-set-snap", /Use \{shortScaleName/],
    ["../../components/TakeoffReviewQueue.tsx", "review-queue-scale-all", /Use the printed scale on all/],
  ])("%s's %s is pressed", (file, hook, label) => {
    const src = read(file);
    expect(src).toContain(`data-takeoff="${hook}"`);
    expect(src).toMatch(label);
    if (hook === "plan-set-snap") expect(walk).toMatch(/getByRole\("button", \{ name: \/\^Use \/ \}\)/);
    else expect(walk).toContain(`[data-takeoff="${hook}"]`);
  });

  it("bounds every click, so a control that never becomes pressable fails the step instead of the run", () => {
    expect(walk).toMatch(/test\.use\(\{ actionTimeout: \d+/);
  });
});
