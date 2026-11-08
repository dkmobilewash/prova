import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Plan comparison sets walls aside, so where it runs is pinned: only behind the
// company switch, only on a paired sheet, in both places detection runs.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("plan comparison runs only where it was switched on and paired", () => {
  it("the server path reads the company's switch before it compares", () => {
    const server = read("./detectWallsForCalibration.ts");
    expect(server).toMatch(/select: \{ planCompareOn: true \}[\s\S]{0,120}if \(company\?\.planCompareOn === true\)/);
    expect(server).toMatch(/pairings\.byPage\.get\(target\.pageNumber\)/);
    expect(server).toMatch(/if \(prior\.lines !== null\) offered = offer\(\{ lines: prior\.lines/);
  });

  it("the workspace sends no pairings to a company with it off", () => {
    const load = read("./workspaceLoad.ts");
    expect(load).toMatch(/const planCompare = roomFinder\?\.planCompareOn\s*\?[\s\S]{0,160}: null;/);
  });

  it("the viewer compares only with the pairing the load sent, and shows what it did", () => {
    const viewer = read("../../components/TakeoffPlanViewer.tsx");
    expect(viewer).toMatch(/const pairing = offered !== null && raster === undefined \? planCompare\?\.pairs\[pageNumber\] : undefined;/);
    expect(viewer).toMatch(/offered = offerHere\(\{ lines: lines\.lines, sheet \}\)/);
    expect(viewer).toMatch(/<PriorPlanBar status=\{priorStatus\}/);
  });

  it("the switch is off by default in the schema", () => {
    const schema = readFileSync(new URL("../../../../packages/db/prisma/schema/company.prisma", import.meta.url), "utf8");
    expect(schema).toMatch(/planCompareOn\s+Boolean\s+@default\(false\)/);
    // ON for a NEW company, set where the company is created; the column stays false so no
    // existing company changes and no migration runs (Diego, 2026-11-08).
    const auth = read("../auth.ts");
    expect(auth).toMatch(/company: \{[\s\S]{0,1200}create: \{ name: companyName, planCompareOn: true,/);
  });
});
