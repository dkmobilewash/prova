import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet, inPageWidthUnits, type SheetTextItem } from "../findWallsOnSheet";
import { classifySingleLines, type SingleLineClass } from "../singleLines";
import { oneFacePerLine, wallFromPair } from "../wallVectors";
import type { StrokeSegment, WallCandidate } from "../wallVectors";

/**
 * TEMPORARY DIAGNOSTIC — what the unpaired long lines look like, by class,
 * with an overlay per class.
 *
 * It changes no detection. Its whole job is to turn "8,485 ft of single lines"
 * into a handful of named groups a person can look at before reviewing a
 * sheet, so the answer key is made with some idea of what it is deciding.
 *
 * Reads in place from REAL_PLAN_DIR, writes overlays to REAL_PLAN_OUT — both
 * outside the repository. Prints counts, feet and pen widths; no drawing
 * content.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.REAL_PLAN_OUT ?? "";
const WANTED = (process.env.CLASS_SHEETS ?? "Camp Bow Wow:9,2025-03-28_ELEVEN03:119")
  .split(",")
  .map((part) => part.trim())
  .filter((part) => part.includes(":"))
  .map((part) => {
    const [key, page] = part.split(":");
    return { key: key.trim(), page: Number(page) };
  });

const COLOURS: Record<SingleLineClass, string> = {
  "heavier-than-walls": "#dc2626",
  "lighter-than-walls": "#2563eb",
  "in-a-hatch": "#16a34a",
  dashed: "#9333ea",
  "past-the-building": "#ea580c",
  "small-closed-shape": "#0891b2",
  unclassified: "#f59e0b",
};

/** The sheet in grey, one class in colour, the reported walls in black. */
function overlay(
  segments: readonly StrokeSegment[],
  walls: readonly WallCandidate[],
  lines: readonly StrokeSegment[],
  colour: string,
  page: { widthPt: number; heightPt: number },
  scale: number,
): string {
  const line = (s: { x1: number; y1: number; x2: number; y2: number }) =>
    `<line x1="${(s.x1 * scale).toFixed(1)}" y1="${(s.y1 * scale).toFixed(1)}" ` +
    `x2="${(s.x2 * scale).toFixed(1)}" y2="${(s.y2 * scale).toFixed(1)}"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.widthPt}" height="${page.heightPt}" `,
    `viewBox="0 0 ${page.widthPt} ${page.heightPt}">`,
    `<rect width="100%" height="100%" fill="white"/>`,
    `<g stroke="#d4d4d4" stroke-width="0.5">${segments.map(line).join("")}</g>`,
    `<g stroke="#111827" stroke-width="1.5" opacity="0.35">${walls.map(line).join("")}</g>`,
    `<g stroke="${colour}" stroke-width="2.5">${lines.map(line).join("")}</g>`,
    `</svg>`,
  ].join("");
}

describe.skipIf(DIR === "")("the unpaired long lines, by class", () => {
  it("counts each class and writes an overlay for it", async () => {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    const measured: string[] = [];
    if (OUT !== "") mkdirSync(OUT, { recursive: true });
    for (const want of WANTED) {
      const file = files.find((f) => f.includes(want.key));
      if (file === undefined) continue;
      const doc = await openPlanPdf(readFileSync(`${DIR}/${file}`));
      const { segments, widthPt, heightPt } = await doc.pageStrokes(want.page);
      const text = await doc.pageText(want.page);
      measured.push(`${want.key} p${want.page}`);

      const feetPerUnit = 288;
      const pageSize = { widthPt, heightPt };
      const items: SheetTextItem[] = text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      }));
      const found = findWallsOnSheet({
        segments: segments as StrokeSegment[],
        textItems: items,
        pageSize,
        feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });

      const inUnits = (segments as StrokeSegment[]).map(inPageWidthUnits(widthPt));
      const faces = oneFacePerLine(segments as StrokeSegment[], feetPerUnit / widthPt).map(
        inPageWidthUnits(widthPt),
      );
      const covered = (f: StrokeSegment) => {
        const mx = (f.x1 + f.x2) / 2;
        const my = (f.y1 + f.y2) / 2;
        return found.walls.some((w) => {
          const dx = w.x2 - w.x1;
          const dy = w.y2 - w.y1;
          const len2 = dx * dx + dy * dy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((mx - w.x1) * dx + (my - w.y1) * dy) / len2));
          return Math.hypot(mx - (w.x1 + t * dx), my - (w.y1 + t * dy)) * feetPerUnit <= 1.5;
        });
      };
      const options = { feetPerPoint: feetPerUnit };
      const unclaimed = faces.filter(
        (f) =>
          Math.hypot(f.x2 - f.x1, f.y2 - f.y1) * feetPerUnit >= 12 &&
          !covered(f) &&
          !faces.some((other) => other !== f && wallFromPair(f, other, options) !== null),
      );

      const classified = classifySingleLines({
        unclaimed,
        faces,
        segments: inUnits,
        walls: found.walls,
        feetPerUnit,
      });

      const byKind = new Map<SingleLineClass, { n: number; feet: number; lines: StrokeSegment[]; why: string }>();
      for (const one of classified) {
        const at = byKind.get(one.kind) ?? { n: 0, feet: 0, lines: [], why: one.why };
        at.n += 1;
        at.feet += one.lengthFeet;
        at.lines.push(one.line);
        byKind.set(one.kind, at);
      }
      const total = classified.reduce((n, c) => n + c.lengthFeet, 0);
      console.log(
        `\n[${want.key} p${want.page}]  ${found.walls.length} walls reported; ` +
          `${classified.length} unpaired long lines, ${total.toFixed(0)} ft`,
      );
      for (const [kind, at] of [...byKind.entries()].sort((a, b) => b[1].feet - a[1].feet)) {
        console.log(
          `   ${kind.padEnd(19)} ${String(at.n).padStart(4)} lines ${at.feet.toFixed(0).padStart(6)} ft` +
            `   e.g. ${at.why}`,
        );
        if (OUT !== "") {
          const name = `${want.key.replace(/[^A-Za-z0-9_-]+/g, "_")}-p${want.page}-${kind}.svg`;
          writeFileSync(
            join(OUT, name),
            overlay(inUnits, found.walls, at.lines, COLOURS[kind], pageSize, widthPt),
            "utf8",
          );
        }
      }
      if (OUT !== "") console.log(`   overlays written to ${OUT}`);
    }
    expect(measured.length, "no sheet matched — the probe says nothing").toBeGreaterThan(0);
  });
});
