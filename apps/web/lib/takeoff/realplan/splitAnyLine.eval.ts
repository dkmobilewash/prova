import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { detectForSheet } from "../offeredCandidates";
import { doorsAndWindowsForSheet } from "../doorsWindows";
import { pointInRing } from "../drawTools";
import { sheetRooms } from "../sheetRooms";
import { sheetStrokes } from "../sheetStrokes";
import type { WallCandidate } from "../wallVectors";

/**
 * ── SPLIT AREA ON A REAL SHEET, ANY WALL-TO-WALL LINE ──
 *
 * Joplin A-101 (training), the viewer's own path: Find the walls, the doors, then
 * the rooms, with and without one split across the open DINING + KITCHEN region.
 * Each line runs wall to wall inside that region; the floor total must not move
 * by more than 1 sf. Chrome round 5 lost 11 sf with a line along the kitchen's top
 * wall, left to right, so every horizontal line across the region is tried as
 * well as random ones.
 *
 *     REAL_PLAN_DIR="<folder holding Joplin-community-center.pdf>" \
 *       pnpm exec vitest run --config vitest.eval.config.mts lib/takeoff/realplan/splitAnyLine.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const FILE = join(DIR, "Joplin-community-center.pdf");
const PAGE = 46, FPU = 288.1829733163914;

describe.skipIf(DIR === "" || !existsSync(FILE))("Split area on Joplin A-101", () => {
  it("keeps the floor total for any wall-to-wall line across the dining region", { timeout: 1_800_000 }, async () => {
    const doc = await openPlanPdf(Buffer.from(readFileSync(FILE)));
    const text = await doc.pageText(PAGE);
    await doc.close();
    const strokes = await sheetStrokes(Buffer.from(readFileSync(FILE)), PAGE);
    const W = text.widthPt;
    const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
    const pairings: WallCandidate[] = [];
    const det = detectForSheet({ segments: strokes.segments, textItems: items, pageSize: { widthPt: W, heightPt: text.heightPt }, feetPerUnit: FPU, onCandidate: (_f: unknown, w: WallCandidate) => { pairings.push(w); } } as never);
    const found = det.found as { walls: WallCandidate[]; inUnits: { x1: number; y1: number; x2: number; y2: number }[] };
    expect(found.walls.length, "Joplin A-101 read to no walls").toBeGreaterThan(50);
    const segsPt = found.inUnits.map((o) => ({ ...o, x1: o.x1 * W, y1: o.y1 * W, x2: o.x2 * W, y2: o.y2 * W }));
    const dw = doorsAndWindowsForSheet({ segments: found.inUnits as never, segmentsPt: segsPt as never, textPt: items as never, widthPt: W, walls: found.walls, feetPerUnit: FPU, scheduleRows: [] });
    const rooms = (splits: { x1: number; y1: number; x2: number; y2: number }[] = []) =>
      sheetRooms({ pairings: pairings as never, runs: found.walls as never, drawn: [], segments: found.inUnits as never, doorLeaves: dw.doors.map((d) => ({ x1: d.hinge.x, y1: d.hinge.y, x2: d.strike.x, y2: d.strike.y })), splits, feetPerUnit: FPU, text: items as never, widthPt: W }).rooms;
    const floor = (rs: { squareFeet: number }[]) => rs.reduce((n, r) => n + r.squareFeet, 0);
    const before = rooms();
    const whole = floor(before);
    const dining = before.find((r) => (r.sharedTags ?? []).some((t) => /DINING/.test(t.name)) && (r.sharedTags ?? []).some((t) => /KITCHEN/.test(t.name)));
    expect(dining, "the open DINING + KITCHEN region").toBeTruthy();
    const ring = { xs: dining!.xs, ys: dining!.ys };
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    // Left to right across the region at every twentieth of its height: Chrome's line was one of these.
    const top = Math.min(...ring.ys), bottom = Math.max(...ring.ys);
    for (let k = 1; k < 20; k += 1) {
      const y = top + ((bottom - top) * k) / 20;
      const xs: number[] = [];
      for (let i = 0; i < ring.xs.length; i += 1) {
        const j = (i + 1) % ring.xs.length, ya = ring.ys[i]!, yb = ring.ys[j]!;
        if ((ya - y) * (yb - y) < 0) xs.push(ring.xs[i]! + ((y - ya) / (yb - ya)) * (ring.xs[j]! - ring.xs[i]!));
      }
      // Each stretch inside the region is one wall-to-wall line; a concave region has several.
      xs.sort((p, q) => p - q);
      for (let k2 = 0; k2 + 1 < xs.length; k2 += 1) {
        if (pointInRing((xs[k2]! + xs[k2 + 1]!) / 2, y, ring.xs, ring.ys)) lines.push({ x1: xs[k2]!, y1: y, x2: xs[k2 + 1]!, y2: y });
      }
    }
    // Random lines between points on the outline that stay inside the region.
    let seed = 11;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const onOutline = () => {
      const i = Math.floor(rand() * ring.xs.length), j = (i + 1) % ring.xs.length, t = rand();
      return { x: ring.xs[i]! + (ring.xs[j]! - ring.xs[i]!) * t, y: ring.ys[i]! + (ring.ys[j]! - ring.ys[i]!) * t };
    };
    const inside = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Array.from({ length: 19 }, (_, k) => (k + 1) / 20).every((t) => pointInRing(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, ring.xs, ring.ys));
    while (lines.length < 80) {
      const a = onOutline(), b = onOutline();
      if (Math.hypot(b.x - a.x, b.y - a.y) * FPU > 4 && inside(a, b)) lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    let divided = 0;
    for (const [i, line] of lines.entries()) {
      const after = rooms([line]);
      if (after.length > before.length) divided += 1;
      expect(Math.abs(floor(after) - whole), `line ${i}: ${floor(after).toFixed(1)} against ${whole.toFixed(1)}`).toBeLessThan(1);
    }
    console.log(`Joplin A-101: ${lines.length} lines, ${divided} divided the region; floor total ${whole.toFixed(1)} sf held on every one`);
    expect(divided).toBeGreaterThan(lines.length / 2);
  });
});
