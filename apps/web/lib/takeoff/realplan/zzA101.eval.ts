import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── THE RUNS ON ONE SHEET, SO A REVIEW CAN BE ARGUED ABOUT ──
 *
 * Camp Bow Wow A101 is the first sheet anybody labelled. 144 candidates, 25
 * accepted, 71 rejected, 48 unsure. The questions that came back — which of
 * the unsure ones are site walls, are those two long east-wall runs the same
 * wall counted twice — need the run LIST, which the saved label file does not
 * carry (it keeps derived pairing rows; see `labelRows.ts`, now fixed).
 *
 * The finder is deterministic, so the runs can be regenerated exactly. This
 * prints them with the two things a reviewer needs to argue about each one:
 * where it is on the sheet, and what else overlaps it.
 *
 *     BIM_DIR unused. REAL_PLAN_DIR="$HOME/Claude Folder/takeoff/real-plans" \
 *     A101_OUT=/tmp/a101 \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzA101.eval.ts
 *
 * Reads a client plan set, so it is gated and never runs in CI.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.A101_OUT ?? "";
const SET = process.env.A101_SET ?? "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf";
const PAGE = Number(process.env.A101_PAGE ?? "8");

type Line = { x1: number; y1: number; x2: number; y2: number };
const lengthOf = (l: Line) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
const parallelism = (a: Line, b: Line) => {
  const la = lengthOf(a) || 1;
  const lb = lengthOf(b) || 1;
  return Math.abs(((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb));
};
const offLine = (a: Line, px: number, py: number) => {
  const len = lengthOf(a) || 1;
  return Math.abs(-(px - a.x1) * ((a.y2 - a.y1) / len) + (py - a.y1) * ((a.x2 - a.x1) / len));
};
const overlapOf = (a: Line, b: Line) => {
  const len = lengthOf(a) || 1;
  const ux = (a.x2 - a.x1) / len;
  const uy = (a.y2 - a.y1) / len;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const lo = Math.max(0, Math.min(at(b.x1, b.y1), at(b.x2, b.y2)));
  const hi = Math.min(len, Math.max(at(b.x1, b.y1), at(b.x2, b.y2)));
  return Math.max(0, hi - lo);
};

describe.skipIf(DIR === "")("one sheet's runs, listed", () => {
  it("prints every run and the ones that overlap it", { timeout: 1_800_000 }, async () => {
    const bytes = Buffer.from(readFileSync(join(DIR, SET)));
    const read = await sheetStrokes(bytes, PAGE);
    expect(read, "the sheet could not be read").not.toBeNull();
    if (read === null) return;
    const doc = await openPlanPdf(bytes);
    const text = await doc.pageText(PAGE);
    const textItems = text.items.map((i) => ({
      str: i.str,
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height,
    }));

    const widthPt = read.widthPt;
    const heightPt = read.heightPt;
    // 1/8" = 1'-0" on this sheet, which the app has already accepted.
    const feetPerUnit = Number(process.env.A101_FEET_PER_UNIT ?? "288");

    const found = findWallsOnSheet({
      segments: read.segments,
      textItems,
      pageSize: { widthPt, heightPt },
      feetPerUnit,
      wallTypes: [],
      sampledSheets: null,
    });
    const runs = found.walls;
    expect(runs.length, "no runs, so there is nothing to list").toBeGreaterThan(0);

    // ── WHAT OVERLAPS WHAT ──
    //
    // Two runs on one wall is the duplicate the reviewer asked about: same
    // line, same direction, and one largely inside the other. Reported as a
    // SHARE of the shorter, because a 65 ft run sitting inside an 84 ft one
    // is a duplicate and a 65 ft run meeting it at a corner is not.
    const dup: { a: number; b: number; share: number }[] = [];
    for (let i = 0; i < runs.length; i += 1) {
      for (let j = i + 1; j < runs.length; j += 1) {
        const a = runs[i];
        const b = runs[j];
        if (parallelism(a, b) < 0.995) continue;
        const band = Math.max(a.thicknessFeet, b.thicknessFeet) / feetPerUnit;
        if (offLine(a, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2) > band) continue;
        const share = overlapOf(a, b) / Math.min(lengthOf(a), lengthOf(b));
        if (share < 0.5) continue;
        dup.push({ a: i, b: j, share });
      }
    }

    const sorted = [...runs.keys()].sort((p, q) => runs[q].lengthFeet - runs[p].lengthFeet);
    console.log(
      `\n${runs.length} runs, ${runs.reduce((n, r) => n + r.lengthFeet, 0).toFixed(0)} ft in total\n`,
    );
    console.log(`${"#".padStart(4)} ${"ft".padStart(7)} ${"thick".padStart(6)}  where (page-width units)   overlaps`);
    for (const at of sorted) {
      const r = runs[at];
      const with_ = dup
        .filter((d) => d.a === at || d.b === at)
        .map((d) => `#${d.a === at ? d.b : d.a} ${(d.share * 100).toFixed(0)}%`);
      console.log(
        `${String(at).padStart(4)} ${r.lengthFeet.toFixed(1).padStart(7)} ${(r.thicknessFeet * 12).toFixed(1).padStart(6)}` +
          `  (${r.x1.toFixed(3)},${r.y1.toFixed(3)})→(${r.x2.toFixed(3)},${r.y2.toFixed(3)})` +
          (with_.length > 0 ? `   ${with_.join(", ")}` : ""),
      );
    }

    console.log(`\n${dup.length} overlapping PAIRS (same line, over half the shorter one covered)`);
    for (const d of dup.sort((p, q) => q.share - p.share)) {
      const a = runs[d.a];
      const b = runs[d.b];
      const keep = a.lengthFeet >= b.lengthFeet ? d.a : d.b;
      console.log(
        `  #${d.a} (${a.lengthFeet.toFixed(1)} ft) and #${d.b} (${b.lengthFeet.toFixed(1)} ft)` +
          ` — ${(d.share * 100).toFixed(0)}% shared, ${(Math.min(a.lengthFeet, b.lengthFeet)).toFixed(1)} ft double-counted` +
          `, keep #${keep}`,
      );
    }
    const doubled = dup.reduce(
      (n, d) => n + Math.min(runs[d.a].lengthFeet, runs[d.b].lengthFeet),
      0,
    );
    console.log(`  ${doubled.toFixed(0)} ft counted twice if every one of these is accepted`);

    if (OUT !== "") {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(
        join(OUT, "runs.json"),
        JSON.stringify(
          {
            sheet: SET,
            page: PAGE,
            feetPerUnit,
            pageSize: { widthPt, heightPt },
            runs: runs.map((r, at) => ({
              at,
              x1: r.x1,
              y1: r.y1,
              x2: r.x2,
              y2: r.y2,
              lengthFeet: r.lengthFeet,
              thicknessFeet: r.thicknessFeet,
            })),
            duplicates: dup,
          },
          null,
          1,
        ),
        "utf8",
      );
      console.log(`\nwrote ${join(OUT, "runs.json")}`);
    }
  });
});
