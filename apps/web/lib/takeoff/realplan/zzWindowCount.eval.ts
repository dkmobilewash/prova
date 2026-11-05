import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractScheduleRows, type ScheduleRowsRead } from "@prova/integrations/src/scheduleRows";
import { requireEvalApiKey } from "../../ai/evalApiKey";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { gridText, tableRowsFromPage } from "../../plan-ingest/scheduleTable";
import { doorsAndWindowsForSheet } from "../doorsWindows";
import { findWallsOnSheet, inPageWidthUnits } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { tagSymbols } from "../tagSymbols";
import { keyFromLabels, scoreOpenings, type KeyPoint } from "../heldOutScore";
import { readdirSync } from "node:fs";

/**
 * ── WINDOWS COUNTED BY TAG ON ONE SHEET, WITH THE SET'S WINDOW SCHEDULE ──
 *
 * The product's `doorsAndWindowsForSheet` over one sheet (`WC_SPEC`,
 * `set:page:feetPerUnit`), with the set's WINDOW schedule read the way the
 * ingest reads one (`extractScheduleRows` over the page's grid), cached by
 * set, page and kind in `WC_CACHE` so a re-run spends nothing. The schedule
 * pages are those whose text says "WINDOW SCHEDULE" or "WINDOW TYPE"; a read
 * that is not of kind WINDOW is not used. One JSON line per sheet to
 * `WC_OUT`: every window counted by its tag (position, tag) and every frame
 * the geometry finder offered, so a key can score both.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SPEC = process.env.WC_SPEC ?? "";
const CACHE = process.env.WC_CACHE ?? "";
const OUT = process.env.WC_OUT ?? "";
/** A labels snapshot: when it holds this sheet with window marks, both counts are scored against them. */
const LABELS = process.env.WC_LABELS ?? "";

/** The round-13 window marks for one sheet, from a labels snapshot, or null when none were made. */
function windowKey(set: string, page: number): KeyPoint[] | null {
  if (LABELS === "" || !existsSync(LABELS)) return null;
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dir = readdirSync(LABELS).find((d) => flat(d) === flat(set));
  if (dir === undefined) return null;
  for (const f of readdirSync(join(LABELS, dir)).filter((f) => f.endsWith(".json"))) {
    const saved = JSON.parse(readFileSync(join(LABELS, dir, f), "utf8")) as { page?: number; verdicts?: never[]; openings?: { x: number; y: number; kind: string; tag?: string }[] };
    if (saved.page !== page) continue;
    const marks = keyFromLabels({ verdicts: saved.verdicts ?? [], openings: saved.openings ?? [] }).openings.filter((o) => o.kind === "window");
    return marks.length > 0 ? marks : null;
  }
  return null;
}

describe.skipIf(DIR === "" || SPEC === "" || CACHE === "" || OUT === "")("windows counted by tag on one sheet", () => {
  requireEvalApiKey("window-count eval");
  it("counts the sheet's windows by their tags", { timeout: 1_800_000 }, async () => {
    const [set, pageText, fpuText] = SPEC.split(":");
    const page = Number(pageText), fpu = Number(fpuText);
    // The PDF reader detaches what it is given, so each reader gets its own copy.
    const bytes = () => Buffer.from(readFileSync(join(DIR, set!)));
    const doc = await openPlanPdf(bytes());
    const windowRows: { mark: string; size?: string | null; description?: string | null }[] = [];
    const schedulePages: number[] = [];
    for (let p = 1; p <= doc.pageCount; p += 1) {
      const text = await doc.pageText(p);
      const words = text.items.map((i) => i.str).join(" ").toUpperCase();
      if (!/WINDOW SCHEDULE|WINDOW TYPE/.test(words)) continue;
      schedulePages.push(p);
      const at = join(CACHE, `${set!.replace(/\W+/g, "_")}-p${p}-window-schedule.json`);
      let read: ScheduleRowsRead;
      if (existsSync(at)) read = JSON.parse(readFileSync(at, "utf8")) as ScheduleRowsRead;
      else {
        read = await extractScheduleRows({ grid: gridText(tableRowsFromPage(text)), pageNumber: p, sheetTitle: "WINDOW SCHEDULE" });
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(at, JSON.stringify(read, null, 1));
      }
      if (read.kind === "WINDOW") windowRows.push(...read.rows.filter((r) => typeof r.mark === "string").map((r) => ({ mark: r.mark!, size: r.size ?? null, description: r.description ?? null })));
    }
    const strokes = await sheetStrokes(bytes(), page);
    expect(strokes, "the sheet could not be read").not.toBeNull();
    if (!strokes) return;
    const W = strokes.widthPt;
    const text = await doc.pageText(page);
    const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
    const walls = findWallsOnSheet({ segments: strokes.segments, textItems: items, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, wallTypes: [], sampledSheets: null }).walls;
    const result = doorsAndWindowsForSheet({ segments: strokes.segments.map(inPageWidthUnits(W)), segmentsPt: strokes.segments, textPt: items, widthPt: W, walls, feetPerUnit: fpu, scheduleRows: [], windowRows });
    await doc.close();
    const key = windowKey(basename(set!), page);
    const tagged: KeyPoint[] = result.tagged.windows.map((w) => ({ x: w.x, y: w.y, kind: "window", tag: w.tag }));
    const frames: KeyPoint[] = result.windows.map((f) => ({ x: (f.x1 + f.x2) / 2, y: (f.y1 + f.y2) / 2, kind: "window" }));
    appendFileSync(
      OUT,
      JSON.stringify({
        set: basename(set!),
        page,
        feetPerUnit: fpu,
        schedulePages,
        scheduleMarks: [...new Set(windowRows.map((r) => r.mark))],
        vocabulary: result.tagged.vocabulary,
        // Every W-shaped text in a symbol on the sheet, read or rejected: what the vocabulary had to choose from.
        wTagsSeen: tagSymbols({ segments: strokes.segments, text: items, unitsPerPaperInch: 72 })
          .filter((t) => /^W-?\d/i.test(t.text.trim()))
          .map((t) => `${t.text.trim()}${t.rejected === null ? "" : `(${t.rejected})`}`),
        counted: result.tagged.counted,
        byTag: result.tagged.byTag.map((t) => ({ tag: t.tag, count: t.count })),
        tagged: result.tagged.windows.map((w) => ({ x: w.x, y: w.y, kind: "window", tag: w.tag, framed: w.frame !== null })),
        countedByTag: result.tagged.counted,
        frames,
        // Against the reviewer's marks, when the sheet has them: windows counted by tag, and the frames alone as before.
        score: key === null ? null : { byTag: scoreOpenings(key, result.tagged.counted ? tagged : [], "window", fpu), framesOnly: scoreOpenings(key, frames, "window", fpu) },
      }) + "\n",
    );
    expect(walls.length, "no walls were found, so no tag could be placed").toBeGreaterThan(0);
  });
});
