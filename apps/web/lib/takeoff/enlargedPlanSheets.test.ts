import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demolitionOnlyReason, enlargedPlanReason, excludedSheetReason } from "./heldOutSets";

describe("Diego's scope correction of 2026-11-27 (prereg-scoreboard-v3 amendment 5)", () => {
  it("takes out the enlarged plans he named, under the real file spellings", () => {
    for (const sheet of ["A10", "A11", "A12"]) expect(enlargedPlanReason("3799_Drawings_MJB.pdf", sheet)).not.toBeNull();
    expect(enlargedPlanReason("9583_Exhibit_A_-_CCB_Remodel_-_DCR_104_108A_Bid_Plans.pdf", "A601S")).not.toBeNull();
    expect(enlargedPlanReason("24-1015_01_BCH_BID-SET-2026-09-15.pdf", "I-200")).not.toBeNull();
    expect(enlargedPlanReason("2022-02-28-NAPLES-AOB-CONSTRUCTION-DRAWINGS.pdf", "A461A")).not.toBeNull();
  });

  it("leaves the main plans of the same sets in", () => {
    expect(enlargedPlanReason("3799_Drawings_MJB.pdf", "A2")).toBeNull();
    expect(enlargedPlanReason("9583_Exhibit_A_-_CCB_Remodel_-_DCR_104_108A_Bid_Plans.pdf", "A201S")).toBeNull();
  });

  it("takes out a demolition-only sheet the product flags, and keeps a combined demo + new sheet", () => {
    expect(demolitionOnlyReason("x", "AD-101", true, "DEMOLITION FLOOR PLAN- LEVEL 1 & 2")).not.toBeNull();
    expect(demolitionOnlyReason("x", "A1.01", true, "DEMOLITION & PROPOSED FLOOR PLANS")).toBeNull();
    expect(demolitionOnlyReason("x", "A2", true, "DEMO AND NEW WORK PLAN")).toBeNull();
    expect(demolitionOnlyReason("x", "A101", false, "FLOOR PLAN")).toBeNull();
  });

  it("covers 9583 A102S, whose title the product reads as the project name", () => {
    expect(demolitionOnlyReason("9583_Exhibit_A_-_CCB_Remodel_-_DCR_104_108A_Bid_Plans.pdf", "A102S", false, "CCB REMODEL")).not.toBeNull();
  });
});

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
    expect(src).toMatch(/const wallTest = wallTestFromLabels\(saved\) && enlargedWhy === null && !codePlan && demoWhy === null;/);
    expect((src.match(/demolitionOnlyReason\s*\(/g) ?? []).length, "the eval never calls demolitionOnlyReason").toBeGreaterThanOrEqual(1);
    expect((src.match(/enlargedPlanReason\s*\(/g) ?? []).length, "the eval never calls enlargedPlanReason").toBeGreaterThanOrEqual(1);
  });
});
