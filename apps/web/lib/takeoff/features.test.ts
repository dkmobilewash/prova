import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEEDS_AI_ON, NEEDS_MODEL_KEY, statusText, takeoffFeatureRows, wallTypesStatus } from "./features";

const base = { roomFinderOn: false, demotedWallsOn: false, ai: { aiEnabled: true, planTextReadOptedIn: true }, anthropicConfigured: true };

describe("the takeoff features list", () => {
  it("lists every switch, each with where it lives and one plain sentence", () => {
    const rows = takeoffFeatureRows(base);
    expect(rows.map((r) => r.key)).toEqual(["wallTypesFromDrawings", "roomsAndCeilings", "greyOut", "wholeSet", "doorsWindows", "symbolCount", "planCompare", "autoPost", "scannedPlans"]);
    for (const row of rows) {
      expect(row.explain.length).toBeGreaterThan(40);
      expect(row.where.href.startsWith("/settings")).toBe(true);
      expect(row.where.label.startsWith("Settings → ")).toBe(true);
    }
  });

  it("wall types from the drawings is off until ticked; ticked, it is on only when AI is on and the server has a key, and otherwise names exactly what is missing", () => {
    expect(wallTypesStatus(base)).toEqual({ kind: "on" });
    expect(wallTypesStatus({ ...base, ai: { aiEnabled: false, planTextReadOptedIn: false } })).toEqual({ kind: "off" });
    // Unticked is Off even with AI on: the tick IS the switch.
    expect(wallTypesStatus({ ...base, ai: { aiEnabled: true, planTextReadOptedIn: false } })).toEqual({ kind: "off" });
    expect(wallTypesStatus({ ...base, ai: { aiEnabled: false, planTextReadOptedIn: true } })).toEqual({ kind: "needs", needs: [NEEDS_AI_ON] });
    expect(wallTypesStatus({ ...base, anthropicConfigured: false })).toEqual({ kind: "needs", needs: [NEEDS_MODEL_KEY] });
    expect(wallTypesStatus({ ...base, ai: { aiEnabled: false, planTextReadOptedIn: true }, anthropicConfigured: false })).toEqual({
      kind: "needs",
      needs: [NEEDS_AI_ON, NEEDS_MODEL_KEY],
    });
  });

  it("the plain switches read on or off, and a switch this build does not have says so rather than reading as off", () => {
    const rows = takeoffFeatureRows({ ...base, roomFinderOn: true, demotedWallsOn: false });
    const by = Object.fromEntries(rows.map((r) => [r.key, r.status]));
    expect(by.roomsAndCeilings).toEqual({ kind: "on" });
    expect(by.greyOut).toEqual({ kind: "off" });
    expect(by.wholeSet).toEqual({ kind: "not-yet" });
    expect(by.scannedPlans).toEqual({ kind: "not-yet" });
    expect(takeoffFeatureRows({ ...base, wholeSetTakeoffOn: true }).find((r) => r.key === "wholeSet")?.status).toEqual({ kind: "on" });
  });

  it("says the status in words a person can act on", () => {
    expect(statusText({ kind: "on" })).toBe("On");
    expect(statusText({ kind: "needs", needs: [NEEDS_AI_ON] })).toMatch(/one thing needed/);
    expect(statusText({ kind: "needs", needs: [NEEDS_AI_ON, NEEDS_MODEL_KEY] })).toMatch(/2 things needed/);
    expect(statusText({ kind: "not-yet" })).toBe("Not on this build yet");
  });
});

describe("each feature's settings link", () => {
  // The links are anchors on the settings page's estimating tab. An anchor with no
  // element sent "Find walls on every floor plan" to the top of the page it was on
  // (Chrome round 5), so every one must name an id the estimating tab renders.
  const page = readFileSync(join(process.cwd(), "app/(app)/settings/page.tsx"), "utf8");
  const estimating = page.slice(page.indexOf('tab === "estimating"'));
  const rows = takeoffFeatureRows({ roomFinderOn: true, demotedWallsOn: true, ai: { aiEnabled: true, planTextReadOptedIn: true }, anthropicConfigured: true, wholeSetTakeoffOn: true, scannedPlansOn: true, doorsWindowsOn: true, symbolCountOn: true });
  const onSettings = rows.filter((r) => r.where.href.startsWith("/settings?tab=estimating#"));
  it("covers the switches on the estimating tab", () => {
    expect(onSettings.map((r) => r.key).sort()).toEqual(["autoPost", "doorsWindows", "greyOut", "planCompare", "roomsAndCeilings", "scannedPlans", "symbolCount", "wholeSet"]);
  });
  for (const row of onSettings) {
    const id = row.where.href.split("#")[1]!;
    it(`${row.key} lands on #${id}`, () => {
      expect(estimating, `no element with id="${id}" on the estimating tab`).toContain(`id="${id}"`);
    });
  }
});
