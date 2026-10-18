import { describe, expect, it } from "vitest";
import { labelWallCandidates, type WallCandidateForLabel } from "@prova/integrations";
import { requireApiKey } from "../../ask/eval/harness";
import { VARIANTS, allSheets, buildKey, primsForCase, sheetForVariant } from "./cases";
import { findWalls, gradeWalls, type GradedRun } from "./harness";
import { writePdf } from "./writers";
import { standardFontDir } from "./run";

/**
 * ── IS THE MODEL THAT JUDGES A RUN ANY GOOD? NOBODY HAD ASKED ──
 *
 * `labelWallCandidates` ships behind the AI switch and a "Check these are
 * walls" button. Its header carries ONE measurement — an apartment plan where
 * it rejected counters, tubs and reference lines and left the structure intact
 * — recorded honestly as the anecdote it is. The bench has never graded it, for
 * a good reason: it costs money and needs a key, so it cannot live in CI.
 *
 * It is worth grading now because it is the only instrument left for the thing
 * geometry cannot do. Two deterministic attempts at the same problem were
 * measured against a real drawing and both failed: repeated-shape detection
 * caught 13% of a parking plan's cars while wrongly catching 1% of its walls,
 * and the structural route does not exist at all, because every real export
 * explodes its blocks. If MEANING is the missing signal, this supplies it — and
 * "we think it helps" is not good enough to switch on unasked.
 *
 *     ANTHROPIC_API_KEY=... pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/bench/wallClassify.eval.ts
 *
 * ── WHY THE BENCH'S OWN SHEETS ──
 *
 * Ground truth. `gradeWalls` classifies every found run against a key computed
 * from the model that drew the sheet: `TRUE` is a real wall, `PHANTOM` is line
 * work that is not one, `MUST_NOT_COUNT` is real geometry nobody should bid. A
 * real drawing has no key, so a run on one can be judged by eye and not by
 * arithmetic — and it keeps a customer's plan set out of a test, which is the
 * standing rule. The cost, stated: these are OUR drawings, so a pass here is a
 * floor exactly as `wallCases.ts` says of the rest of the bench.
 *
 * ── THE ASYMMETRY THAT DECIDES THE VERDICT ──
 *
 *   kept a phantom   cheap — it is on screen in its own colour and a person
 *                            rejects it in a second
 *   dropped a wall   dear  — invisible, and it reaches a bid
 *
 * So the number that decides whether this may ever run UNASKED is REAL WALLS
 * WRONGLY LABELLED, not overall accuracy. A classifier that removes 90% of
 * phantoms and one real wall per sheet is worse than one that removes 40% and
 * no walls.
 */

const CASES = (process.env.CLASSIFY_CASES ?? "A-101:clean").split(",");
/** The long edge the viewer renders its crop at. */
const SIDE = 1600;
/**
 * How much sheet one request covers, in POINTS.
 *
 * ── THE FIRST VERSION OF THIS FILE SENT THE WHOLE SHEET, AND THE NUMBER IT
 * PRODUCED WAS ABOUT THE HARNESS ──
 *
 * It rendered all 36 inches at 1,600px and reported the model dropping 21 of 60
 * real walls, calling a 208ft wall a dimension string. That is about 44 DPI, at
 * which 1/8in lettering is five pixels tall and the candidate numbers drawn
 * beside each run cannot be read at all. The prompt's own header does this
 * arithmetic and concludes **"A CROP, NOT THE SHEET"** — so the harness was
 * asking the model to read something illegible, and the failure was the
 * harness's, not the model's.
 *
 * 600pt at 1,600px is about 190 DPI, the figure that header names as legible
 * and what the viewer produces at a working zoom. The sheet is TILED into
 * windows that size, which is also what an estimator does by scrolling.
 */
const WINDOW_PT = Number(process.env.CLASSIFY_WINDOW_PT ?? "600");

requireApiKey();

type Scored = {
  caseId: string;
  candidates: number;
  /** Real walls the model called something other than WALL. The expensive one. */
  wallsLost: { id: number; label: string; lengthFt: number; reason: string }[];
  phantomsCaught: number;
  phantomsTotal: number;
  wallsKept: number;
  wallsTotal: number;
  unsure: number;
  missingReported: number;
  windows: number;
};

type Win = { x: number; y: number; w: number; h: number };

/** The sheet cut into `WINDOW_PT` tiles, in page-width UNITS. */
function windowsOver(widthPt: number, heightPt: number): Win[] {
  const step = WINDOW_PT / widthPt;
  const tall = heightPt / widthPt;
  const out: Win[] = [];
  for (let y = 0; y < tall; y += step) {
    for (let x = 0; x < 1; x += step) {
      out.push({ x, y, w: Math.min(step, 1 - x), h: Math.min(step, tall - y) });
    }
  }
  return out;
}

/**
 * One window, rendered with its runs drawn and numbered — the same red line and
 * number beside it the viewer draws, because the number IS the id and that is
 * the whole contract with the prompt.
 */
async function windowPng(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs ships no types for the legacy build entry.
  doc: any,
  win: Win,
  runs: readonly { x1: number; y1: number; x2: number; y2: number }[],
): Promise<string> {
  const page = await doc.getPage(1);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(SIDE / (win.w * base.width), SIDE / (win.h * base.width), 4);
    const vp = page.getViewport({ scale });
    const outW = Math.ceil(win.w * base.width * scale);
    const outH = Math.ceil(win.h * base.width * scale);
    const { canvas, context } = doc.canvasFactory.create(outW, outH);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outW, outH);
    context.save();
    context.translate(-win.x * base.width * scale, -win.y * base.width * scale);
    await page.render({ canvasContext: context, viewport: vp }).promise;
    context.restore();

    const px = (u: number) => (u - win.x) * base.width * scale;
    const py = (u: number) => (u - win.y) * base.width * scale;
    context.lineWidth = Math.max(2, outW / 500);
    context.strokeStyle = "rgba(225,17,17,0.85)";
    context.fillStyle = "#e11";
    context.font = `bold ${Math.max(11, Math.round(outW / 110))}px sans-serif`;
    runs.forEach((run, i) => {
      context.beginPath();
      context.moveTo(px(run.x1), py(run.y1));
      context.lineTo(px(run.x2), py(run.y2));
      context.stroke();
      context.fillText(String(i + 1), (px(run.x1) + px(run.x2)) / 2 + 4, (py(run.y1) + py(run.y2)) / 2 - 4);
    });
    return canvas.toBuffer("image/png").toString("base64");
  } finally {
    page.cleanup();
  }
}

async function scoreCase(caseId: string): Promise<Scored> {
  const [sheetId, variantId] = caseId.split(":");
  const variant = VARIANTS.find((v) => v.id === variantId);
  if (!variant) throw new Error(`no such variant: ${variantId}`);
  const sheet = sheetForVariant(sheetId, variantId, allSheets());
  const prims = primsForCase(sheet, variant);
  const bytes = writePdf(sheet, prims);
  const key = buildKey(sheet, variant);

  // THE TRUE SCALE, as `run.ts`'s `nominalFpu` computes it. This grades the
  // CLASSIFIER, so letting a scale error in would be measuring something else.
  const feetPerUnit = sheet.widthPt / (sheet.views[0]?.ptPerFt ?? 9);
  const found = await findWalls(bytes, feetPerUnit);
  const graded: GradedRun[] = gradeWalls(found.walls, key, prims, sheet, variant).graded;
  expect(graded.length, `${caseId}: the pipeline found nothing, so there is nothing to grade`).toBeGreaterThan(0);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    standardFontDataUrl: standardFontDir(),
  }).promise;

  const saidFor = new Map<GradedRun, { label: string; reason: string }>();
  let missingReported = 0;
  let windows = 0;
  try {
    for (const win of windowsOver(sheet.widthPt, sheet.heightPt)) {
      // A run is judged once, by the window its middle falls in — the same rule
      // the viewer uses for "in view".
      const mine = graded.filter((g) => {
        const mx = (g.run.x1 + g.run.x2) / 2;
        const my = (g.run.y1 + g.run.y2) / 2;
        return mx >= win.x && mx < win.x + win.w && my >= win.y && my < win.y + win.h;
      });
      if (mine.length === 0) continue;
      windows += 1;
      console.log(`  ${caseId} window ${windows}: ${mine.length} candidates`);

      const reply = await labelWallCandidates({
        imageBase64: await windowPng(doc, win, mine.map((g) => g.run)),
        candidates: mine.map(
          (g, i): WallCandidateForLabel => ({
            id: i + 1,
            thicknessIn: g.run.thicknessFeet * 12,
            lengthFt: g.run.lengthFeet,
          }),
        ),
        cropFeet: win.w * feetPerUnit,
      });
      for (const l of reply.labels) {
        const g = mine[l.id - 1];
        if (g) saidFor.set(g, { label: l.label, reason: l.reason });
      }
      missingReported += reply.missing.length;
    }
  } finally {
    await doc.destroy();
  }

  const out: Scored = {
    caseId,
    candidates: graded.length,
    wallsLost: [],
    phantomsCaught: 0,
    phantomsTotal: 0,
    wallsKept: 0,
    wallsTotal: 0,
    unsure: 0,
    missingReported,
    windows,
  };
  graded.forEach((g, i) => {
    const said = saidFor.get(g);
    const label = said?.label ?? "UNSURE";
    if (label === "UNSURE") out.unsure += 1;
    // An id the model does not answer about is left exactly as the geometry
    // found it, so an absent label counts as KEPT rather than as a loss.
    const kept = label === "WALL" || label === "UNSURE";
    if (g.cls === "TRUE") {
      out.wallsTotal += 1;
      if (kept) out.wallsKept += 1;
      else out.wallsLost.push({ id: i + 1, label, lengthFt: g.run.lengthFeet, reason: said?.reason ?? "" });
    } else if (g.cls === "PHANTOM" || g.cls === "MUST_NOT_COUNT") {
      out.phantomsTotal += 1;
      if (!kept) out.phantomsCaught += 1;
    }
  });
  return out;
}

describe("the wall classifier, graded", () => {
  it(`labels ${CASES.length} case(s) and is scored against the answer key`, async () => {
    const rows: Scored[] = [];
    for (const caseId of CASES) rows.push(await scoreCase(caseId));

    const lines = [
      "",
      `window: ${WINDOW_PT}pt rendered at ${SIDE}px`,
      "",
      "case            win  cand  walls kept  phantoms caught  unsure  missing",
    ];
    for (const r of rows) {
      lines.push(
        `${r.caseId.padEnd(15)} ${String(r.windows).padStart(3)} ${String(r.candidates).padStart(5)}  ` +
          `${String(r.wallsKept).padStart(5)}/${String(r.wallsTotal).padEnd(5)} ` +
          `${String(r.phantomsCaught).padStart(8)}/${String(r.phantomsTotal).padEnd(6)} ` +
          `${String(r.unsure).padStart(6)}  ${String(r.missingReported).padStart(5)}`,
      );
    }
    const lost = rows.flatMap((r) => r.wallsLost.map((w) => ({ ...w, caseId: r.caseId })));
    lines.push("", `REAL WALLS WRONGLY DROPPED: ${lost.length} — the number that decides this`);
    for (const w of lost.slice(0, 25)) {
      lines.push(`   ${w.caseId}  #${w.id}  ${w.lengthFt.toFixed(1)}ft  -> ${w.label}: ${w.reason.slice(0, 95)}`);
    }
    console.log(lines.join("\n"));

    // The instrument's own controls: candidates must have reached the key, and
    // the model must have been asked something. Without both, every figure
    // above is about a comparison that never happened.
    const judged = rows.reduce((n, r) => n + r.wallsTotal + r.phantomsTotal, 0);
    expect(judged, "no candidate was gradeable — the answer key matched no run").toBeGreaterThan(0);
    expect(
      rows.reduce((n, r) => n + r.windows, 0),
      "no window was ever sent to the model",
    ).toBeGreaterThan(0);
    // ONE REQUEST PER WINDOW, and a sheet is a dozen or more of them. The
    // eval config's 90s default is for a single call.
  }, 1_800_000);
});
