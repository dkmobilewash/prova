import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import type { StrokeSegment, WallCandidate } from "../wallVectors";

/**
 * TEMPORARY DIAGNOSTIC — what the phantoms actually look like, before anything
 * is changed.
 *
 * Two shapes were reported by eye: a lobby bench traced as wall on ELEVEN03,
 * and dimension lines traced as wall on Camp Bow Wow. The proposed
 * discriminator is CONNECTIVITY — real walls join walls, while furniture,
 * casework and detail linework are isolated islands.
 *
 * `wallsInTheBuilding` already groups at `SAME_BUILDING_FEET` (20 ft) and keeps
 * the biggest group. That is coarse on purpose: it is there to keep a plan
 * together across gaps, so anything standing INSIDE a building joins the main
 * group and survives. This measures the graph at tight tolerances instead, to
 * see whether the islands the eye reports are really islands to the geometry.
 *
 * Prints counts, feet and thicknesses — measurement, never drawing content.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";

/** `set:page` pairs, defaulting to the two sheets the phantoms were seen on. */
const WANTED = (process.env.PHANTOM_SHEETS ?? "Camp Bow Wow:9,2025-03-28_ELEVEN03:119")
  .split(",")
  .map((part) => part.trim())
  .filter((part) => part.includes(":"))
  .map((part) => {
    const [key, page] = part.split(":");
    return { key: key.trim(), page: Number(page) };
  });

/** Nearest distance between two runs, end to end or end to body, in feet. */
function gapFeet(a: WallCandidate, b: WallCandidate, feetPerUnit: number): number {
  const near = (px: number, py: number, s: WallCandidate): number => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
    return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
  };
  const units = Math.min(
    near(a.x1, a.y1, b),
    near(a.x2, a.y2, b),
    near(b.x1, b.y1, a),
    near(b.x2, b.y2, a),
  );
  return units * feetPerUnit;
}

/** Island sizes at a given join tolerance. */
function islands(walls: readonly WallCandidate[], feetPerUnit: number, joinFeet: number) {
  const parent = walls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      if (gapFeet(walls[i], walls[j], feetPerUnit) <= joinFeet) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const groups = new Map<number, WallCandidate[]>();
  walls.forEach((wall, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), wall]);
  });
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

describe.skipIf(DIR === "")("what the phantoms look like to the geometry", () => {
  it("reports islands and thicknesses per sheet", async () => {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    const measured: string[] = [];
    for (const want of WANTED) {
      const file = files.find((f) => f.includes(want.key));
      if (file === undefined) continue;
      const doc = await openPlanPdf(readFileSync(`${DIR}/${file}`));
      const { segments, widthPt, heightPt } = await doc.pageStrokes(want.page);
      const text = await doc.pageText(want.page);
      const items: SheetTextItem[] = text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      }));
      const feetPerUnit = 288;
      const found = findWallsOnSheet({
        segments: segments as StrokeSegment[],
        textItems: items,
        pageSize: { widthPt, heightPt },
        feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      measured.push(`${want.key} p${want.page}`);
      const total = found.walls.reduce((n, w) => n + w.lengthFeet, 0);
      console.log(
        `\n[${want.key} p${want.page}]  ${found.walls.length} runs  ${total.toFixed(0)} ft`,
      );
      for (const joinFeet of [0.5, 1, 2]) {
        const groups = islands(found.walls, feetPerUnit, joinFeet);
        const singles = groups.filter((g) => g.length === 1);
        const small = groups.filter((g) => g.length > 1 && g.length <= 3);
        const singleFeet = singles.reduce((n, g) => n + g[0].lengthFeet, 0);
        const smallFeet = small.reduce(
          (n, g) => n + g.reduce((m, w) => m + w.lengthFeet, 0),
          0,
        );
        console.log(
          `   join ${String(joinFeet).padStart(3)} ft: ${String(groups.length).padStart(4)} islands` +
            `   biggest ${String(groups[0]?.length ?? 0).padStart(4)} runs` +
            `   alone ${String(singles.length).padStart(4)} runs / ${singleFeet.toFixed(0).padStart(5)} ft` +
            `   in 2-3 ${String(small.length).padStart(3)} islands / ${smallFeet.toFixed(0).padStart(5)} ft`,
        );
      }
      // ── WHAT AN ISOLATED RUN LOOKS LIKE, AGAINST A CONNECTED ONE ──
      //
      // The discriminator has to separate them on something other than being
      // isolated, or dropping islands is just dropping a fixed share of the
      // sheet. Length and thickness are what there is.
      const groups1 = islands(found.walls, feetPerUnit, 1);
      const aloneSet = new Set(groups1.filter((g) => g.length === 1).map((g) => g[0]));
      const alone = found.walls.filter((w) => aloneSet.has(w));
      const joined = found.walls.filter((w) => !aloneSet.has(w));
      const describe = (name: string, set: readonly WallCandidate[]) => {
        if (set.length === 0) return;
        const lengths = [...set].map((w) => w.lengthFeet).sort((a, b) => a - b);
        const mid = lengths[Math.floor(lengths.length / 2)];
        const thin = [...set].map((w) => w.thicknessFeet * 12).sort((a, b) => a - b);
        console.log(
          `   ${name.padEnd(9)} n=${String(set.length).padStart(3)}` +
            `  len median ${mid.toFixed(1).padStart(5)} ft  max ${lengths[lengths.length - 1].toFixed(0).padStart(3)}` +
            `  under 8ft ${String(lengths.filter((l) => l < 8).length).padStart(3)}` +
            `  thickness median ${thin[Math.floor(thin.length / 2)].toFixed(1)}in`,
        );
      };
      describe("ALONE", alone);
      describe("JOINED", joined);

      const byThickness = new Map<string, { feet: number; n: number }>();
      for (const wall of found.walls) {
        const key = (wall.thicknessFeet * 12).toFixed(1);
        const at = byThickness.get(key) ?? { feet: 0, n: 0 };
        at.feet += wall.lengthFeet;
        at.n += 1;
        byThickness.set(key, at);
      }
      const bands = [...byThickness.entries()].sort((a, b) => b[1].feet - a[1].feet);
      console.log(
        `   thickness: ${bands.map(([k, v]) => `${k}in ${v.feet.toFixed(0)}ft n=${v.n}`).join(" | ")}`,
      );
    }
    // A path that matches no file would otherwise read as a clean run — the
    // vacuous green this whole directory exists to refuse.
    expect(measured.length, "no sheet matched — the probe says nothing").toBeGreaterThan(0);
  });
});
