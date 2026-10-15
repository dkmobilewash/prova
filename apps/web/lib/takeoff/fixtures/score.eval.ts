import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { dimensionLabels } from "../../plan-ingest/dimensionLabels";
import { readSheetScale } from "../scaleFromDimensions";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import type { ExpectedSheet } from "./expected";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── THE SCORECARD FOR SHEETS THIS REPO DID NOT DRAW ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/score.eval.ts
 *
 * Run by hand, like the bench. It calls no model and costs nothing, but it
 * opens twenty PDFs, which is not a unit test's job.
 *
 * ── WHAT IT CAN AND CANNOT SAY ──
 *
 * `expected.ts` carries the long version. The short one: these sheets print
 * their scale and their room tags, so those are scored. **No sheet here prints
 * a wall length**, so wall footage is reported for the eye and scored by
 * nothing — the bench remains the only key for the number that matters.
 *
 * That is a real limit and it is the right trade anyway. A wrong wall total
 * almost always begins as a wrong SCALE or a mis-read sheet, and those are
 * exactly what this set can hold us to on drawings drawn by someone else.
 */

const DIR = import.meta.dirname;

type Row = {
  id: string;
  /** Did the scale come out right, and from where. */
  scale: "✓" | "✗" | "declined" | "conflict" | "—";
  scaleHow: string;
  expectedScale: string | null;
  rooms: string;
  strokes: number;
  runs: number | null;
  groups: number | null;
  wallFt: number | null;
  notes: string;
};

/**
 * Feet of building per INCH of paper, from a printed scale name.
 *
 * The key stores what the drawing printed; this is the arithmetic, kept in the
 * scorer where it can be seen and argued with rather than baked into an answer.
 *
 * ── THE FIRST VERSION WAS TWELVE TIMES OUT, AND THE TABLE SAID SO ──
 *
 * It read `12 / (1/4)` = 48 ft per inch for `1/4" = 1'-0"`. The right answer is
 * 4: a quarter inch of paper is one foot, so a whole inch is four. Every wall
 * thickness then came out twelve times too large, nothing fell inside the
 * pairer's window, and the scorecard printed **0 runs on all fifteen vector
 * sheets** — a clean, confident, entirely wrong table.
 *
 * It was caught because an earlier probe had already reported 10-28 runs on the
 * same files. Two measurements of one thing is how a unit error becomes
 * visible; one measurement would have read as a detector failure and sent
 * somebody into `wallVectors.ts`.
 */
function feetPerInchOf(scale: string): number | null {
  // `1/4" = 1'-0"` — one inch of paper is den/num feet.
  const imperial = /^(\d+)\/(\d+)" = 1'-0"$/.exec(scale);
  if (imperial) return Number(imperial[2]) / Number(imperial[1]);
  // `3" = 1'-0"` — three inches of paper is one foot, so an inch is a third.
  const whole = /^(\d+)" = 1'-0"$/.exec(scale);
  if (whole) return 1 / Number(whole[1]);
  // `1:100` — an inch of paper is 100 inches of building, which is 100/12 feet.
  const ratio = /^1:(\d+)$/.exec(scale);
  if (ratio) return Number(ratio[1]) / 12;
  return null;
}

describe.skipIf(!existsSync(join(DIR, "plans")))("the shipped pipeline on twenty sheets it did not draw", () => {
  it("scores every fixture", async () => {
    const keys = readdirSync(join(DIR, "expected"))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(DIR, "expected", f), "utf8")) as ExpectedSheet);
    expect(keys.length, "no keys — run extract.eval.ts first").toBeGreaterThan(0);

    const rows: Row[] = [];
    for (const key of keys) {
      const row: Row = {
        id: key.id,
        scale: "—",
        scaleHow: "",
        expectedScale: key.scale,
        rooms: "",
        strokes: 0,
        runs: null,
        groups: null,
        wallFt: null,
        notes: "",
      };
      const doc = await openPlanPdf(readFileSync(join(DIR, "plans", `${key.id}.pdf`)));
      try {
        const text = await doc.pageText(1);
        const strokes = await doc.pageStrokes(1);
        row.strokes = strokes.segments.length;

        if (key.raster) {
          // The honest refusal is the pass here, and it must stay a refusal
          // until the raster path exists. A number appearing on this row would
          // mean the pipeline had started guessing at a scan.
          row.scale = strokes.segments.length === 0 ? "declined" : "✗";
          row.scaleHow = "raster";
          row.notes = "scan — nothing to read";
          rows.push(row);
          continue;
        }

        // ── THE SCALE, FROM THE DIMENSIONS ──
        //
        // The INDEPENDENT reading: `scaleFromDimensions` measures lines and
        // reads the dimension strings beside them. The key's value came from
        // the title block's printed NOTE, which this reader never consults —
        // so agreement is a real cross-check rather than a tautology.
        const verdict = readSheetScale(text, strokes.segments, dimensionLabels(text));
        if (verdict.ok) {
          row.scaleHow = "dimensions";
          const got = verdict.scaleName;
          const want = key.scalesPrinted.length > 0 ? key.scalesPrinted : null;
          if (key.scaleAuthority === "dimensions-disagree") {
            // ── THE SHEET CONTRADICTS ITSELF, SO THE NOTE IS NOT THE ANSWER ──
            //
            // Reading something OTHER than the printed note is the correct
            // behaviour here, and the first version of this scorer marked it
            // the worst failure on the board — "wrong-but-confident" — because
            // the key assumed a title block tells the truth. It sent me to fix
            // a pipeline that was right.
            row.scale = want !== null && want.includes(got) ? "✗" : "conflict";
            row.notes =
              row.scale === "conflict"
                ? `read ${got}; title block says ${key.scale} — the sheet disagrees with itself`
                : `followed the title block over its own dimensions`;
          } else {
            row.scale = want === null ? "—" : want.some((w) => w === got) ? "✓" : "✗";
            if (row.scale === "✗") row.notes = `read ${got}`;
          }
          const feetPerInch = feetPerInchOf(got) ?? verdict.feetPerInch;
          const feetPerUnit = (text.widthPt / 72) * feetPerInch;

          const items: SheetTextItem[] = text.items.map((i) => ({
            str: i.str,
            x: i.x,
            y: i.y,
            width: i.width,
            height: i.height,
          }));
          const found = findWallsOnSheet({
            segments: strokes.segments as StrokeSegment[],
            textItems: items,
            pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
            feetPerUnit,
            wallTypes: [],
            sampledSheets: null,
          });
          row.runs = found.walls.length;
          row.groups = found.groups.length;
          row.wallFt = found.walls.reduce((n, w) => n + w.lengthFeet, 0);
        } else {
          row.scaleHow = "declined";
          // A sheet that prints no scale SHOULD be declined — that is a pass.
          row.scale = key.scale === null ? "declined" : "✗";
          if (row.scale === "✗") row.notes = "has a printed scale and was not read";
        }

        // Rooms are reported rather than scored: the pipeline does not yet
        // surface a room list from this entry point. Recorded so the column
        // exists the day it does, and so the key's count is visible beside it.
        row.rooms = `—/${key.rooms.length}`;
      } finally {
        await doc.close();
      }
      rows.push(row);
    }

    const line = (r: Row) =>
      `${r.id.padEnd(4)} ${r.scale.padEnd(9)} ${r.scaleHow.padEnd(11)} ` +
      `${(r.expectedScale ?? "none").padEnd(14)} ${r.rooms.padStart(7)} ` +
      `${String(r.strokes).padStart(8)} ${String(r.runs ?? "—").padStart(5)} ` +
      `${String(r.groups ?? "—").padStart(7)} ${(r.wallFt === null ? "—" : r.wallFt.toFixed(0)).padStart(8)}  ${r.notes}`;

    const scored = rows.filter((r) => r.scale === "✓" || r.scale === "✗");
    const right = rows.filter((r) => r.scale === "✓").length;
    const declinedRight = rows.filter((r) => r.scale === "declined").length;
    const conflicts = rows.filter((r) => r.scale === "conflict").length;

    console.log(
      [
        "",
        "id   scale     how         printed         rooms   strokes  runs  groups   wall ft  note",
        "-".repeat(104),
        ...rows.map(line),
        "",
        `SCALE: ${right} correct of ${scored.length} scored; ${declinedRight} correctly declined; ${conflicts} sheet(s) contradict their own title block and the dimensions were followed (correct)`,
        `WALL FOOTAGE: reported, NOT SCORED — no sheet in this set prints one.`,
        `ROOMS: key has ${rows.reduce((n, r) => n + Number(r.rooms.split("/")[1] ?? 0), 0)} tagged rooms; the pipeline does not yet report a room list here.`,
        "",
      ].join("\n"),
    );

    // The instrument's own control: a run that opened nothing, or read no
    // geometry from any vector sheet, must not print a clean table.
    expect(rows.length).toBe(keys.length);
    expect(
      rows.filter((r) => !r.notes.startsWith("scan")).reduce((n, r) => n + r.strokes, 0),
      "no vector geometry was read from any sheet — the reader, not the drawings",
    ).toBeGreaterThan(0);
  }, 900_000);
});
