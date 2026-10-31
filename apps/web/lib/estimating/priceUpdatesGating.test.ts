import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The price-update controls render only for people the actions would not refuse.
 * The actions assert MANAGE_ESTIMATING (on top of the estimate tab's
 * VIEW_JOB_COSTS); a button shown to someone it then refuses is a dead button.
 * A source check, comments stripped, because the failure it guards is a prop
 * quietly dropped from the page.
 */
const read = (p: string) =>
  readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("price-update controls are gated like their actions", () => {
  const page = read("app/(app)/jobs/[id]/(tabs)/estimate/page.tsx");

  it("derives the flag from MANAGE_ESTIMATING", () => {
    expect(page).toMatch(/canManageEstimating = capabilitiesFor\(principal\).has\("MANAGE_ESTIMATING"\)/);
  });
  // The sections live in components/job/EstimateStage.tsx (shared with C Stream
  // Bid); the CRM page hands them the flag it derived, and Bid's pages — which
  // already refuse anyone without MANAGE_ESTIMATING — pass it as true.
  const stage = read("components/job/EstimateStage.tsx");
  it("hands the flag to both sections", () => {
    expect(page).toMatch(/<EstimateRecap data=\{d\} canManageEstimating=\{canManageEstimating\}/);
    expect(page).toMatch(/<EstimateWallSchedule data=\{d\} canManageEstimating=\{canManageEstimating\}/);
  });
  it("renders the panel only behind the flag", () => {
    expect(stage).toMatch(/canManageEstimating && <UpdatePricesPanel/);
  });
  it("passes the flag to the wall schedule, which renders Restore only behind it", () => {
    expect(stage).toMatch(/canRestore=\{canManageEstimating\}/);
    expect(read("components/WallSchedule.tsx")).toMatch(/canRestore && \(\s*<button[\s\S]*?Restore deleted lines/);
  });
});
