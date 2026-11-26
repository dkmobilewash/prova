import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enlargedPlanReason, excludedSheetReason } from "./heldOutSets";

/**
 * Diego's enlarged-plans ruling (BOARD.md 2026-11-19): a wall is priced ONCE,
 * from the main floor plan. Sheets in ENLARGED_PLAN_SHEETS price no wall LF in
 * the eval while their doors, windows, types and heights still count.
 */
describe("enlargedPlanReason", () => {
  it("names the confirmed enlarged-plan sheets", () => {
    for (const [set, sheet] of [
      ["Joplin-community-center", "A-111"],
      ["Camp_Bow_Wow_-_100_CD_ARCH_2_1_", "A103"],
      ["Camp_Bow_Wow_-_100_CD_ARCH_2_1_", "A104"],
      ["Camp_Bow_Wow_-_100_CD_ARCH_2_1_", "A120"],
    ] as const) {
      expect(enlargedPlanReason(set, sheet), `${set}/${sheet}`).toMatch(/BOARD\.md 2026-11-19/);
    }
  });

  it("matches the label-dir spelling of each set (names drift through sanitising)", () => {
    expect(enlargedPlanReason("Joplin-community-center.pdf", "A-111")).not.toBeNull();
    expect(enlargedPlanReason("Camp Bow Wow - 100% CD_ARCH (2) (1).pdf", "A103")).not.toBeNull();
  });

  it("keeps area plans out: an area plan IS a main plan", () => {
    // These pages carry the word ENLARGED and are the set's pricing plans.
    expect(enlargedPlanReason("2204.Mid-City_Combined_Set_-CDs-_Bid_Package_-_08-28-25", "A4.0")).toBeNull();
    expect(enlargedPlanReason("15-025_-_K-4_Addendum_2", "A3.10")).toBeNull();
    // A main plan whose notes say "SEE ENLARGED PLANS" is not an enlarged plan.
    expect(enlargedPlanReason("SW-Grand-Junction-CO", "A110")).toBeNull();
  });

  it("fires for FS5 A-313 under the file's real spelling (Round-44 scope-reclass)", () => {
    expect(enlargedPlanReason("2020-0614 FS5 Fire Station No. 5 Renovation - Addendum 4A - Plan Drawings.pdf", "A-313")).toContain("CONNECTOR");
    expect(excludedSheetReason("2020-0614 FS5 Fire Station No. 5 Renovation - Addendum 4A - Plan Drawings.pdf", "A-313")).toBeNull();
  });

  it("is disjoint from EXCLUDED_SHEETS — this list zeroes walls, that one drops the sheet", () => {
    for (const [set, sheet] of [
      ["Joplin-community-center", "A-111"],
      ["Camp_Bow_Wow_-_100_CD_ARCH_2_1_", "A103"],
    ] as const) {
      expect(excludedSheetReason(set, sheet)).toBeNull();
    }
  });

  it("gates the eval's wall terms (wiring census, comment-stripped)", () => {
    const src = readFileSync(join(__dirname, "realplan/zzZeroTouch.eval.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(src).toMatch(/const wallTest = wallTestFromLabels\(saved\) && enlargedWhy === null && !codePlan;/);
    expect((src.match(/enlargedPlanReason\s*\(/g) ?? []).length, "the eval never calls enlargedPlanReason").toBeGreaterThanOrEqual(1);
  });
});
