import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { doorSymbols } from "../doorWindowSymbols";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { roomBoundary } from "../roomBoundary";
import { roomSeals } from "../roomSeals";
import { roomsClosedAtDrawnLines, roomsFromWalls, roomsSplitAtDrawnWalls, type FoundWall, type RoomsFromWallsResult } from "../roomsFromWalls";
import { sheetStrokes } from "../sheetStrokes";
import type { WallCandidate } from "../wallVectors";

/**
 * ── WHAT LEAVES A ROOM OPEN ──
 *
 * The real room finder over the walls the product offers, then again with one
 * thing added back at a time: door swings as seals, the raw pairings, each kind
 * of line a rule set aside, and the key's own walls as the ceiling. A tag that
 * closes when a thing is added names that thing as the cause, so causes are
 * ranked by rooms closed. Training sheets only. No model. Writes PROBE_OUT.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type G = { x1: number; y1: number; x2: number; y2: number; thicknessFeet?: number };
const isRoomTag = (t: { name?: string | null; number?: string | null }) => (t.name ?? "").trim().length >= 3;
const label = (t: { name?: string | null; number?: string | null }) => `${t.number ?? ""} ${t.name ?? ""}`.trim();

function summary(r: RoomsFromWallsResult) {
  const rooms = r.rooms.filter((one) => one.tag !== null);
  return {
    closed: rooms.filter((one) => isRoomTag(one.tag!)).map((one) => label(one.tag!)),
    sf: Math.round(r.rooms.reduce((n, one) => n + one.squareFeet, 0)),
    namedSf: Math.round(rooms.reduce((n, one) => n + one.squareFeet, 0)),
    regions: r.rooms.length,
    rooms: rooms.filter((one) => isRoomTag(one.tag!)).map((one) => ({ name: one.tag!.name, number: one.tag!.number, sf: Math.round(one.squareFeet) })),
    open: r.unplacedTags.filter(isRoomTag).map(label),
    merged: r.mergedTags.filter(isRoomTag).map(label),
  };
}

describe.skipIf(DIR === "" || LABELS === "")("what leaves a room open", () => {
  it("adds one thing back at a time", { timeout: 7_200_000 }, async () => {
    const rows: unknown[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) {
        const sheet = name.slice(0, -5);
        if (!name.endsWith(".json") || excludedSheetReason(dir, sheet) !== null) continue;
        const pdf = findPdf(dir);
        if (pdf === null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as { page: number; feetPerUnit: number; verdicts: (G & { verdict: string })[] };
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        await doc.close();
        const W = strokes.widthPt;
        const fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const pairings: WallCandidate[] = [];
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (_f, w) => { pairings.push(w); } });
        const got = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
        const runs = got.offeredRuns;
        const run = (walls: readonly FoundWall[], extra: Partial<Parameters<typeof roomsFromWalls>[0]> = {}) =>
          summary(roomsFromWalls({ walls, feetPerUnit: fpu, text: text.items, widthPt: W, ...extra }));
        const stage = roomBoundary({ pairings: [], runs, drawn: [] });
        const viewer = roomBoundary({ pairings, runs, drawn: [] });
        const line = (l: G): FoundWall => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, thicknessFeet: 0.3 });
        const key = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map((v) => ({ x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, thicknessFeet: v.thicknessFeet || undefined }));
        const doors = doorSymbols(d.found.inUnits, [], fpu).map((o) => ({ x1: o.hinge.x, y1: o.hinge.y, x2: o.strike.x, y2: o.strike.y }));
        const units = d.found.inUnits.map((u) => ({ x1: u.x1, y1: u.y1, x2: u.x2, y2: u.y2 }));
        const seals = roomSeals(viewer, d.found.inUnits, fpu);
        const input = { walls: viewer, feetPerUnit: fpu, text: text.items, widthPt: W, doorSeals: seals };
        const lines = [...units, ...doors];
        const product = roomsSplitAtDrawnWalls(input, lines);
        const arms: Record<string, ReturnType<typeof summary>> = { product: summary(product), key: run(key) };
        arms.closed = summary(roomsClosedAtDrawnLines(product, input, lines));
        rows.push({ set: dir, sheet, page: saved.page, doors: doors.length, pairings: pairings.length, runs: runs.length, arms });
      }
    }
    writeFileSync(process.env.PROBE_OUT ?? "/dev/null", JSON.stringify(rows));
    expect(rows.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
