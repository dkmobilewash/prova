import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Plan comparison sets walls aside, so where it runs is pinned: only behind the
// company switch, only on a paired sheet, in both places detection runs.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("plan comparison runs only where it was switched on and paired", () => {
  it("the server path applies it only behind the company's switch; off, it only counts what it would set aside", () => {
    const server = read("./detectWallsForCalibration.ts");
    expect(server).toMatch(/select: \{ planCompareOn: true \}/);
    expect(server).toMatch(/pairings\.byPage\.get\(target\.pageNumber\)/);
    expect(server).toMatch(/const compared = offer\(\{ lines: prior\.lines/);
    // The ONE assignment of the compared runs, and it is behind the switch.
    expect(server.match(/offered = compared/g)).toHaveLength(1);
    expect(server).toMatch(/if \(company\?\.planCompareOn === true\) offered = compared;\s*else \{/);
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
  });
});
