/**
 * ── PRE-LABEL & CORRECT: C-STREAM'S RUN WRITTEN AS A LABEL FILE FOR CHROME TO FIX ──
 *
 * METHOD v2 item 4 (Diego, 2026-11-13): new sets are labelled by CORRECTING
 * C-Stream's pre-labels, not from scratch. This eval writes
 * `takeoff-labels-v1` files whose verdicts are the finder's own best answer —
 * a run the model would post is "wall", a run it would hold off the estimate
 * is "not-wall" — so Chrome's round is accept / reject / fix the type / trace
 * the misses. `reviewedBy` says "C-Stream-prefill" and `reviewComplete` is
 * false, so nothing downstream can mistake a pre-fill for a finished key.
 *
 * Guard rails, each one a rule this repo already paid for:
 *   - it REFUSES to overwrite an existing label file — a human's correction
 *     outranks a fresh pre-fill, always;
 *   - it REFUSES held-out sets unless PRELABEL_ALLOW_HELD=1 — a pre-filled
 *     held-out key is still a key, but the default keeps iteration away;
 *   - it never runs without PRELABEL_CONFIG, so no other eval sweep can
 *     trigger writes by accident (and it is registered in KEYLESS_EVALS).
 *
 * PRELABEL_CONFIG = path to JSON: [{ pdf, page, set, sheet, feetPerUnit? }].
 * feetPerUnit defaults to 144 (1/8" = 1'-0"); pass the sheet's real scale —
 * the ingest's drawing-read scale — whenever it differs.
 */
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { ScoredPairing } from "../demotedRuns";
import { doorsAndWindowsForSheet } from "../doorsWindows";
import { runsHeldOffEstimate } from "../estimateHold";
import { heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { FEATURE_NAMES } from "../wallFeatures";
import { loadWallModel } from "../wallModelFile";

const CONFIG = process.env.PRELABEL_CONFIG ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

type Entry = { pdf: string; page: number; set: string; sheet: string; feetPerUnit?: number; scaleFtPerInch?: number };

describe.skipIf(CONFIG === "" || LABELS === "")("pre-label generator", () => {
  it("writes C-Stream's run as a correctable label file", { timeout: 3_600_000 }, async () => {
    const config = loadWallModel();
    if (config === null) throw new Error("no wall model (set TAKEOFF_WALL_MODEL)");
    const entries = JSON.parse(readFileSync(CONFIG, "utf8")) as Entry[];
    if (!Array.isArray(entries) || entries.length === 0) throw new Error("PRELABEL_CONFIG holds no entries");
    const written: string[] = [];
    for (const e of entries) {
      const why = heldOutReason(e.set);
      if (why !== null && process.env.PRELABEL_ALLOW_HELD !== "1") {
        throw new Error(`REFUSING held-out set ${e.set} (${why}) — pre-filling a held-out key needs PRELABEL_ALLOW_HELD=1`);
      }
      const out = join(LABELS, e.set, `${e.sheet}.json`);
      if (existsSync(out)) throw new Error(`REFUSING to overwrite ${out} — a human label outranks a pre-fill`);
      const buf = readFileSync(e.pdf);
      const strokes = await sheetStrokes(Buffer.from(buf), e.page);
      if (strokes === null || strokes.segments.length < 50) throw new Error(`${e.set}/${e.sheet}: p${e.page} has ${strokes?.segments.length ?? 0} segments — not a vector floor plan`);
      const doc = await openPlanPdf(Buffer.from(buf));
      const text = await doc.pageText(e.page);
      const W = strokes.widthPt;
      // fpu = the sheet's own width in inches times the DRAWING-READ scale's ft/inch —
      // never a guessed constant: a wrong one multiplies every length on the sheet.
      const fpu = e.feetPerUnit ?? (e.scaleFtPerInch !== undefined ? (W / 72) * e.scaleFtPerInch : NaN);
      if (!Number.isFinite(fpu) || fpu <= 0) throw new Error(`${e.set}/${e.sheet}: no feetPerUnit and no scaleFtPerInch — refusing to guess a scale`);
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const scored: ScoredPairing[] = [];
      const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (f, w) => { scored.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); } });
      const runs = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems }).offeredRuns;
      const held = new Set(runsHeldOffEstimate(config.model, runs, scored, fpu, false));
      const dw = doorsAndWindowsForSheet({ segments: d.found.inUnits, segmentsPt: strokes.segments, textPt: textItems, widthPt: W, walls: d.found.walls, feetPerUnit: fpu, scheduleRows: [] });
      await doc.close();
      const verdicts = runs.map((r) => ({
        x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2,
        lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet,
        verdict: held.has(r) ? "not-wall" : "wall",
      }));
      const openings = [
        ...dw.doors.map((o, at) => ({ x: o.x, y: o.y, kind: "door", tag: dw.doorMarks[at] ?? "" })),
        ...dw.windows.map((o) => ({ x: o.x, y: o.y, kind: "window", tag: "" })),
      ];
      const accepted = verdicts.filter((v) => v.verdict === "wall").length;
      const file = {
        format: "takeoff-labels-v1",
        set: e.set.replace(/_/g, " "),
        sheet: e.sheet,
        page: e.page,
        reviewedBy: "C-Stream-prefill",
        reviewedAt: new Date().toISOString(),
        reviewerKind: "ai",
        finderVersion: process.env.TAKEOFF_FINDER_VERSION ?? "prefill",
        secondsSpent: 0,
        feetPerUnit: fpu,
        featureNames: [...FEATURE_NAMES],
        splits: [],
        carriedRows: null,
        reviewComplete: false,
        counts: { accepted, rejected: verdicts.length - accepted, traced: 0, unsure: 0, unreviewed: 0 },
        rows: [],
        verdicts,
        traced: [],
        openings,
      };
      mkdirSync(join(LABELS, e.set), { recursive: true });
      writeFileSync(out, JSON.stringify(file, null, 1));
      written.push(out);
      console.log(`PREFILL ${e.set} ${e.sheet} p${e.page}: ${accepted} wall / ${verdicts.length - accepted} not-wall · ${dw.doors.length} doors · ${dw.windows.length} windows · fpu ${fpu} → ${out}`);
    }
    // The harness census's promise: a config that resolved to nothing must never read as a clean run.
    expect(written.length, "PRELABEL_CONFIG resolved to no written pre-fill").toBeGreaterThan(0);
  });
});
