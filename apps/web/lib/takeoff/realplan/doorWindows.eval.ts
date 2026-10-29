import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { findWallsOnSheet, inPageWidthUnits } from "../findWallsOnSheet";
import { doorArcCandidates, doorSymbols, windowSymbols, type DoorSymbol, type WindowSymbol } from "../doorWindowSymbols";
import { tagSymbols } from "../tagSymbols";
import { widthAndHeight } from "../openingMarks";

/**
 * ── DOORS AND WINDOWS, SCORED AGAINST A KEY BUILT FROM THE PLAN'S OWN MARKS ──
 *
 * A door on a floor plan carries a mark in a symbol beside it, and the door
 * schedule names the width. So the key is mostly the drawing's own lettering:
 * every mark drawn in a symbol on the sheet is a door, at that point, with the
 * schedule's width where one has been read (`DOOR_SCHEDULE_CACHE`, the
 * second session's cached model read). Unmarked doors (existing ones, say) and
 * every window are added by hand from crops.
 *
 *     REAL_PLAN_DIR=… DW_SET=… DW_PAGE=… DW_FPU=… [DW_SCHEDULE_CACHE=…]
 *     DW_KEY_DIR=… [DW_WRITE_KEY=1] [DW_OUT=…]
 *     npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/doorWindows.eval.ts
 *
 * `DW_WRITE_KEY=1` writes a DRAFT key from the marks for a person to correct;
 * without it the key file is read and the detections scored: found / missed /
 * false, and width error on every found door whose key has a width.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.DW_SET ?? "";
const PAGE = Number(process.env.DW_PAGE ?? "0");
const FPU = Number(process.env.DW_FPU ?? "0");
const CACHE = process.env.DW_SCHEDULE_CACHE ?? "";
const KEY_DIR = process.env.DW_KEY_DIR ?? "";
const WRITE_KEY = process.env.DW_WRITE_KEY === "1";
const OUT = process.env.DW_OUT ?? "";
/** A detection this close to a key point, in feet, is that door or window. */
const REACH_FEET = 4.5;
const MARK = /^[A-Z]?\d{3}[A-Z]?(?:-\d)?$/;

type KeyDoor = { mark: string | null; x: number; y: number; widthFeet: number | null; note?: string };
type KeyWindow = { x: number; y: number; widthFeet: number | null; note?: string };
type Key = { set: string; page: number; feetPerUnit: number; doors: KeyDoor[]; windows: KeyWindow[]; ignoreMarks: string[]; region?: { x0: number; y0: number; x1: number; y1: number } };

const mid = (d: DoorSymbol) => ({ x: (d.hinge.x + d.strike.x) / 2, y: (d.hinge.y + d.strike.y) / 2 });
const midW = (w: WindowSymbol) => ({ x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 });

describe.skipIf(DIR === "" || SET === "" || PAGE === 0 || !(FPU > 0) || KEY_DIR === "")("doors and windows against a key", () => {
  it("scores the sheet", { timeout: 900_000 }, async () => {
    const bytes = Buffer.from(readFileSync(join(DIR, SET)));
    const read = await sheetStrokes(bytes, PAGE);
    expect(read).not.toBeNull();
    if (!read) return;
    const W = read.widthPt;
    const doc = await openPlanPdf(bytes);
    const text = await doc.pageText(PAGE);
    const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
    const walls = findWallsOnSheet({ segments: read.segments, textItems: items, pageSize: { widthPt: W, heightPt: read.heightPt }, feetPerUnit: FPU, wallTypes: [], sampledSheets: null }).walls;
    const segs = read.segments.map(inPageWidthUnits(W));
    const allDoors = doorSymbols(segs, walls, FPU);
    // Window tags: a short code in a hexagon or circle (W1, W2, A, 101 is a
    // door) — the symbol pass finds them; a window mark is 1-3 characters.
    const windowTags = tagSymbols({ segments: read.segments, text: items, unitsPerPaperInch: 72 })
      .filter((s) => s.rejected === null && /^W?\d{1,2}[A-Z]?$|^[A-Z]$/.test(s.text.trim().toUpperCase()))
      .map((s) => ({ x: s.x / W, y: s.y / W }));
    const allWindows = windowSymbols(segs, walls, FPU, windowTags);
    if (process.env.DW_DEBUG === "1") {
      const all = tagSymbols({ segments: read.segments, text: items, unitsPerPaperInch: 72 });
      console.log(`   tags: ${all.length} symbols, ${windowTags.length} window-shaped: ${all.filter((t) => /^W\d/i.test(t.text.trim())).map((t) => `${t.text}@(${(t.x / W).toFixed(3)},${(t.y / W).toFixed(3)}) ${t.shape} ${t.rejected ?? "ok"}`).join(" ")}`);
    }
    const keyAt = join(KEY_DIR, SET, `p${PAGE}.json`);
    const reach = REACH_FEET / FPU;
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= reach;

    if (WRITE_KEY || !existsSync(keyAt)) {
      // ── A DRAFT KEY FROM THE MARKS ──
      const symbols = tagSymbols({ segments: read.segments, text: items, unitsPerPaperInch: 72 });
      const byShape: Record<string, number> = {};
      for (const s of symbols) byShape[s.shape] = (byShape[s.shape] ?? 0) + 1;
      const widths = new Map<string, number | null>();
      if (CACHE && existsSync(CACHE)) {
        const rows = (JSON.parse(readFileSync(CACHE, "utf8")) as { rows: { mark: string; size: string | null }[] }).rows;
        for (const r of rows) widths.set(r.mark.toUpperCase(), widthAndHeight(r.size).widthFt);
      }
      const marks = symbols.filter((s) => s.shape !== "square" && s.rejected !== "no-text" && s.rejected !== "dimension" && MARK.test(s.text.trim().toUpperCase()));
      // Marks the symbol pass did not see (Bunkie prints its in rounded
      // pills): a bare mark-shaped string that is not inside a SQUARE (a
      // room number) and not already a symbol mark.
      const squares = symbols.filter((s) => s.shape === "square");
      const bare = items
        .filter((i) => MARK.test(i.str.trim().toUpperCase()))
        .map((i) => ({ text: i.str.trim().toUpperCase(), x: i.x + i.width / 2, y: i.y - i.height / 2 }))
        .filter((t) => !squares.some((q) => Math.hypot(q.x - t.x, q.y - t.y) <= q.radius * 1.2))
        .filter((t) => !marks.some((m) => Math.hypot(m.x - t.x, m.y - t.y) <= (2 / FPU) * W));
      const key: Key = {
        set: SET,
        page: PAGE,
        feetPerUnit: FPU,
        doors: [
          ...marks.map((s) => ({ mark: s.text.trim().toUpperCase(), x: s.x / W, y: s.y / W, widthFeet: widths.get(s.text.trim().toUpperCase()) ?? null, note: `${s.shape}` })),
          ...bare.map((t) => ({ mark: t.text, x: t.x / W, y: t.y / W, widthFeet: widths.get(t.text) ?? null, note: "bare text" })),
        ],
        windows: [],
        ignoreMarks: [],
      };
      mkdirSync(join(KEY_DIR, SET), { recursive: true });
      writeFileSync(keyAt, JSON.stringify(key, null, 1));
      console.log(`DRAFT key written: ${keyAt}\n  symbols by shape ${JSON.stringify(byShape)}; ${marks.length} symbol marks: ${marks.map((m) => m.text).join(" ")}; ${bare.length} bare marks: ${bare.map((b) => b.text).join(" ")}`);
      console.log(`  schedule widths known for ${[...widths.values()].filter((w) => w !== null).length} marks`);
    }
    const key = JSON.parse(readFileSync(keyAt, "utf8")) as Key;
    // A sheet with no strokes, or a key with nothing in it, must not read as a clean run.
    expect(read.segments.length, "the sheet yielded no strokes").toBeGreaterThan(0);
    expect(key.doors.length + key.windows.length, "the key names nothing to score").toBeGreaterThan(0);
    // A key may cover one REGION of the sheet; detections outside it are neither found nor false.
    const inRegion = (p: { x: number; y: number }) => !key.region || (p.x >= key.region.x0 && p.x <= key.region.x1 && p.y >= key.region.y0 && p.y <= key.region.y1);
    const doors = allDoors.filter((d) => inRegion(mid(d)));
    const windows = allWindows.filter((w) => inRegion(midW(w)));
    const ignore = new Set(key.ignoreMarks.map((m) => m.toUpperCase()));
    const keyDoors = key.doors.filter((d) => d.mark === null || !ignore.has(d.mark));

    // ── SCORE ──
    // Nearest pairs first, over the whole sheet, so two doors four feet apart
    // (Baker's 102 and 100C) do not steal each other's detection.
    const usedDet = new Set<number>();
    const usedKey = new Set<number>();
    const pairs: { k: number; i: number; d: number }[] = [];
    keyDoors.forEach((kd, k) => doors.forEach((d, i) => {
      const dd = Math.hypot(mid(d).x - kd.x, mid(d).y - kd.y);
      if (dd <= reach) pairs.push({ k, i, d: dd });
    }));
    pairs.sort((a, b) => a.d - b.d);
    let found = 0, missed = 0;
    const errors: { mark: string | null; key: number; got: number }[] = [];
    for (const p of pairs) {
      if (usedDet.has(p.i) || usedKey.has(p.k)) continue;
      usedDet.add(p.i); usedKey.add(p.k); found++;
      const kd = keyDoors[p.k]!;
      if (kd.widthFeet !== null) errors.push({ mark: kd.mark, key: kd.widthFeet, got: doors[p.i]!.widthFeet });
    }
    const missedList: KeyDoor[] = keyDoors.filter((_, k) => !usedKey.has(k));
    missed = missedList.length;
    const falseDoors = doors.filter((_, i) => !usedDet.has(i));
    const usedW = new Set<number>();
    let wFound = 0, wMissed = 0;
    const wErrors: { key: number; got: number }[] = [];
    for (const kw of key.windows) {
      let best: { i: number; d: number } | null = null;
      windows.forEach((w, i) => {
        if (usedW.has(i)) return;
        const dd = Math.hypot(midW(w).x - kw.x, midW(w).y - kw.y);
        if (dd <= reach && (best === null || dd < best.d)) best = { i, d: dd };
      });
      if (best === null) { wMissed++; continue; }
      const b = best as { i: number };
      usedW.add(b.i); wFound++;
      if (kw.widthFeet !== null) wErrors.push({ key: kw.widthFeet, got: windows[b.i]!.widthFeet });
    }
    const falseWindows = windows.filter((_, i) => !usedW.has(i));
    const abs = errors.map((e) => Math.abs(e.got - e.key));
    const within = (tol: number) => abs.filter((a) => a <= tol).length;
    console.log(`\n${SET} p${PAGE}: walls ${walls.length}`);
    console.log(`DOORS key ${keyDoors.length}: found ${found}, missed ${missed}, false ${falseDoors.length}; width: ${errors.length} compared, within 1" ${within(1 / 12)}, within 3" ${within(0.25)}, worst ${abs.length ? Math.max(...abs).toFixed(2) : "-"} ft`);
    for (const e of errors.filter((e) => Math.abs(e.got - e.key) > 0.25)) console.log(`   width off: ${e.mark} key ${e.key.toFixed(2)} got ${e.got.toFixed(2)}`);
    console.log(`   missed: ${missedList.map((m) => m.mark ?? `(${m.x.toFixed(3)},${m.y.toFixed(3)})`).join(" ") || "none"}`);
    if (process.env.DW_DEBUG === "1") {
      const cands = doorArcCandidates(segs, walls, FPU);
      for (const m of missedList) {
        const nearby = cands.filter((c) => c.fit && Math.hypot(c.fit.cx - m.x, c.fit.cy - m.y) <= 8 / FPU);
        console.log(`   near ${m.mark}: ${nearby.length} arc chains: ${nearby.map((c) => `[${c.chain.length} pts r ${c.radiusFeet?.toFixed(2)} worst ${c.fit?.worst.toFixed(3)} sweep ${c.sweepDegrees?.toFixed(0) ?? "-"} → ${c.reject ?? "DOOR"}]`).join(" ")}`);
      }
    }
    console.log(`   false: ${falseDoors.map((d) => `(${mid(d).x.toFixed(3)},${mid(d).y.toFixed(3)}) ${d.widthFeet.toFixed(1)}'`).join(" ") || "none"}`);
    console.log(`WINDOWS key ${key.windows.length}: found ${wFound}, missed ${wMissed}, false ${falseWindows.length}; width within 3" ${wErrors.filter((e) => Math.abs(e.got - e.key) <= 0.25).length} of ${wErrors.length}`);
    console.log(`   false: ${falseWindows.map((w) => `(${midW(w).x.toFixed(3)},${midW(w).y.toFixed(3)}) ${w.widthFeet.toFixed(1)}'`).join(" ") || "none"}`);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      const base = `${SET}__p${PAGE}`;
      writeFileSync(join(OUT, `${base}.json`), JSON.stringify({ pdf: join(DIR, SET), page: PAGE, widthPt: W, heightPt: read.heightPt, feetPerUnit: FPU, walls: walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet })), doors: allDoors, windows: allWindows }));
      const crops = [
        ...missedList.map((m, i) => ({ name: `missed-${m.mark ?? i}`, x: m.x, y: m.y, halfFeet: 12 })),
        ...falseDoors.map((d, i) => ({ name: `falsedoor-${i}`, x: mid(d).x, y: mid(d).y, halfFeet: 12 })),
        ...falseWindows.map((w, i) => ({ name: `falsewin-${i}`, x: midW(w).x, y: midW(w).y, halfFeet: 12 })),
      ];
      writeFileSync(join(OUT, `${base}.crops.json`), JSON.stringify(crops));
      writeFileSync(join(OUT, `${base}.score.json`), JSON.stringify({ found, missed, false: falseDoors.length, errors, wFound, wMissed, wFalse: falseWindows.length, wErrors }, null, 1));
    }
  });
});
