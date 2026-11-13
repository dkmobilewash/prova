import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { doorArcCandidates, doorSymbols, onlyMarkedDoors, tagsNameEveryWindow } from "../doorWindowSymbols";
import { doorsAndWindowsForSheet } from "../doorsWindows";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels } from "../heldOutScore";
import { detectForSheet } from "../offeredCandidates";
import {
  DOOR_FEATURE_NAMES, DOOR_FEATURES_VERSION, doorFeatureRows, doorSwings, openingLabels,
  WINDOW_FEATURE_NAMES, WINDOW_FEATURES_VERSION, windowFeatureRows, windowShape, type PlacedText, type WindowCandidate,
} from "../openingFeatures";
import { sheetStrokes } from "../sheetStrokes";
import { tagSymbols } from "../tagSymbols";

/**
 * ── THE OPENING FEATURE TABLE: ONE ROW PER FOUND DOOR AND PER FOUND WINDOW, ON EVERY KEYED SHEET ──
 *
 * What the learned door and window scorers train on (METHOD v2), in the second's wall table format
 * (`zzWallFeatureTable.eval.ts`): a header per kind, then `{set, sheet, kind, real, x}` rows.
 * Candidates are the finder's, on the product's walls (`detectForSheet`): every swing `doorSymbols`
 * keeps (before `onlyMarkedDoors`, whose drop is a column) and every window frame, plus a counted
 * tag placed with no frame. `real` = matched to the key (`openingLabels`: inside the swing or within
 * 2 ft, one to one). Only a sheet whose key marks doors enters the door rows, and windows likewise:
 * a sheet nobody keyed for doors cannot say a found door is false. A `keyCount` line per sheet and
 * kind lets recall be read against every key opening, not only the ones found.
 *
 * Calls no model. `OFT_HELD=1` writes the held-out sets, the final exam, run once per release.
 * Run: scripts/opening-model/table.sh <0|1> <out.jsonl>
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.OFT_OUT ?? "";
const HELD = process.env.OFT_HELD === "1";
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
/** A window tag in a symbol, as `doorsWindows.ts` reads one (W1, A, 1); anything else in a symbol is a door mark. */
const WINDOW_TAG = /^W?\d{1,2}[A-Z]?$|^[A-Z]$/;
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };

describe.skipIf(DIR === "" || LABELS === "" || OUT === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("opening feature table", () => {
  it("writes one row per found door and window", { timeout: 7_200_000 }, async () => {
    appendFileSync(OUT, JSON.stringify({ header: true, kind: "door", version: DOOR_FEATURES_VERSION, names: DOOR_FEATURE_NAMES }) + "\n");
    appendFileSync(OUT, JSON.stringify({ header: true, kind: "window", version: WINDOW_FEATURES_VERSION, names: WINDOW_FEATURE_NAMES }) + "\n");
    let sheets = 0;
    for (const dir of readdirSync(LABELS).sort()) {
      if ((heldOutReason(dir) !== null) !== HELD) continue;
      if (process.env.OFT_ONLY !== undefined && dir !== process.env.OFT_ONLY) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const pdf = findPdf(dir);
      if (pdf === null || names.length === 0) continue;
      let scheduleInSet: boolean | null = null;
      for (const name of names) {
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const openings = keyFromLabels(saved, saved.feetPerUnit).openings;
        const keyDoors = openings.filter((o) => o.kind === "door"), keyWindows = openings.filter((o) => o.kind === "window");
        if (keyDoors.length === 0 && keyWindows.length === 0) continue;
        const bytes = Buffer.from(readFileSync(pdf));
        const strokes = await sheetStrokes(bytes, saved.page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        if (scheduleInSet === null) {
          scheduleInSet = false;
          for (let p = 1; p <= doc.pageCount && !scheduleInSet; p += 1) {
            scheduleInSet = /WINDOW SCHEDULE|WINDOW TYPE/i.test((await doc.pageText(p)).items.map((i) => i.str).join(" "));
          }
        }
        const textItems = (await doc.pageText(saved.page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        await doc.close();
        const W = strokes.widthPt, fpu = saved.feetPerUnit;
        const allWords = textItems.map((t) => t.str).join(" ");
        const renovation = /\(E\)/i.test(allWords) || (allWords.match(/\bEXIST/gi) ?? []).length >= 3 || /RENOVATION|REMODEL|TENANT IMPROVEMENT|\bDEMO/i.test(allWords);
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu });
        const segments = d.found.inUnits, walls = d.found.walls;
        const words: PlacedText[] = textItems.map((t) => ({ text: t.str, x: (t.x + t.width / 2) / W, y: (t.y - t.height / 2) / W }));
        const symbols = tagSymbols({ segments: strokes.segments, text: textItems, unitsPerPaperInch: 72 }).filter((s) => s.rejected === null);
        const placed = symbols.map((s) => ({ text: s.text.trim().toUpperCase(), x: s.x / W, y: s.y / W }));
        const marks = placed.filter((s) => !WINDOW_TAG.test(s.text)), tags = placed.filter((s) => WINDOW_TAG.test(s.text));
        const context = { segments, walls, words, feetPerUnit: fpu, widthPt: W, renovation };
        const dw = doorsAndWindowsForSheet({ segments, segmentsPt: strokes.segments, textPt: textItems, widthPt: W, walls, feetPerUnit: fpu, scheduleRows: [] });

        if (keyDoors.length > 0) {
          const arcs = doorArcCandidates(segments, walls, fpu);
          const doors = doorSymbols(segments, walls, fpu);
          const kept = new Set(onlyMarkedDoors(doors, marks, fpu));
          const x = doorFeatureRows({ ...context, doors, arcs, marks, keptByProduct: kept });
          const real = openingLabels(doorSwings(doors, arcs, fpu).map((s) => s.polygons.flat()), keyDoors, fpu);
          doors.forEach((_, i) => appendFileSync(OUT, JSON.stringify({ set: dir, sheet, kind: "door", real: real[i], x: x[i]!.map((v) => +v.toFixed(4)) }) + "\n"));
          appendFileSync(OUT, JSON.stringify({ set: dir, sheet, kind: "door", keyCount: keyDoors.length }) + "\n");
        }
        if (keyWindows.length > 0) {
          const counted = dw.tagged.counted ? dw.tagged.windows : [];
          const windows: WindowCandidate[] = [
            ...dw.windows.map((f, i) => ({ frame: f, at: { x: (f.x1 + f.x2) / 2, y: (f.y1 + f.y2) / 2 }, countedTag: counted.find((t) => t.frame === i)?.tag ?? null })),
            ...counted.filter((t) => t.frame === null).map((t) => ({ frame: null, at: { x: t.x, y: t.y }, countedTag: t.tag })),
          ];
          const x = windowFeatureRows({ ...context, windows, tags, doors: dw.doors, everyWindowTagged: tagsNameEveryWindow(symbols.map((s) => s.text)), scheduleInSet });
          const real = openingLabels(windows.map(windowShape), keyWindows, fpu);
          windows.forEach((_, i) => appendFileSync(OUT, JSON.stringify({ set: dir, sheet, kind: "window", real: real[i], x: x[i]!.map((v) => +v.toFixed(4)) }) + "\n"));
          appendFileSync(OUT, JSON.stringify({ set: dir, sheet, kind: "window", keyCount: keyWindows.length }) + "\n");
        }
        sheets += 1;
      }
    }
    expect(sheets, "no keyed sheet was read").toBeGreaterThan(0);
  });
});
