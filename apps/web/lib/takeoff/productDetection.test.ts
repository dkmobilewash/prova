import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ── TRAINING ROWS ARE THE PRODUCT'S CANDIDATES (METHOD v2 feature parity, permanent) ──
 *
 * On 2026-11-13 every one of 3,636 candidates compared on three training sheets had a different
 * feature vector in the product than in the rows the wall model was trained on: training ran
 * `findWallsOnSheet` on the whole sheet, the product `detectForSheet` per plan view. Both now go
 * through `productDetection.ts`, and `zzFeatureParity.eval.ts` reads 0 differences on real sheets.
 * Real sheets are not in CI, so this pins the wiring that makes the eval's answer true: neither
 * side may call a finder directly again. Comments are stripped, so a quoted call cannot satisfy it.
 */
const read = (f: string) => readFileSync(`${process.cwd()}/lib/takeoff/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const SIDES = [
  { file: "detectWallsForCalibration.ts", side: "the product" },
  { file: "realplan/zzTrainRows.eval.ts", side: "the training rows" },
];

describe("training and the product detect through one builder", () => {
  it.each(SIDES)("$side ($file) calls productDetection and its template read", ({ file }) => {
    const src = read(file);
    expect(src).toMatch(/\bproductDetection\(/);
    expect(src).toMatch(/\bsampledSheetsFor\(/);
  });
  it.each(SIDES)("$side ($file) never calls a finder directly", ({ file }) => {
    const src = read(file);
    expect(src).not.toMatch(/\bfindWallsOnSheet\(/);
    expect(src).not.toMatch(/\bdetectForSheet\(/);
  });
  it("the training rows read a new company's sheet: no types, no legend, the real template", () => {
    expect(read("realplan/zzTrainRows.eval.ts")).toMatch(/wallTypes: \[\], legendCodes: null, scanned: false, sampledSheets\b/);
  });
});
