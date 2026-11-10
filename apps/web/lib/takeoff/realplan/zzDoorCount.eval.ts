import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { doorsAndWindowsForSheet } from "../doorsWindows";
import { DOOR_TAG_REACH_FEET } from "../doorWindowSymbols";
import { findWallsOnSheet, inPageWidthUnits } from "../findWallsOnSheet";
import { keyFromLabels, scoreOpenings, type KeyPoint } from "../heldOutScore";
import { sheetStrokes } from "../sheetStrokes";
import { tagSymbols } from "../tagSymbols";

/**
 * ── THE DOOR FINDER AGAINST ROUND 17'S DOOR KEYS ──
 *
 * The product's `doorsAndWindowsForSheet` on one sheet, its doors scored against the doors
 * a reviewer marked (`openings` of kind "door" in the label file), with `scoreOpenings`:
 * found / missed / false within OPENING_MATCH_FEET, and mark-correct where the key prints
 * a mark ("-" = none printed, not scored for the mark).
 *
 * `score` matches the leaf's closed midpoint within 2 ft, which misses a reviewer's click on
 * the open leaf (most keyed doors sat 2–3 ft off on training): `swings` carries each door's
 * hinge and width so `door_score.py` matches a key point anywhere inside the swing.
 * A door's point is its leaf's midpoint (hinge to strike); its mark is the nearest door-mark
 * symbol within DOOR_TAG_REACH_FEET of it, the reach the finder itself uses to call a door
 * marked (`onlyMarkedDoors`). The finder only finds SWING doors (an arc); the keys were made
 * the same way, so sliding doors and cased openings are on neither side.
 *
 *     DC_SHEETS="file|page|fpu|label.json|TRAINING;…" DC_OUT=out.jsonl REAL_PLAN_DIR=…
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SHEETS = (process.env.DC_SHEETS ?? "").split(";").filter((s) => s.trim() !== "");
const OUT = process.env.DC_OUT ?? "";

describe.skipIf(DIR === "" || SHEETS.length === 0 || OUT === "")("doors against the door keys", () => {
  for (const spec of SHEETS) {
    const [file, pageText, fpuText, labelPath, group] = spec.split("|");
    const page = Number(pageText), fpu = Number(fpuText);
    it(`${file} p${page}`, { timeout: 900_000 }, async () => {
      const bytes = () => Buffer.from(readFileSync(join(DIR, file!)));
      const strokes = await sheetStrokes(bytes(), page);
      expect(strokes, "the sheet could not be read").not.toBeNull();
      if (!strokes) return;
      const W = strokes.widthPt;
      const doc = await openPlanPdf(bytes());
      const items = (await doc.pageText(page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      await doc.close();
      const walls = findWallsOnSheet({ segments: strokes.segments, textItems: items, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, wallTypes: [], sampledSheets: null }).walls;
      const result = doorsAndWindowsForSheet({ segments: strokes.segments.map(inPageWidthUnits(W)), segmentsPt: strokes.segments, textPt: items, widthPt: W, walls, feetPerUnit: fpu, scheduleRows: [], windowRows: [] });
      const marks = tagSymbols({ segments: strokes.segments, text: items, unitsPerPaperInch: 72 })
        .filter((s) => s.rejected === null)
        .map((s) => ({ text: s.text.trim().toUpperCase(), x: s.x / W, y: s.y / W }));
      const reach = DOOR_TAG_REACH_FEET / fpu;
      const found: KeyPoint[] = result.doors.map((d) => {
        const x = (d.hinge.x + d.strike.x) / 2, y = (d.hinge.y + d.strike.y) / 2;
        let best: { text: string; d: number } | null = null;
        for (const m of marks) {
          const dist = Math.hypot(m.x - x, m.y - y);
          if (dist <= reach && (best === null || dist < best.d)) best = { text: m.text, d: dist };
        }
        return { x, y, kind: "door", ...(best === null ? {} : { tag: best.text }) };
      });
      const saved = JSON.parse(readFileSync(labelPath!, "utf8")) as { verdicts?: never[]; openings?: { x: number; y: number; kind: string; tag?: string }[] };
      const key = keyFromLabels({ verdicts: saved.verdicts ?? [], openings: saved.openings ?? [] }).openings.filter((o) => o.kind === "door");
      const score = scoreOpenings(key, found, "door", fpu);
      // The swing itself, so a key point anywhere in the door's quarter circle can be matched (`door_score.py`).
      const swings = result.doors.map((d, i) => ({ hinge: d.hinge, strike: d.strike, widthFeet: d.widthFeet, leaves: d.leaves, tag: found[i]!.tag ?? null }));
      appendFileSync(OUT, JSON.stringify({ file: basename(file!), page, group, feetPerUnit: fpu, score, found, swings, key }) + "\n");
      console.log(`DOORS ${group} ${basename(file!)} p${page}: key ${score.key} found ${score.found} missed ${score.missed} false ${score.false} · marks scored ${score.tagged} correct ${score.tagCorrect}`);
      expect(walls.length).toBeGreaterThan(0);
    });
  }
});
