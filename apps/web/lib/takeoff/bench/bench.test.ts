import { describe, expect, it } from "vitest";
import { sheetStrokes } from "../sheetStrokes";
import { allSheets, buildKey, primsForCase, VARIANTS } from "./cases";
import { appSchedule, handCalcAppRules, keyRuns } from "./harness";
import { holdoutPlan, HOLDOUT_SEEDS } from "./holdout";
import { L1, centrelineLength } from "./model";
import { writePdf } from "./writers";

/**
 * THE BENCH'S OWN FLOOR, on every PR. The accuracy run itself is an eval
 * (`takeoffBench.eval.ts`) because it reports rather than gates; these are the
 * things that must stay true for its numbers to mean anything.
 */

const clean = VARIANTS.find((v) => v.id === "clean")!;
const a101 = () => allSheets().find((s) => s.id === "A-101")!;

describe("takeoff bench", () => {
  it("builds the answer key from the model, not the PDF", () => {
    const key = buildKey(a101(), clean);
    const ids = new Set(key.walls.map((w) => w.id));
    for (const w of L1.walls) expect(ids.has(w.id), w.id).toBe(true);
    const keyCl = key.walls.filter((w) => w.bid && w.inScope).reduce((s, w) => s + w.clFt, 0);
    const modelCl = L1.walls.filter((w) => w.type !== "CMU" && w.type !== "SF").reduce((s, w) => s + centrelineLength(w), 0);
    expect(keyCl).toBeCloseTo(modelCl, 6);
  });

  it("draws every wall face where the key says it is (registration)", async () => {
    const sheet = a101();
    const key = buildKey(sheet, clean);
    const strokes = await sheetStrokes(writePdf(sheet, primsForCase(sheet, clean), {}), 1);
    expect(strokes.segments.length).toBeGreaterThan(0);
    // S-EX40: a plain A2 partition. Both faces must come back 2-7/16" either side
    // of the key's centreline, in display space.
    const k = key.walls.find((w) => w.id === "S-EX40")!;
    const x = k.display!.x1 * key.displayWidthPt;
    const halfPt = ((k.thicknessIn / 24) / k.trueFeetPerUnit) * key.displayWidthPt;
    for (const side of [-1, 1]) {
      const hit = strokes.segments.some((s) => Math.abs(s.x1 - (x + side * halfPt)) < 0.05 && Math.abs(s.x2 - s.x1) < 0.01 && Math.abs(s.y2 - s.y1) > 50);
      expect(hit, `face at ${side}`).toBe(true);
    }
  });

  it("generates the same holdout every time", () => {
    for (const seed of HOLDOUT_SEEDS.slice(0, 3)) expect(JSON.stringify(holdoutPlan(seed))).toBe(JSON.stringify(holdoutPlan(seed)));
  });

  it("agrees with the app's own recipe math (scheduleLines) to the unit", () => {
    const walls = buildKey(a101(), clean).walls;
    const hand = handCalcAppRules(walls);
    const app = appSchedule(keyRuns(walls));
    expect(Object.keys(hand).length).toBeGreaterThan(0);
    for (const [type, q] of Object.entries(hand)) {
      expect(app[type].studs, `${type} studs`).toBe(q.studs);
      expect(app[type].trackLf, `${type} track`).toBeCloseTo(q.trackLf, 1);
      expect(app[type].boardSf, `${type} board`).toBeCloseTo(q.boardSf, 1);
      expect(app[type].insulationSf, `${type} insulation`).toBeCloseTo(q.insulationSf, 1);
    }
  });
});
