import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { DOOR_TAG_REACH_FEET, tagsNameEveryWindow } from "../doorWindowSymbols";
import { doorsAndWindowsForSheet } from "../doorsWindows";
import { asideExistingWalls } from "../existingDoors";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels } from "../heldOutScore";
import { productDetection, productSheetRuns, sampledSheetsFor } from "../productDetection";
import { openingInputs, productDoorRows } from "../productOpenings";
import {
  DOOR_FEATURE_NAMES, DOOR_FEATURES_VERSION, doorSwings, openingLabels,
  WINDOW_FEATURE_NAMES, WINDOW_FEATURES_VERSION, windowFeatureRows, windowShape, type WindowCandidate,
} from "../openingFeatures";
import { sheetStrokes } from "../sheetStrokes";
import { tagSymbols } from "../tagSymbols";

/**
 * ── THE OPENING FEATURE TABLE: ONE ROW PER FOUND DOOR AND PER FOUND WINDOW, ON EVERY KEYED SHEET ──
 *
 * What the learned door and window scorers train on (METHOD v2), in the second's wall table format
 * (`zzWallFeatureTable.eval.ts`): a header per kind, then `{set, sheet, kind, real, x}` rows.
 * Candidates are the finder's, on the product's OWN inputs (`productDetection` with the set's template,
 * the viewer's set-asides, the runs the stage stores, the page's strokes — `productOpenings.ts`, as
 * `rooms.ts` builds them; until 2026-11-13 this used `detectForSheet` bare, and every door feature that
 * reads its wall came from a different wall set). Every swing `doorSymbols`
 * keeps (before `onlyMarkedDoors`, whose drop is a column) and every window frame, plus a counted
 * tag placed with no frame. `real` = matched to the key (`openingLabels`: inside the swing or within
 * 2 ft, one to one). Each row also carries `page` and `at` (page-width units) so it can be found on its
 * sheet. Only a sheet whose key marks doors enters the door rows, and windows likewise:
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
/**
 * The set's WINDOW schedule as the ingest reads it, from `zzWindowCount.eval.ts`'s cache
 * (`<set>-p<page>-window-schedule.json`), never a new model call. Without it a set tagged by its
 * schedule's letters (Topeka: A, D, E, F) reads as tagging no window, and #1165's drawn count takes
 * its frames, which the product (holding the schedule) would not do.
 */
const SCHEDULE_CACHE = process.env.OFT_SCHEDULE_CACHE ?? "";
function cachedWindowRows(pdf: string): { mark: string; size?: string | null; description?: string | null }[] {
  if (SCHEDULE_CACHE === "") return [];
  const file = basename(pdf);
  const stems = [file.replace(/\W+/g, "_"), `new_${file.replace(/\W+/g, "_")}`];
  const rows: { mark: string; size?: string | null; description?: string | null }[] = [];
  for (const n of readdirSync(SCHEDULE_CACHE)) {
    if (!n.endsWith("-window-schedule.json") || !stems.some((s) => n.startsWith(`${s}-p`))) continue;
    const read = JSON.parse(readFileSync(join(SCHEDULE_CACHE, n), "utf8")) as { kind?: string; rows?: { mark?: string | null; size?: string | null; description?: string | null }[] };
    if (read.kind !== "WINDOW") continue;
    for (const r of read.rows ?? []) if (typeof r.mark === "string" && r.mark.trim() !== "" && !rows.some((o) => o.mark === r.mark)) rows.push({ mark: r.mark, size: r.size ?? null, description: r.description ?? null });
  }
  return rows;
}
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };

describe.skipIf(DIR === "" || LABELS === "" || OUT === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("opening feature table", () => {
  it("writes one row per found door and window", { timeout: 7_200_000 }, async () => {
    appendFileSync(OUT, JSON.stringify({ header: true, kind: "door", version: DOOR_FEATURES_VERSION, names: DOOR_FEATURE_NAMES }) + "\n");
    appendFileSync(OUT, JSON.stringify({ header: true, kind: "window", version: WINDOW_FEATURES_VERSION, names: WINDOW_FEATURE_NAMES }) + "\n");
    const read: string[] = [];
    const parity = { sheets: 0, differ: 0, lines: [] as string[] };
    for (const dir of readdirSync(LABELS).sort()) {
      if ((heldOutReason(dir) !== null) !== HELD) continue;
      if (process.env.OFT_ONLY !== undefined && dir !== process.env.OFT_ONLY) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const pdf = findPdf(dir);
      if (pdf === null || names.length === 0) continue;
      let scheduleInSet: boolean | null = null;
      const windowRows = cachedWindowRows(pdf);
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
        const W = strokes.widthPt, fpu = saved.feetPerUnit;
        // ── THE PRODUCT'S OWN INPUTS (METHOD v2 parity, `productDetection.ts` + `productOpenings.ts`) ──
        // Detection with the set's template and the sheet's printed vocabulary (a new company: no types,
        // no legend), the viewer's set-asides, the runs the stage stores (`found.regroup` of the offered
        // runs), and the page's strokes — what `rooms.ts` finds doors and windows against at Run takeoff.
        const sampledSheets = await sampledSheetsFor({ pageCount: doc.pageCount, pageNumber: saved.page, own: strokes, read: (n) => doc.pageStrokes(n) });
        await doc.close();
        const d = productDetection({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, wallTypes: [], legendCodes: null, scanned: false, sampledSheets });
        const offered = productSheetRuns({ detected: d, segmentsPt: strokes.segments, widthPt: W, feetPerUnit: fpu, textItems });
        const stored = d.found.regroup(offered.offeredRuns).flatMap((g) => g.runs as readonly { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number }[]).map((r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, thicknessFeet: r.thicknessFeet }));
        const inputs = openingInputs({ runs: stored, feetPerUnit: fpu, widthPt: W, segmentsPt: strokes.segments });
        // The walls the stage set aside as existing: a door on one is set aside too (`existingDoors.ts`).
        const existing = { asideWalls: asideExistingWalls(offered.setAsideLines) };
        const door = productDoorRows({ ...inputs, textPt: textItems, existing });
        const { segments, walls } = inputs;
        const { context, tags } = door;
        const symbols = tagSymbols({ segments: strokes.segments, text: textItems, unitsPerPaperInch: 72 }).filter((s) => s.rejected === null);
        const dw = doorsAndWindowsForSheet({ segments, segmentsPt: inputs.segmentsPt, textPt: textItems, widthPt: W, walls, feetPerUnit: fpu, scheduleRows: [], windowRows, existing });

        if (keyDoors.length > 0) {
          const { arcs, doors, rows: x } = door;
          // PARITY: the doors this row set calls kept must be exactly the doors the product posts from the same inputs.
          const k = (d: { hinge: { x: number; y: number }; strike: { x: number; y: number } }) => `${d.hinge.x.toFixed(7)},${d.hinge.y.toFixed(7)},${d.strike.x.toFixed(7)},${d.strike.y.toFixed(7)}`;
          const productKept = dw.doors.map(k).sort(), trainKept = [...door.kept].map(k).sort();
          parity.sheets += 1;
          if (JSON.stringify(productKept) !== JSON.stringify(trainKept)) { parity.differ += 1; parity.lines.push(`PARITY DIFFER ${dir}/${sheet}: product ${productKept.length} kept, rows ${trainKept.length}`); }
          const real = openingLabels(doorSwings(doors, arcs, fpu).map((s) => s.polygons.flat()), keyDoors, fpu);
          // `page` and `at` (page-width units: hinge and strike) so a confident false door can be opened on its sheet without a rerun.
          const r6 = (v: number) => +v.toFixed(6);
          doors.forEach((d, i) => appendFileSync(OUT, JSON.stringify({ set: dir, sheet, page: saved.page, kind: "door", real: real[i], at: { hinge: [r6(d.hinge.x), r6(d.hinge.y)], strike: [r6(d.strike.x), r6(d.strike.y)] }, x: x[i]!.map((v) => +v.toFixed(4)) }) + "\n"));
          appendFileSync(OUT, JSON.stringify({ set: dir, sheet, kind: "door", keyCount: keyDoors.length }) + "\n");
          // The doors set aside as existing, each against the key on its own: a real one is a door lost.
          const asideReal = door.existing.length === 0 ? [] : openingLabels(doorSwings(door.existing.map((e) => e.door), arcs, fpu).map((s) => s.polygons.flat()), keyDoors, fpu);
          appendFileSync(OUT, JSON.stringify({ set: dir, sheet, kind: "door", existingAside: door.existing.map((e, i) => ({ route: e.route, why: e.why, real: asideReal[i], at: [+((e.door.hinge.x + e.door.strike.x) / 2).toFixed(6), +((e.door.hinge.y + e.door.strike.y) / 2).toFixed(6)] })) }) + "\n");
          // ── KEY COMPLETENESS: A PRINTED DOOR TAG MEANS A KEY DOOR ──
          // Joplin A-101's three confident "false" doors were real doors whose printed tags (115, 111, 120)
          // the key had missed, and they held the line down. So: a mark the product reads (`doorMarkTexts`)
          // within reach of a FOUND door (the product would call that door marked) must be covered by a key
          // door carrying the same tag, or by any key door within twice the reach. Room tags and keynotes
          // away from every found door are not asked about. Uncovered marks are written out for a person
          // to call: a key gap, or a mark that is not the door's.
          const reach = DOOR_TAG_REACH_FEET / fpu;
          const byDoor = door.marks.filter((m) => door.doors.some((d) => Math.hypot((d.hinge.x + d.strike.x) / 2 - m.x, (d.hinge.y + d.strike.y) / 2 - m.y) <= reach));
          const unkeyed = byDoor.filter((m) => !keyDoors.some((o) => o.tag?.trim().toUpperCase() === m.text || Math.hypot(o.x - m.x, o.y - m.y) <= 2 * reach));
          appendFileSync(OUT, JSON.stringify({ set: dir, sheet, kind: "door", marks: byDoor.length, unkeyedMarks: unkeyed.map((m) => ({ text: m.text, at: [+m.x.toFixed(6), +m.y.toFixed(6)] })) }) + "\n");
        }
        if (keyWindows.length > 0) {
          const counted = dw.tagged.counted ? dw.tagged.windows : [];
          const windows: WindowCandidate[] = [
            ...dw.windows.map((f, i) => ({ frame: f, at: { x: (f.x1 + f.x2) / 2, y: (f.y1 + f.y2) / 2 }, countedTag: counted.find((t) => t.frame === i)?.tag ?? null })),
            ...counted.filter((t) => t.frame === null).map((t) => ({ frame: null, at: { x: t.x, y: t.y }, countedTag: t.tag })),
          ];
          const x = windowFeatureRows({ ...context, windows, tags, doors: dw.doors, everyWindowTagged: tagsNameEveryWindow(symbols.map((s) => s.text)), scheduleInSet });
          const real = openingLabels(windows.map(windowShape), keyWindows, fpu);
          windows.forEach((w, i) => appendFileSync(OUT, JSON.stringify({ set: dir, sheet, page: saved.page, kind: "window", real: real[i], at: [+w.at.x.toFixed(6), +w.at.y.toFixed(6)], x: x[i]!.map((v) => +v.toFixed(4)) }) + "\n"));
          appendFileSync(OUT, JSON.stringify({ set: dir, sheet, kind: "window", keyCount: keyWindows.length }) + "\n");
        }
        read.push(`${dir} ${sheet}`);
      }
    }
    expect(read.length, "no keyed sheet was read").toBeGreaterThan(0);
    // PARITY (METHOD v2): a row set the product would not produce must not train a model.
    console.log(`PARITY doors: ${parity.sheets} sheets · ${parity.differ} differ${parity.lines.map((l) => `\n  ${l}`).join("")}`);
    expect(parity.differ, "the door rows' kept doors differ from the product's on some sheet").toBe(0);
  });
});
