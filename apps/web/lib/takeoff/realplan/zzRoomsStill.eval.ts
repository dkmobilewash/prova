import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { roomBoundary } from "../roomBoundary";
import { leakHints } from "../roomLeaks";
import { roomSeals } from "../roomSeals";
import { sheetStrokes } from "../sheetStrokes";
import type { WallCandidate } from "../wallVectors";

/**
 * ── WHAT IS DRAWN WHERE A NAMED ROOM STAYS OPEN ──
 *
 * For each named tag still open on the viewer's boundary, the single wall
 * extension that closes it (`leakHints`), and what the sheet draws along that
 * gap: strokes running with it, strokes crossing it, and closed filled shapes.
 * Training only, no model. ROOMS_ONLY=set/sheet narrows it. Writes PROBE_OUT.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const ONLY = (process.env.ROOMS_ONLY ?? "").toLowerCase();
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};

describe.skipIf(DIR === "" || LABELS === "")("what is drawn where a room stays open", () => {
  it("writes each open tag and its gap", { timeout: 7_200_000 }, async () => {
    const rows: unknown[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) {
        const sheet = name.slice(0, -5);
        if (!name.endsWith(".json") || excludedSheetReason(dir, sheet) !== null) continue;
        if (ONLY !== "" && !`${dir}/${sheet}`.toLowerCase().includes(ONLY)) continue;
        const pdf = findPdf(dir);
        if (pdf === null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as { page: number; feetPerUnit: number };
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        await doc.close();
        const W = strokes.widthPt;
        const fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const pairings: WallCandidate[] = [];
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (_f, w) => { pairings.push(w); } });
        const got = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
        const walls = roomBoundary({ pairings, runs: got.offeredRuns, drawn: [] });
        const doorSeals = roomSeals(walls, d.found.inUnits, fpu);
        const hints = leakHints({ walls, feetPerUnit: fpu, text: text.items, widthPt: W, only: (t: { name: string }) => t.name.trim().length >= 3, doorSeals } as never);
        const all = strokes.segments.map((s) => ({ x1: s.x1 / W, y1: s.y1 / W, x2: s.x2 / W, y2: s.y2 / W, width: s.width ?? 0, gray: s.gray ?? 0 }));
        for (const one of hints) {
          const row: Record<string, unknown> = { set: dir, sheet, page: saved.page, tag: one.tag, hint: one.hint };
          if (one.hint !== null) {
            const { x, y, dx, dy, lengthFeet } = one.hint;
            const L = lengthFeet / fpu;
            const near = 0.75 / fpu;
            let along = 0, across = 0, alongFeet = 0;
            const widths: number[] = [];
            for (const s of all) {
              const mx = (s.x1 + s.x2) / 2 - x, my = (s.y1 + s.y2) / 2 - y;
              const t = mx * dx + my * dy, off = Math.abs(-mx * dy + my * dx);
              const l = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
              if (l === 0 || t < -near || t > L + near || off > near) continue;
              const cos = Math.abs(((s.x2 - s.x1) * dx + (s.y2 - s.y1) * dy) / l);
              if (cos > 0.97) { along += 1; alongFeet += l * fpu; widths.push(s.width); } else if (cos < 0.26) across += 1;
            }
            Object.assign(row, { along, alongFeet: +alongFeet.toFixed(1), across, pen: widths.sort((a, b) => a - b)[widths.length >> 1] ?? null });
          }
          rows.push(row);
        }
      }
    }
    writeFileSync(process.env.PROBE_OUT ?? "/dev/null", JSON.stringify(rows));
    expect(rows.length, "no open room was found").toBeGreaterThan(0);
  });
});
