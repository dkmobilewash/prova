import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { inPageWidthUnits, type SheetTextItem } from "../findWallsOnSheet";
import { wallsNotIsolatedStubs } from "../isolatedStubs";
import {
  oneFacePerLine,
  wallFromPair,
  wallsFromStrokes,
  wallsInTheBuilding,
  wallsNotLettering,
  wallsNotTheSheetBorder,
} from "../wallVectors";
import type { StrokeSegment, WallCandidate } from "../wallVectors";

/**
 * TEMPORARY DIAGNOSTIC — which FILTER drops the walls that go missing.
 *
 * The first version of this probe asked a different question — "which long
 * strokes did nobody claim" — and its answers were an artefact of its own
 * design. It reported each stroke's NEAREST parallel, which for a heavy line
 * drawn as two coincident strokes is its own doubled edge a sixth of an inch
 * away. So it said "under the 2.4in floor" about almost everything, which is
 * true about the nearest neighbour and says nothing about whether the stroke
 * had a good partner six inches off.
 *
 * This asks the question that has an actionable answer instead: the pairer
 * returns candidates, a chain of filters removes some, and the walls that go
 * missing are removed by ONE of them. So run the chain stage by stage and
 * report what each stage took, biggest first.
 *
 * Reads in place, writes nothing, prints feet and thicknesses only.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const WANTED = (process.env.MISSED_SHEETS ?? "Camp Bow Wow:9,2025-03-28_ELEVEN03:119")
  .split(",")
  .map((part) => part.trim())
  .filter((part) => part.includes(":"))
  .map((part) => {
    const [key, page] = part.split(":");
    return { key: key.trim(), page: Number(page) };
  });

function feet(walls: readonly WallCandidate[]): number {
  return walls.reduce((n, w) => n + w.lengthFeet, 0);
}

/** What `before` had and `after` does not, biggest first. */
function taken(before: readonly WallCandidate[], after: readonly WallCandidate[]) {
  const kept = new Set(after);
  return before.filter((w) => !kept.has(w)).sort((a, b) => b.lengthFeet - a.lengthFeet);
}

describe.skipIf(DIR === "")("which filter drops the walls that go missing", () => {
  it("walks the chain stage by stage and reports what each takes", async () => {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    const measured: string[] = [];
    for (const want of WANTED) {
      const file = files.find((f) => f.includes(want.key));
      if (file === undefined) continue;
      const doc = await openPlanPdf(readFileSync(`${DIR}/${file}`));
      const { segments, widthPt, heightPt } = await doc.pageStrokes(want.page);
      const text = await doc.pageText(want.page);
      measured.push(`${want.key} p${want.page}`);

      const feetPerUnit = 288;
      const feetPerPoint = feetPerUnit / widthPt;
      const inUnits = (segments as StrokeSegment[]).map(inPageWidthUnits(widthPt));
      const textBoxes: SheetTextItem[] = text.items.map((i) => ({
        str: i.str,
        x: i.x / widthPt,
        y: i.y / widthPt,
        width: i.width / widthPt,
        height: i.height / widthPt,
      }));

      // The pairer on its own, in page-width units, the way the pipeline runs
      // it. Everything after this is a filter.
      const raw = wallsFromStrokes(inUnits, { feetPerPoint: feetPerUnit });
      const notLettering = wallsNotLettering(raw, textBoxes, feetPerUnit);
      const notBorder = wallsNotTheSheetBorder(notLettering, 1, heightPt / widthPt);
      const notStubs = wallsNotIsolatedStubs(notBorder, feetPerUnit);
      const inBuilding = wallsInTheBuilding(notStubs, feetPerUnit);

      console.log(
        `\n[${want.key} p${want.page}]  pairer ${raw.length} runs / ${feet(raw).toFixed(0)} ft`,
      );
      const stages: Array<[string, readonly WallCandidate[], readonly WallCandidate[]]> = [
        ["lettering", raw, notLettering],
        ["sheet border", notLettering, notBorder],
        ["isolated stubs", notBorder, notStubs],
        ["not the building", notStubs, inBuilding],
      ];
      for (const [name, before, after] of stages) {
        const gone = taken(before, after);
        if (gone.length === 0) {
          console.log(`   ${name.padEnd(17)} took nothing`);
          continue;
        }
        const biggest = gone
          .slice(0, 5)
          .map((w) => `${w.lengthFeet.toFixed(0)}ft@${(w.thicknessFeet * 12).toFixed(1)}in`)
          .join("  ");
        console.log(
          `   ${name.padEnd(17)} took ${String(gone.length).padStart(4)} runs / ` +
            `${feet(gone).toFixed(0).padStart(5)} ft   biggest: ${biggest}`,
        );
      }
      console.log(`   SURVIVING          ${inBuilding.length} runs / ${feet(inBuilding).toFixed(0)} ft`);

      // ── AND THE OTHER QUESTION: WHAT THE PAIRER NEVER PRODUCED ──
      //
      // Everything above is a candidate the pairer DID find and a filter then
      // removed. A wall that goes missing because nothing ever paired it does
      // not appear there at all, and that is the harder half.
      //
      // So: every long face the surviving walls do not cover, asked whether
      // ANY other face on the sheet forms a valid pair with it. "No valid
      // partner anywhere" is a real finding; "the nearest neighbour is close"
      // is not, which is what the first version of this probe got wrong — a
      // heavy line is drawn as two coincident strokes a sixth of an inch
      // apart, so its nearest parallel is always its own edge.
      const faces = oneFacePerLine(segments as StrokeSegment[], feetPerPoint).map(
        inPageWidthUnits(widthPt),
      );
      const longFaces = faces.filter(
        (f) => Math.hypot(f.x2 - f.x1, f.y2 - f.y1) * feetPerUnit >= 12,
      );
      const covered = (f: StrokeSegment) => {
        const mx = (f.x1 + f.x2) / 2;
        const my = (f.y1 + f.y2) / 2;
        return inBuilding.some((w) => {
          const dx = w.x2 - w.x1;
          const dy = w.y2 - w.y1;
          const len2 = dx * dx + dy * dy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((mx - w.x1) * dx + (my - w.y1) * dy) / len2));
          return Math.hypot(mx - (w.x1 + t * dx), my - (w.y1 + t * dy)) * feetPerUnit <= 1.5;
        });
      };
      const unclaimed = longFaces.filter((f) => !covered(f));
      let pairable = 0;
      let unpairable = 0;
      let unpairableFeet = 0;
      const options = { feetPerPoint: feetPerUnit };
      for (const face of unclaimed) {
        const hasPair = faces.some(
          (other) => other !== face && wallFromPair(face, other, options) !== null,
        );
        if (hasPair) pairable += 1;
        else {
          unpairable += 1;
          unpairableFeet += Math.hypot(face.x2 - face.x1, face.y2 - face.y1) * feetPerUnit;
        }
      }
      console.log(
        `   UNCLAIMED long faces ${unclaimed.length} of ${longFaces.length}: ` +
          `${pairable} HAVE a valid partner (so a filter or the widest-partner ` +
          `choice dropped them), ${unpairable} have NONE anywhere ` +
          `(${unpairableFeet.toFixed(0)} ft of single lines)`,
      );
    }
    expect(measured.length, "no sheet matched — the probe says nothing").toBeGreaterThan(0);
  });
});
