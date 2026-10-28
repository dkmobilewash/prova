import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { finderVersion } from "../finderVersion";
import { heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { collectSheets } from "../labelCollect";
import type { LabelCandidate } from "../labelRows";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { withoutUnitPlanJunk } from "../unitPlanJunk";
import { deciderFor, type WallModel } from "../wallClassifier";
import { FEATURE_NAMES } from "../wallFeatures";
import type { WallCandidate } from "../wallVectors";

/**
 * ── THE CLASSIFIER'S VETO, LEAVE-ONE-BUILDING-OUT, ON THE PRODUCT PATH ──
 *
 * Two phases, both over every TRAINING sheet (held-out sets refused by
 * `heldOutReason`), both through `detectForSheet` — the path the viewer and
 * the arms eval run, not the raw finder `zzTrainRows` collects from.
 *
 *   LOBO_ROWS_OUT=rows.jsonl   write one training row per labelled candidate,
 *                              with its building as `family`, for the trainer
 *   LOBO_MODEL_DIR=dir         score every sheet with and without the veto,
 *                              using `dir/model-<family>.json`, which must have
 *                              been trained WITHOUT that family's rows
 *   LOBO_CUT=0.3               the veto refuses a candidate scoring below this
 *   LOBO_OUT=dir LOBO_TAG=x    per-sheet JSON
 *   LOBO_SITE=1                hand the sheet's text to `offeredCandidates`, so
 *                              the site-equipment rule runs (off by default, so a
 *                              measurement of something else is not moved by it)
 *
 * No database: the PDF is found by name under REAL_PLAN_DIR / REAL_PLAN_DIR2.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const ROWS_OUT = process.env.LOBO_ROWS_OUT ?? "";
const MODEL_DIR = process.env.LOBO_MODEL_DIR ?? "";
const CUT = Number(process.env.LOBO_CUT ?? "0.3");
const OUT = process.env.LOBO_OUT ?? "";
const TAG = process.env.LOBO_TAG ?? "run";
const ONLY = process.env.LOBO_ONLY ?? "";
/** LOBO_JUNK=1 adds two arms: the unit-plan junk filter alone, and veto + filter. */
const JUNK = process.env.LOBO_JUNK === "1";

type Saved = Parameters<typeof keyFromLabels>[0] & Parameters<typeof collectSheets>[0][number]["saved"] & { page: number; set: string };

const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const name of readdirSync(root)) if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
  return null;
}
/** The same lower-cased family `trainingRows` writes — see `familyOf` there. */
const familyOf = (set: string) => set.toLowerCase().replace(/\.pdf$/, "").replace(/[^a-z0-9]+/g, "-");

describe.skipIf(DIR === "" || LABELS === "" || (ROWS_OUT === "" && MODEL_DIR === ""))("the classifier's veto, leave-one-building-out", () => {
  it("writes rows, or scores every training sheet with and without the veto", { timeout: 7_200_000 }, async () => {
    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      if (ONLY !== "" && !dir.toLowerCase().includes(ONLY.toLowerCase())) continue;
      for (const name of readdirSync(join(LABELS, dir))) if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
    }
    files.sort((a, b) => a.dir.localeCompare(b.dir) || a.sheet.localeCompare(b.sheet));
    const prepared: Parameters<typeof collectSheets>[0][number][] = [];
    const rows: Record<string, unknown>[] = [];
    const models = new Map<string, ReturnType<typeof deciderFor>>();
    let tm = [0, 0];
    let tv = [0, 0];
    let tb = [0, 0];
    for (const file of files) {
      const pdf = findPdf(file.dir);
      if (pdf === null) continue;
      const saved = JSON.parse(readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8")) as Saved;
      const set = saved.set === "" || saved.set === undefined ? file.dir : saved.set;
      const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
      if (strokes === null) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(saved.page);
      await doc.close();
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const pageSize = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
      const base = { segments: strokes.segments, textItems, pageSize, feetPerUnit: saved.feetPerUnit };

      if (ROWS_OUT !== "") {
        const candidates: LabelCandidate[] = [];
        detectForSheet({
          ...base,
          onCandidate: (features, wall) => candidates.push({ x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2, lengthFeet: wall.lengthFeet, thicknessFeet: wall.thicknessFeet, features }),
        });
        if (candidates.length === 0) continue;
        prepared.push({ saved: { ...saved, set, verdicts: saved.verdicts as never }, candidates });
        console.log(`  ${`${file.dir.slice(0, 26)}/${file.sheet}`.padEnd(34)} ${candidates.length} candidates`);
        continue;
      }

      const family = familyOf(set);
      if (!models.has(family)) {
        // A building with no labelled candidates has no rows, so every row
        // trained on is already "every other building": the all-rows model
        // is its fold model.
        const own = join(MODEL_DIR, `model-${family}.json`);
        const path = existsSync(own) ? own : join(MODEL_DIR, "model-all.json");
        if (!existsSync(own)) console.log(`  (${family}: no rows of its own, scored with model-all)`);
        expect(existsSync(path), `no fold model for ${family} at ${path}`).toBe(true);
        const loaded = JSON.parse(readFileSync(path, "utf8")) as WallModel;
        const scorer = deciderFor(loaded, FEATURE_NAMES);
        expect(scorer, `the fold model for ${family} does not match this build's features`).not.toBeNull();
        models.set(family, scorer);
      }
      const scorer = models.get(family)!;
      const { key } = keyFromLabels(saved);
      const arm = (veto?: (f: number[], w: WallCandidate) => boolean, junk = false) => {
        const d = detectForSheet({ ...base, veto });
        const walls = junk ? withoutUnitPlanJunk({ walls: d.found.walls, segments: d.found.inUnits, feetPerUnit: saved.feetPerUnit }).kept : d.found.walls;
        const offered = offeredCandidates({ walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * strokes.widthPt, y1: one.y1 * strokes.widthPt, x2: one.x2 * strokes.widthPt, y2: one.y2 * strokes.widthPt })), widthPt: strokes.widthPt, feetPerUnit: saved.feetPerUnit, planBoxes: d.planBoxes, textItems: process.env.LOBO_SITE === "1" ? textItems : undefined });
        const proposed: ScoredRun[] = offered.candidates.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: w.lengthFeet, thicknessFeet: w.thicknessIn === null ? undefined : w.thicknessIn / 12 }));
        const s = scoreSheet({ set: file.dir, sheet: file.sheet, key, proposed, feetPerUnit: saved.feetPerUnit });
        return { n: offered.candidates.length, walls: d.found.walls.length, missing: Math.round(s.missingFeet), extra: Math.round(s.extraFeet), keyFeet: Math.round(s.keyFeet) };
      };
      const plain = arm();
      const veto = (f: number[]) => scorer!(f, undefined as never) < CUT;
      const vetoed = arm(veto);
      const junked = JUNK ? arm(undefined, true) : null;
      const both = JUNK ? arm(veto, true) : null;
      tm = [tm[0] + plain.missing, tm[1] + plain.extra];
      tv = [tv[0] + vetoed.missing, tv[1] + vetoed.extra];
      if (both !== null) tb = [tb[0] + both.missing, tb[1] + both.extra];
      rows.push({ set: file.dir, sheet: file.sheet, family, keyFeet: plain.keyFeet, plain, vetoed, junked, both });
      console.log(`  ${`${file.dir.slice(0, 26)}/${file.sheet}`.padEnd(34)} key ${String(plain.keyFeet).padStart(5)} · rules ${plain.walls}/${plain.n} miss ${plain.missing} extra ${plain.extra} · veto@${CUT} ${vetoed.walls}/${vetoed.n} miss ${vetoed.missing} extra ${vetoed.extra}${junked === null || both === null ? "" : ` · junk ${junked.walls}/${junked.n} miss ${junked.missing} extra ${junked.extra} · veto+junk ${both.walls}/${both.n} miss ${both.missing} extra ${both.extra}`}`);
    }

    if (ROWS_OUT !== "") {
      const { training, staleFinders } = collectSheets(prepared, finderVersion());
      const lines = training.rows.map((r) => JSON.stringify({ case: r.case, family: r.family, features: r.features, label: r.label, lengthFt: r.lengthFt })).join("\n");
      writeFileSync(ROWS_OUT, `${lines}\n`, "utf8");
      writeFileSync(`${ROWS_OUT}.columns`, `${FEATURE_NAMES.join(",")}\n`, "utf8");
      console.log(`\n  ${training.counts.rows} rows from ${training.counts.sheets} sheets across ${training.counts.families} buildings, ${training.counts.positive} positive; ${staleFinders} sheet(s) labelled under another finder; refused: ${training.refused.map((r) => `${r.set}/${r.sheet}: ${r.why}`).join("; ") || "none"}`);
      expect(training.counts.rows, "no rows were built").toBeGreaterThan(0);
      return;
    }
    expect(rows.length, "no training sheet was scored").toBeGreaterThan(0);
    if (OUT !== "") {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `lobo-${TAG}.json`), JSON.stringify(rows, null, 1));
    }
    console.log(`\n  TOTAL (${rows.length} sheets): rules miss ${tm[0]} extra ${tm[1]} · veto@${CUT} LOBO miss ${tv[0]} extra ${tv[1]}${JUNK ? ` · veto+junk miss ${tb[0]} extra ${tb[1]}` : ""}`);
  });
});
